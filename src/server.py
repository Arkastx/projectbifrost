"""FastAPI server with WebSocket for live UI updates."""
import asyncio
import json
import re
from datetime import datetime
from html import unescape
from urllib.request import urlopen, Request
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from .models import game_state, GameState
from . import veteran_utils, mdb_utils, window_utils
from .config import VETERAN_SELECTION_PATH, load_config, save_config, STATE_CACHE_PATH

app = FastAPI(title="Project Bifrost", version="0.1.0")

# WebSocket connections
connected_clients: Set[WebSocket] = set()

# Static files
STATIC_DIR = Path(__file__).parent.parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
ASSETS_DIR = Path(__file__).parent.parent / "assets"
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

ROOT_DIR = Path(__file__).resolve().parents[2]
VETERAN_PATH = ROOT_DIR / "veteran.txt"
SELECTION_PATH = VETERAN_SELECTION_PATH


@app.get("/")
async def root():
    """Serve main UI page."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/state")
async def get_state():
    """Get current game state."""
    return game_state.to_dict()

@app.get("/api/veteran")
async def get_veteran():
    """Get veteran horses list from veteran.txt."""
    cached = veteran_utils.load_cache()
    if cached:
        return {"items": cached}

    if not VETERAN_PATH.exists():
        return {"items": []}

    try:
        raw = VETERAN_PATH.read_text(encoding="utf-8")
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return {"items": []}
        payload = json.loads(raw[start:end + 1])
        data = payload.get("data", {})
        trained = data.get("trained_chara_array", [])
        items = veteran_utils.build_veteran_items(trained)
        veteran_utils.save_cache(items)
        return {"items": items}
    except Exception as e:
        logger.error(f"Failed to read veteran.txt: {e}")
        return {"items": []}


@app.get("/api/veteran-selection")
async def get_veteran_selection():
    """Get selected veteran Uma IDs for Umalator."""
    if not SELECTION_PATH.exists():
        return {"uma1": None, "uma2": None}
    try:
        payload = json.loads(SELECTION_PATH.read_text(encoding="utf-8"))
        return payload
    except Exception as e:
        logger.error(f"Failed to read veteran selection: {e}")
        return {"uma1": None, "uma2": None}


@app.post("/api/veteran-selection")
async def save_veteran_selection(payload: dict):
    """Save selected veteran Uma IDs for Umalator."""
    SELECTION_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        SELECTION_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return payload
    except Exception as e:
        logger.error(f"Failed to save veteran selection: {e}")
        return {"uma1": None, "uma2": None}



@app.get("/api/settings")
async def get_settings():
    """Get saved settings."""
    return load_config()


@app.post("/api/settings")
async def post_settings(payload: dict):
    """Save settings."""
    cfg = load_config()
    for key in ("udp_host", "udp_port", "web_host", "web_port", "max_buffer_size", "log_level", "calculator", "preset_source"):
        if key in payload:
            cfg[key] = payload[key]
    save_config(cfg)
    return cfg


@app.post("/api/always-on-top")
async def set_always_on_top(payload: dict):
    """Toggle always-on-top for the UI window."""
    enabled = bool(payload.get("enabled"))
    title = payload.get("title") or "Project Bifrost"
    ok, message = window_utils.set_always_on_top(enabled, title)
    return {"ok": ok, "message": message}


@app.post("/api/state-reset")
async def reset_state():
    """Clear cached state and reset in-memory state."""
    try:
        if STATE_CACHE_PATH.exists():
            STATE_CACHE_PATH.unlink()
    except Exception as e:
        logger.error(f"Failed to delete state cache: {e}")
        return {"ok": False, "message": "Failed to delete state cache"}
    game_state.__dict__.update(GameState().__dict__)
    return {"ok": True}



@app.get("/api/umalator-presets")
async def get_umalator_presets():
    """Fetch Umalator preset list from bundle.js (alpha123 or GitHub fallback)."""
    cfg = load_config()
    preset_source = cfg.get("preset_source", "global")
    urls = [
        "https://alpha123.github.io/uma-tools/umalator-global/bundle.js",
        "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/bundle.js",
    ]
    course_urls = [
        "https://alpha123.github.io/uma-tools/umalator-global/course_data.json",
        "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/course_data.json",
    ]

    def _load_course_data() -> dict:
        headers = {"User-Agent": "ProjectBifrost/0.1"}
        for url in course_urls:
            try:
                req = Request(url, headers=headers)
                data = json.loads(urlopen(req, timeout=10).read().decode("utf-8"))
                if data:
                    return data
            except Exception as e:
                logger.error(f"Failed to fetch course data from {url}: {e}")
                continue
        try:
            local_path = STATIC_DIR / "umalator" / "course_data.json"
            if local_path.exists():
                return json.loads(local_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.error(f"Failed to read local course data: {e}")
        return {}

    def _extract_presets(text: str) -> list:
        start = text.find("var ci=")
        if start == -1:
            markers = [
                "Capricorn Cup",
                "Sagittarius Cup",
                "Scorpio Cup",
                "Libra Cup",
                "Virgo Cup",
                "Leo Cup",
                "Cancer Cup",
                "Gemini Cup",
                "Taurus Cup",
            ]
            marker_positions = []
            for marker in markers:
                pos = text.find(marker)
                if pos != -1:
                    marker_positions.append(pos)
            marker_pos = min(marker_positions) if marker_positions else -1
            if marker_pos != -1:
                pattern = re.compile(r"(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*\[")
                matches = list(pattern.finditer(text[:marker_pos]))
                if matches:
                    start = matches[-1].start()
        if start == -1:
            return []
        start = text.find("[", start)
        level = 0
        end = None
        for i in range(start, len(text)):
            ch = text[i]
            if ch == "[":
                level += 1
            elif ch == "]":
                level -= 1
                if level == 0:
                    end = i
                    break
        if end is None:
            return []
        raw = text[start:end + 1]
        raw = re.sub(r"([,{])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1"\2":', raw)
        raw = raw.replace("undefined", "null")
        raw = re.sub(r",\\s*}", "}", raw)
        raw = re.sub(r",\\s*]", "]", raw)
        return json.loads(raw)

    def _fetch_jp_cm_presets(course_data: dict) -> list:
        url = "https://gametora.com/umamusume/events/champions-meeting"
        try:
            req = Request(url, headers={"User-Agent": "ProjectBifrost/0.1"})
            html_text = urlopen(req, timeout=15).read().decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to fetch JP CM list from {url}: {e}")
            return []

        section_marker = "Champions Meeting History (Japanese server)"
        marker_idx = html_text.find(section_marker)
        if marker_idx == -1:
            return []
        snippet = html_text[marker_idx:]
        snippet = unescape(snippet)
        snippet = re.sub(r"<!--.*?-->", "", snippet, flags=re.DOTALL)
        snippet = snippet.replace("\n", " ").replace("\xa0", " ")

        dash = r"[\\u2013\\u2014-]"
        pattern = re.compile(
            r"<div[^>]*>\\s*<div><b>(?P<name>[^<]+)</b></div>\\s*"
            rf"<div[^>]*>\\s*<span>(?P<start>[^<]+)</span>\\s*{dash}\\s*<span>(?P<end>[^<]+)</span>\\s*</div>\\s*"
            rf"<div>(?P<track>[^<]+)\\s*{dash}\\s*(?P<surface>[^<]+)</div>\\s*"
            rf"<div>(?P<distance>\\d+)\\s*m\\s*{dash}\\s*(?P<distance_type>[^<]+)\\s*{dash}\\s*(?P<turn>[^<]+)</div>\\s*"
            rf"<div>(?P<ground>[^<]+)\\s*{dash}\\s*(?P<season>[^<]+)\\s*{dash}\\s*(?P<weather>[^<]+)</div>",
            flags=re.IGNORECASE,
        )

        surface_map = {"turf": 1, "dirt": 2}
        ground_map = {"firm": 1, "good": 2, "soft": 3, "heavy": 4}
        season_map = {"spring": 1, "summer": 2, "autumn": 3, "fall": 3, "winter": 4}
        weather_map = {"sunny": 1, "cloudy": 2, "rainy": 3, "snowy": 4}
        turn_map = {"clockwise": 1, "counterclockwise": 2}
        track_fallback = {
            "sapporo": 10001,
            "hakodate": 10002,
            "niigata": 10003,
            "fukushima": 10004,
            "nakayama": 10005,
            "tokyo": 10006,
            "chukyo": 10007,
            "kyoto": 10008,
            "hanshin": 10009,
            "kokura": 10010,
            "oi": 10101,
            "ooi": 10101,
        }

        presets = []
        for match in pattern.finditer(snippet):
            name = match.group("name").strip()
            track_name = match.group("track").strip()
            surface_label = match.group("surface").strip().lower()
            distance_m = int(match.group("distance"))
            ground_label = match.group("ground").strip().lower()
            season_label = match.group("season").strip().lower()
            weather_label = match.group("weather").strip().lower()
            turn_label = match.group("turn").strip().lower()

            surface = surface_map.get(surface_label)
            if surface is None:
                continue
            race_track_id = mdb_utils.get_race_track_id_by_name(track_name)
            if race_track_id is None:
                race_track_id = track_fallback.get(track_name.lower())
            if race_track_id is None:
                continue

            turn_value = turn_map.get(turn_label)
            course_id = None
            for cid, info in course_data.items():
                if info.get("raceTrackId") != race_track_id:
                    continue
                if info.get("distance") != distance_m:
                    continue
                if info.get("surface") != surface:
                    continue
                if turn_value is not None and info.get("turn") != turn_value:
                    continue
                course_id = int(cid)
                break

            if course_id is None:
                for cid, info in course_data.items():
                    if info.get("raceTrackId") == race_track_id and info.get("distance") == distance_m and info.get("surface") == surface:
                        course_id = int(cid)
                        break

            if course_id is None:
                continue

            presets.append({
                "name": name,
                "courseId": course_id,
                "date": match.group("start").strip(),
                "season": season_map.get(season_label),
                "ground": ground_map.get(ground_label),
                "weather": weather_map.get(weather_label),
                "time": 2,
                "distance_m": distance_m,
                "is_dirt": surface == 2,
                "season_label": match.group("season").strip(),
                "weather_label": match.group("weather").strip(),
                "time_label": "Night",
                "condition_label": match.group("ground").strip(),
            })

        return presets

    def _build_static_jp_presets(course_data: dict) -> list:
        if not course_data:
            try:
                local_path = STATIC_DIR / "umalator" / "course_data.json"
                if local_path.exists():
                    course_data = json.loads(local_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.error(f"Failed to read local course data for JP presets: {e}")
        fallback_course_ids = {
            ("tokyo", "turf", 2400, "counterclockwise"): 10606,
            ("kyoto", "turf", 3200, "clockwise"): 10811,
            ("tokyo", "turf", 1600, "counterclockwise"): 10602,
            ("hanshin", "turf", 2200, "clockwise"): 10906,
            ("hanshin", "turf", 1600, "clockwise"): 10903,
            ("kyoto", "turf", 3000, "clockwise"): 10810,
            ("tokyo", "turf", 2000, "counterclockwise"): 10604,
            ("nakayama", "turf", 2500, "clockwise"): 10506,
            ("chukyo", "turf", 1200, "counterclockwise"): 10701,
            ("tokyo", "dirt", 1600, "counterclockwise"): 10611,
            ("hanshin", "turf", 3200, "clockwise"): 10914,
            ("nakayama", "turf", 2000, "clockwise"): 10504,
            ("nakayama", "turf", 1200, "clockwise"): 10501,
            ("ooi", "dirt", 2000, "clockwise"): 11103,
            ("kyoto", "turf", 2200, "clockwise"): 10808,
            ("hanshin", "turf", 1400, "clockwise"): 10902,
        }
        entries = [
            ("Taurus Cup", "13 May 2021, 23:00", "Tokyo", "Turf", 2400, "Counterclockwise", "Firm", "Spring", "Sunny"),
            ("Gemini Cup", "13 Jun 2021, 23:00", "Kyoto", "Turf", 3200, "Clockwise", "Firm", "Spring", "Sunny"),
            ("Cancer Cup", "22 Jul 2021, 23:00", "Tokyo", "Turf", 1600, "Counterclockwise", "Good", "Summer", "Sunny"),
            ("Leo Cup", "23 Aug 2021, 23:00", "Hanshin", "Turf", 2200, "Clockwise", "Firm", "Summer", "Sunny"),
            ("Virgo Cup", "20 Sept 2021, 23:00", "Hanshin", "Turf", 1600, "Clockwise", "Firm", "Autumn", "Sunny"),
            ("Libra Cup", "21 Oct 2021, 23:00", "Kyoto", "Turf", 3000, "Clockwise", "Firm", "Autumn", "Sunny"),
            ("Scorpio Cup", "22 Nov 2021, 22:00", "Tokyo", "Turf", 2000, "Counterclockwise", "Soft", "Autumn", "Rain"),
            ("Sagittarius Cup", "20 Dec 2021, 22:00", "Nakayama", "Turf", 2500, "Clockwise", "Firm", "Winter", "Sunny"),
            ("Capricorn Cup", "21 Jan 2022, 22:00", "Chukyo", "Turf", 1200, "Counterclockwise", "Soft", "Winter", "Snow"),
            ("Aquarius Cup", "17 Feb 2022, 22:00", "Tokyo", "Dirt", 1600, "Counterclockwise", "Firm", "Winter", "Sunny"),
            ("Pisces Cup", "21 Mar 2022, 23:00", "Hanshin", "Turf", 3200, "Clockwise", "Heavy", "Spring", "Rain"),
            ("Aries Cup", "21 Apr 2022, 23:00", "Nakayama", "Turf", 2000, "Clockwise", "Firm", "Spring", "Sunny"),
            ("Taurus Cup", "23 May 2022, 23:00", "Tokyo", "Turf", 2400, "Counterclockwise", "Firm", "Spring", "Sunny"),
            ("Gemini Cup", "13 Jun 2022, 23:00", "Tokyo", "Turf", 1600, "Counterclockwise", "Firm", "Spring", "Sunny"),
            ("Cancer Cup", "13 Jul 2022, 23:00", "Hanshin", "Turf", 2200, "Clockwise", "Good", "Summer", "Cloudy"),
            ("Leo Cup", "12 Aug 2022, 23:00", "Nakayama", "Turf", 1200, "Clockwise", "Firm", "Summer", "Sunny"),
            ("Virgo Cup", "14 Sept 2022, 23:00", "Ooi", "Dirt", 2000, "Clockwise", "Good", "Autumn", "Sunny"),
            ("Libra Cup", "13 Oct 2022, 23:00", "Hanshin", "Turf", 1600, "Clockwise", "Firm", "Autumn", "Cloudy"),
            ("Scorpio Cup", "12 Nov 2022, 22:00", "Kyoto", "Turf", 2200, "Clockwise", "Firm", "Autumn", "Sunny"),
            ("Sagittarius Cup", "14 Dec 2022, 22:00", "Nakayama", "Turf", 2500, "Clockwise", "Good", "Winter", "Cloudy"),
            ("Capricorn Cup", "13 Jan 2023, 22:00", "Chukyo", "Turf", 1200, "Counterclockwise", "Firm", "Winter", "Sunny"),
            ("Aquarius Cup", "16 Feb 2023, 22:00", "Tokyo", "Dirt", 1600, "Counterclockwise", "Soft", "Winter", "Snow"),
            ("Pisces Cup", "13 Mar 2023, 23:00", "Nakayama", "Turf", 2000, "Clockwise", "Firm", "Spring", "Sunny"),
            ("Aries Cup", "12 Apr 2023, 23:00", "Kyoto", "Turf", 3200, "Clockwise", "Firm", "Spring", "Sunny"),
            ("MILE", "12 Jun 2023, 23:00", "Tokyo", "Turf", 1600, "Counterclockwise", "Heavy", "Spring", "Rain"),
            ("DIRT", "17 Aug 2023, 23:00", "Funabashi", "Dirt", 1600, "Counterclockwise", "Firm", "Summer", "Sunny"),
            ("CLASSIC", "12 Oct 2023, 23:00", "Longchamp", "Turf", 2400, "Clockwise", "Soft", "Autumn", "Rain"),
            ("LONG", "13 Dec 2023, 22:00", "Nakayama", "Turf", 2500, "Clockwise", "Soft", "Winter", "Snow"),
            ("SPRINT", "17 Feb 2024, 22:00", "Hanshin", "Turf", 1400, "Clockwise", "Good", "Winter", "Cloudy"),
            ("MILE", "12 Apr 2024, 23:00", "Hanshin", "Turf", 1600, "Clockwise", "Firm", "Spring", "Sunny"),
        ]

        surface_map = {"turf": 1, "dirt": 2}
        ground_map = {"firm": 1, "good": 2, "soft": 3, "heavy": 4}
        season_map = {"spring": 1, "summer": 2, "autumn": 3, "fall": 3, "winter": 4}
        weather_map = {"sunny": 1, "cloudy": 2, "rain": 3, "rainy": 3, "snow": 4, "snowy": 4}

        presets = []
        for name, date_line, track_name, surface_label, distance_m, turn_label, ground_label, season_label, weather_label in entries:
            surface_label = surface_label.strip().lower()
            turn_label = turn_label.strip().lower()
            ground_label = ground_label.strip().lower()
            season_label = season_label.strip().lower()
            weather_label = weather_label.strip().lower()
            surface = surface_map.get(surface_label)
            if surface is None:
                continue

            course_id = fallback_course_ids.get((track_name.lower(), surface_label, distance_m, turn_label))
            if course_id is None:
                logger.warning(f"JP preset skipped: missing course for {track_name} {distance_m} {surface_label}")
                continue

            start_dt = None
            try:
                start_dt = datetime.strptime(date_line, "%d %b %Y, %H:%M")
            except ValueError:
                start_dt = None

            presets.append({
                "name": name,
                "courseId": course_id,
                "date": date_line,
                "season": season_map.get(season_label),
                "ground": ground_map.get(ground_label),
                "weather": weather_map.get(weather_label),
                "time": 2,
                "distance_m": distance_m,
                "is_dirt": surface == 2,
                "season_label": season_label.title(),
                "weather_label": weather_label.title(),
                "time_label": "Night",
                "condition_label": ground_label.title(),
                "_start_dt": start_dt,
            })

        if not presets:
            logger.error("JP preset list parsed to 0 entries.")
        presets.sort(key=lambda item: item.get("_start_dt") or datetime.min, reverse=True)
        for item in presets:
            item.pop("_start_dt", None)
        return presets
    course_data = _load_course_data()

    if preset_source == "jp":
        presets = _build_static_jp_presets(course_data)
        logger.info(f"JP preset source selected: {len(presets)} presets")
        return {"presets": presets}

    for url in urls:
        try:
            req = Request(url, headers={"User-Agent": "ProjectBifrost/0.1"})
            text = urlopen(req, timeout=10).read().decode("utf-8")
            presets = _extract_presets(text)
            if presets:
                enriched = []
                total = len(presets)
                for index, preset in enumerate(presets):
                    course_id = preset.get("courseId")
                    course_info = course_data.get(str(course_id)) if course_id is not None else None
                    distance_m = None
                    is_dirt = None
                    if course_info:
                        distance_m = course_info.get("distance")
                        surface = course_info.get("surface")
                        is_dirt = surface == 2
                    season_value = preset.get("season")
                    weather_value = preset.get("weather")
                    time_value = preset.get("time")
                    condition_value = preset.get("ground")
                    season_map = {
                        1: "Spring",
                        2: "Summer",
                        3: "Autumn",
                        4: "Winter",
                    }
                    weather_map = {
                        0: "Sunny",
                        1: "Cloudy",
                        2: "Rainy",
                        3: "Snowy",
                        4: "Snowy",
                    }
                    time_map = {
                        0: "Daytime",
                        1: "Evening",
                        2: "Night",
                    }
                    condition_map = {
                        1: "Firm",
                        2: "Good",
                        3: "Soft",
                        4: "Heavy",
                    }
                    enriched.append({
                        "name": preset.get("name"),
                        "courseId": course_id,
                        "date": preset.get("date"),
                        "season": preset.get("season"),
                        "ground": preset.get("ground"),
                        "weather": preset.get("weather"),
                        "time": preset.get("time"),
                        "distance_m": distance_m,
                        "is_dirt": is_dirt,
                        "season_label": season_map.get(season_value),
                        "weather_label": weather_map.get(weather_value),
                        "time_label": time_map.get(time_value),
                        "condition_label": condition_map.get(condition_value),
                    })
                return {"presets": enriched}
        except Exception as e:
            logger.error(f"Failed to fetch Umalator presets from {url}: {e}")
            continue
    if preset_source == "auto":
        presets = _build_static_jp_presets(course_data)
        logger.info(f"Auto preset fallback selected: {len(presets)} presets")
        return {"presets": presets}
    return {"presets": []}


@app.get("/api/course-set/{course_set_id}")
async def get_course_set(course_set_id: int):
    """Get course set info for a given course_set_id."""
    info = mdb_utils.get_course_set_info(course_set_id)
    if not info:
        return {}
    return info


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket endpoint for live updates."""
    await ws.accept()
    connected_clients.add(ws)
    logger.info(f"WebSocket client connected. Total: {len(connected_clients)}")

    try:
        # Send initial state
        await ws.send_json({"type": "state", "data": game_state.to_dict()})

        # Keep connection alive and handle incoming messages
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
                if msg == "ping":
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send keepalive
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        connected_clients.discard(ws)
        logger.info(f"WebSocket client disconnected. Total: {len(connected_clients)}")


async def broadcast_state():
    """Broadcast current state to all connected clients."""
    if not connected_clients:
        return

    msg = {"type": "state", "data": game_state.to_dict()}
    dead = set()

    for ws in connected_clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)

    connected_clients.difference_update(dead)
