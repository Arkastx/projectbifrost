"""FastAPI server with WebSocket for live UI updates."""
import asyncio
import json
import re
from urllib.request import urlopen, Request
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from .models import game_state
from . import veteran_utils, mdb_utils, window_utils
from .config import VETERAN_SELECTION_PATH, load_config, save_config

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
    for key in ("udp_host", "udp_port", "web_host", "web_port", "max_buffer_size", "log_level", "calculator"):
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




@app.get("/api/umalator-presets")
async def get_umalator_presets():
    """Fetch Umalator preset list from bundle.js (alpha123 or GitHub fallback)."""
    urls = [
        "https://alpha123.github.io/uma-tools/umalator-global/bundle.js",
        "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/bundle.js",
    ]
    course_urls = [
        "https://alpha123.github.io/uma-tools/umalator-global/course_data.json",
        "https://raw.githubusercontent.com/alpha123/uma-tools/master/umalator-global/course_data.json",
    ]

    def _extract_presets(text: str) -> list:
        start = text.find("var ci=")
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

    headers = {"User-Agent": "ProjectBifrost/0.1"}
    course_data = {}
    for url in course_urls:
        try:
            req = Request(url, headers=headers)
            course_data = json.loads(urlopen(req, timeout=10).read().decode("utf-8"))
            if course_data:
                break
        except Exception as e:
            logger.error(f"Failed to fetch course data from {url}: {e}")
            continue

    for url in urls:
        try:
            req = Request(url, headers=headers)
            text = urlopen(req, timeout=10).read().decode("utf-8")
            presets = _extract_presets(text)
            if presets:
                enriched = []
                for preset in presets:
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


async def state_broadcaster():
    """Background task to broadcast state periodically."""
    while True:
        await broadcast_state()
        await asyncio.sleep(0.5)  # 2 updates per second
