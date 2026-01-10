"""UDP listener for CarrotBlender data."""
import socket
import asyncio
import io
import json
import msgpack
from msgpack import Unpacker
from Cryptodome.Cipher import AES
from loguru import logger
from typing import Callable, Optional

from .models import game_state
from . import veteran_utils
from . import mdb_utils

SPECIAL_BANNER_MAP = {
    10001: 9020,
    10002: 9010,
    10003: 9001,
}

BANNER_OVERRIDE_MAP = {
    9392: 9002,  # Junior Make Debut uses 9002 banner on Gametora (race_id)
    1068: 9002,  # Junior Make Debut program_id override
}


class CarrotBlenderListener:
    """Listens for CarrotBlender UDP packets and decrypts them."""

    MSG_ENCRYPTED = 0
    MSG_KEY = 1
    MSG_IV = 2
    MSG_REQUEST = 3
    MSG_MULTIPART_HEADER = 4
    MSG_MULTIPART_CHUNK = 5

    def __init__(self, host: str, port: int, max_buffer: int = 65535):
        self.host = host
        self.port = port
        self.max_buffer = max_buffer
        self.sock: Optional[socket.socket] = None
        self.running = False

        # Crypto state
        self._key: Optional[bytes] = None
        self._iv: Optional[bytes] = None
        self._encrypted_data: Optional[bytes] = None

        # Multipart state
        self._chunks_left: int = 0

        # Callback for parsed data
        self.on_data: Optional[Callable[[dict, str], None]] = None
        from .config import STATE_CACHE_PATH
        self._cache_path = STATE_CACHE_PATH

    def start(self) -> None:
        """Bind UDP socket."""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((self.host, self.port))
        self.sock.setblocking(False)
        self.running = True
        game_state.connected = True
        logger.info(f"UDP listener started on {self.host}:{self.port}")

    def stop(self) -> None:
        """Close socket."""
        self.running = False
        game_state.connected = False
        if self.sock:
            self.sock.close()
            self.sock = None
        logger.info("UDP listener stopped")

    async def listen(self) -> None:
        """Main listen loop (async)."""
        if not self.sock:
            self.start()

        loop = asyncio.get_event_loop()
        while self.running:
            try:
                data = await loop.sock_recv(self.sock, self.max_buffer)
                if data:
                    self._handle_packet(data)
            except BlockingIOError:
                await asyncio.sleep(0.01)
            except Exception as e:
                logger.error(f"UDP receive error: {e}")
                await asyncio.sleep(0.1)

    def _handle_packet(self, data: bytes) -> None:
        """Route packet by message type per CarrotBlender protocol."""
        if len(data) < 2:
            logger.warning(f"Invalid packet: too short ({len(data)} bytes)")
            return

        msg_type = data[0]

        # Multipart header has no length bytes
        if msg_type == self.MSG_MULTIPART_HEADER:
            self._chunks_left = data[1]
            self._encrypted_data = b""
            logger.info(f"Multipart header: expecting {self._chunks_left} chunks")
            return

        # All other message types have 2-byte length at bytes 1-2
        if len(data) < 3:
            logger.warning("Invalid packet: too short for length header")
            return

        msg_len = data[1] * 256 + data[2]
        if len(data) < msg_len + 3:
            logger.warning(f"Invalid packet: incomplete payload (have {len(data)}, need {msg_len + 3})")
            return

        message = data[3:msg_len + 3]

        if msg_type == self.MSG_ENCRYPTED:
            self._encrypted_data = message
            logger.info(f"Received encrypted data: {len(message)} bytes")

        elif msg_type == self.MSG_KEY:
            self._key = message
            logger.info(f"Received key: {len(message)} bytes")

        elif msg_type == self.MSG_IV:
            self._iv = message
            logger.info(f"Received IV: {len(message)} bytes")
            self._try_decrypt()

        elif msg_type == self.MSG_REQUEST:
            # Request: unencrypted msgpack, skip first 4 bytes of payload
            logger.info(f"Received request: {len(message)} bytes")
            if len(message) > 4:
                self._parse_msgpack(message[4:], "request")

        elif msg_type == self.MSG_MULTIPART_CHUNK:
            if self._chunks_left < 1:
                logger.error("Unexpected multipart chunk (no header received)")
                return
            self._chunks_left -= 1
            self._encrypted_data = (self._encrypted_data or b"") + message
            logger.info(f"Multipart chunk: {len(message)} bytes, {self._chunks_left} remaining")

        else:
            logger.warning(f"Unknown message type: {msg_type}")

    def _try_decrypt(self) -> None:
        """Attempt AES-CBC decryption if we have all parts."""
        if not all([self._key, self._iv, self._encrypted_data]):
            logger.warning("Cannot decrypt: missing key, IV, or data")
            return

        if self._encrypted_data == b"":
            logger.warning("Cannot decrypt: empty data")
            self._reset_crypto_state()
            return

        try:
            cipher = AES.new(self._key, AES.MODE_CBC, self._iv)
            decrypted = cipher.decrypt(self._encrypted_data)
            # Drop first 4 bytes per CarrotBlender protocol
            decrypted = decrypted[4:]
            logger.info(f"Decrypted {len(decrypted)} bytes")
            self._parse_msgpack(decrypted, "response")
        except Exception as e:
            logger.error(f"Decrypt failed: {e}")
        finally:
            self._reset_crypto_state()

    def _reset_crypto_state(self) -> None:
        """Reset crypto state after decrypt attempt."""
        self._key = None
        self._iv = None
        self._encrypted_data = None

    def _parse_msgpack(self, data: bytes, packet_type: str) -> None:
        """Parse msgpack using streaming Unpacker to handle trailing bytes."""
        try:
            # Use streaming unpacker like UmaLauncher does
            stream = io.BytesIO(data)
            unpacker = Unpacker(stream, raw=False, strict_map_key=False)
            parsed = unpacker.unpack()

            # Log remaining bytes if any
            remaining = len(data) - stream.tell()
            if remaining > 0:
                logger.debug(f"Msgpack had {remaining} trailing bytes (ignored)")

            logger.info(f"Parsed {packet_type}: {type(parsed).__name__}")

            game_state.last_packet_type = packet_type
            game_state.raw_data = parsed if isinstance(parsed, dict) else {"data": parsed}

            # Extract training data if present
            self._extract_training_data(parsed)
            self._save_state_cache()

            if self.on_data:
                self.on_data(parsed, packet_type)

        except Exception as e:
            logger.error(f"Msgpack parse failed: {e}")

    def _save_state_cache(self) -> None:
        """Persist the latest game state to disk for reloads."""
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(
                json.dumps(game_state.to_dict(), indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.error(f"Failed to save state cache: {e}")

    def _extract_training_data(self, data: dict) -> None:
        """Extract training stats from parsed data."""
        if not isinstance(data, dict):
            return

        # Handle nested data structure (response has 'data' key)
        inner = data.get("data", data)
        if not isinstance(inner, dict):
            return

        # Misc/global data (common define + user info)
        misc_keys = ("common_define", "user_info", "tp_info", "rp_info", "coin_info")
        if any(key in inner for key in misc_keys):
            game_state.misc_data = {key: inner.get(key) for key in misc_keys if key in inner}

        # UmaLauncher: unpack single_mode_load_common into inner
        if "single_mode_load_common" in inner:
            for key, value in inner["single_mode_load_common"].items():
                inner[key] = value

        race_condition_map = {}
        race_conditions = inner.get("race_condition_array", [])
        if isinstance(race_conditions, list):
            for entry in race_conditions:
                if not isinstance(entry, dict):
                    continue
                key = (
                    entry.get("program_id")
                    or entry.get("race_program_id")
                    or entry.get("race_id")
                )
                if not key:
                    continue
                race_condition_map[key] = {
                    "season": entry.get("season"),
                    "weather": entry.get("weather"),
                    "ground_condition": entry.get("ground") or entry.get("ground_condition"),
                    "time_zone": entry.get("time_zone") or entry.get("timezone"),
                }

        # Look for chara_info (training data)
        chara_info = inner.get("chara_info")
        if chara_info and isinstance(chara_info, dict):
            game_state.in_training = True
            t = game_state.training
            t.stats.speed = chara_info.get("speed", t.stats.speed)
            t.stats.stamina = chara_info.get("stamina", t.stats.stamina)
            t.stats.power = chara_info.get("power", t.stats.power)
            t.stats.guts = chara_info.get("guts", t.stats.guts)
            t.stats.wisdom = chara_info.get("wiz", t.stats.wisdom)
            t.stats.skill_pts = chara_info.get("skill_point", t.stats.skill_pts)
            t.stats.energy = chara_info.get("vital", t.stats.energy)
            t.stats.motivation = chara_info.get("motivation", t.stats.motivation)
            t.fans = chara_info.get("fans", t.fans)
            t.current_turn = chara_info.get("turn", t.current_turn)
            t.update_timestamp()
            logger.info(f"Stats: SPD={t.stats.speed} STA={t.stats.stamina} POW={t.stats.power} GUT={t.stats.guts} WIS={t.stats.wisdom}")
            self._extract_skills_data(inner)
            self._extract_race_objectives(chara_info, t.current_turn, race_condition_map)

        # Event choices (if present)
        choice_rewards = inner.get("choice_reward_array", [])
        if isinstance(choice_rewards, list) and choice_rewards:
            game_state.event_choices = choice_rewards
        else:
            game_state.event_choices = []

        # Veteran horses (if present)
        trained = inner.get("trained_chara_array", [])
        if isinstance(trained, list) and trained:
            items = veteran_utils.build_veteran_items(trained)
            game_state.veteran = items
            veteran_utils.save_cache(items)

        # Race agenda mapping (reserved races; deck_num 0 only)
        reserved = inner.get("reserved_race_array", [])
        agenda = []
        if isinstance(reserved, list):
            for deck in reserved:
                if deck.get("deck_num") != 0:
                    continue
                races = []
                for race in deck.get("race_array", []):
                    program_id = race.get("program_id")
                    program_info = mdb_utils.get_program_info(program_id) if program_id else None
                    race_name = program_info.get("race_name") if program_info else None
                    banner_url = None
                    race_id = program_info.get("race_id") if program_info else None
                    if program_id in BANNER_OVERRIDE_MAP:
                        race_id = BANNER_OVERRIDE_MAP[program_id]
                    elif race_id in BANNER_OVERRIDE_MAP:
                        race_id = BANNER_OVERRIDE_MAP[race_id]
                    if not race_id:
                        race_id = SPECIAL_BANNER_MAP.get(program_id)
                    if race_id:
                        banner_url = (
                            "https://gametora.com/images/umamusume/en/race_banners/"
                            f"thum_race_rt_000_{int(race_id):04d}_00.png"
                        )
                    grade_raw = program_info.get("grade") if program_info else None
                    grade_map = {
                        100: "G1",
                        200: "G2",
                        300: "G3",
                        400: "OP/Listed",
                        700: "Class",
                        800: "Maiden",
                        900: "Debut",
                        999: "Special",
                        1000: "Scenario",
                        0: "Special/Practice",
                    }
                    ground_raw = program_info.get("ground") if program_info else None
                    ground_map = {1: "Turf", 2: "Dirt"}
                    month = program_info.get("month") if program_info else None
                    half = program_info.get("half") if program_info else None
                    timing = None
                    if month and half:
                        timing = f"M{month} {'Early' if half == 1 else 'Late'}"
                    year = race.get("year")
                    turn = None
                    if year and month and half:
                        turn = (int(year) - 1) * 24 + (int(month) - 1) * 2 + (2 if int(half) == 2 else 1)
                    track_name = program_info.get("track_name") if program_info else None
                    inout_raw = program_info.get("inout") if program_info else None
                    course = None
                    if inout_raw in (1, 3):
                        course = "Inner"
                    elif inout_raw in (2, 4):
                        course = "Outer"
                    turn_raw = program_info.get("turn") if program_info else None
                    direction = None
                    if turn_raw == 1:
                        direction = "Clockwise"
                    elif turn_raw == 2:
                        direction = "Counterclockwise"
                    elif turn_raw == 4:
                        direction = "Straight"
                    distance_m = program_info.get("distance_m") if program_info else None
                    distance_type = None
                    if distance_m:
                        if distance_m <= 1400:
                            distance_type = "Sprint"
                        elif distance_m <= 1800:
                            distance_type = "Mile"
                        elif distance_m <= 2400:
                            distance_type = "Medium"
                        else:
                            distance_type = "Long"
                    race_conditions = race_condition_map.get(program_id, {})
                    races.append({
                        "year": race.get("year"),
                        "program_id": program_id,
                        "name": race_name,
                        "banner_url": banner_url,
                        "race_id": race_id,
                        "turn": turn,
                        "month": program_info.get("month") if program_info else None,
                        "half": program_info.get("half") if program_info else None,
                        "need_fans": program_info.get("need_fans") if program_info else None,
                        "grade": grade_raw,
                        "grade_label": grade_map.get(grade_raw),
                        "distance_m": distance_m,
                        "ground": ground_raw,
                        "ground_label": ground_map.get(ground_raw),
                        "timing": timing,
                        "course_set": program_info.get("course_set") if program_info else None,
                        "track_name": track_name,
                        "course": course,
                        "direction": direction,
                        "distance_type": distance_type,
                        "season": race_conditions.get("season"),
                        "weather": race_conditions.get("weather"),
                        "ground_condition": race_conditions.get("ground_condition"),
                        "time_zone": race_conditions.get("time_zone"),
                    })
                agenda.append({
                    "deck_num": deck.get("deck_num"),
                    "deck_name": deck.get("deck_name"),
                    "race_array": races,
                })
        if agenda:
            game_state.race_agenda = agenda
            self._build_race_combined()

    def _extract_skills_data(self, inner: dict) -> None:
        """Extract skills, aptitudes, running style, and supporter data."""
        chara_info = inner.get("chara_info")
        if not isinstance(chara_info, dict):
            return

        def rank(value: int) -> str:
            rank_map = {1: "G", 2: "F", 3: "E", 4: "D", 5: "C", 6: "B", 7: "A", 8: "S"}
            return rank_map.get(int(value), "?")

        style_map = {1: "Front", 2: "Pace", 3: "Late", 4: "End"}

        # Skills and tips
        skills = []
        for entry in chara_info.get("skill_array", []):
            skill_id = entry.get("skill_id")
            name = mdb_utils.get_skill_name(skill_id) if skill_id else None
            icon_id = mdb_utils.get_skill_icon_id(skill_id) if skill_id else None
            skills.append({
                "id": skill_id,
                "name": name or f"Skill {skill_id}",
                "level": entry.get("level", 1),
                "icon_url": f"https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_{icon_id}.png" if icon_id else None,
            })

        skill_tips = []
        for entry in chara_info.get("skill_tips_array", []):
            group_id = entry.get("group_id")
            rarity = entry.get("rarity")
            name = mdb_utils.get_skill_hint_name(group_id, rarity) if group_id and rarity is not None else None
            icon_id = mdb_utils.get_skill_hint_icon_id(group_id, rarity) if group_id and rarity is not None else None
            skill_tips.append({
                "group_id": group_id,
                "rarity": rarity,
                "name": name or f"Tip {group_id}",
                "level": entry.get("level", 1),
                "icon_url": f"https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_{icon_id}.png" if icon_id else None,
            })

        # Running style and aptitudes
        running_style = style_map.get(chara_info.get("race_running_style"), "Unknown")
        aptitudes = {
            "track": {
                "Turf": rank(chara_info.get("proper_ground_turf", 0)),
                "Dirt": rank(chara_info.get("proper_ground_dirt", 0)),
            },
            "distance": {
                "Sprint": rank(chara_info.get("proper_distance_short", 0)),
                "Mile": rank(chara_info.get("proper_distance_mile", 0)),
                "Medium": rank(chara_info.get("proper_distance_middle", 0)),
                "Long": rank(chara_info.get("proper_distance_long", 0)),
            },
            "style": {
                "Front": rank(chara_info.get("proper_running_style_nige", 0)),
                "Pace": rank(chara_info.get("proper_running_style_senko", 0)),
                "Late": rank(chara_info.get("proper_running_style_sashi", 0)),
                "End": rank(chara_info.get("proper_running_style_oikomi", 0)),
            },
        }

        # Growth rates + identity
        card_id = chara_info.get("card_id")
        growth = mdb_utils.get_card_growth(card_id) if card_id else None
        chara_id = growth.get("chara_id") if growth else None
        chara_name = mdb_utils.get_chara_name(chara_id) if chara_id else None
        portrait_url = None
        portrait_fallback_url = None
        portrait_card_id = chara_info.get("chara_dress_id") or card_id
        if portrait_card_id:
            portrait_url = f"https://chronogenesis.net/images/trained_chara/{portrait_card_id}.png"
        if chara_id:
            portrait_fallback_url = f"https://gametora.com/images/umamusume/characters/icons/chr_icon_{chara_id}.png"

        growth_rates = None
        if growth:
            growth_rates = {
                "speed": growth.get("growth_speed", 0),
                "stamina": growth.get("growth_stamina", 0),
                "power": growth.get("growth_power", 0),
                "guts": growth.get("growth_guts", 0),
                "wit": growth.get("growth_wit", 0),
            }

        # Supporters with bond values
        eval_dict = {e.get("training_partner_id"): e.get("evaluation", 0)
                     for e in chara_info.get("evaluation_info_array", [])}
        supporters = []
        for card in chara_info.get("support_card_array", []):
            pos = card.get("position")
            support_id = card.get("support_card_id")
            support_chara_id = mdb_utils.get_support_chara_id(support_id) if support_id else None
            support_name = mdb_utils.get_chara_name(support_chara_id) if support_chara_id else None
            support_icon = None
            if support_chara_id:
                support_icon = f"https://gametora.com/images/umamusume/characters/icons/chr_icon_{support_chara_id}.png"
            support_type = mdb_utils.get_support_card_type(support_id) if support_id else None
            support_command_id = mdb_utils.get_support_card_command_id(support_id) if support_id else None
            supporters.append({
                "position": pos,
                "support_card_id": support_id,
                "support_card_type": support_type,
                "support_card_command_id": support_command_id,
                "chara_id": support_chara_id,
                "name": support_name or f"Support {support_id}",
                "bond": eval_dict.get(pos, 0),
                "icon_url": support_icon,
            })

        # Conditions: not in sample, keep as empty list or ids
        conditions = list(chara_info.get("chara_effect_id_array", []))

        game_state.skills_tab = {
            "chara_name": chara_name or "Unknown",
            "chara_id": chara_id,
            "card_id": card_id,
            "portrait_url": portrait_url,
            "portrait_fallback_url": portrait_fallback_url,
            "rarity": chara_info.get("rarity"),
            "talent_level": chara_info.get("talent_level"),
            "running_style": running_style,
            "aptitudes": aptitudes,
            "growth_rates": growth_rates,
            "skills": skills,
            "skill_tips": skill_tips,
            "conditions": conditions,
        }
        game_state.supporters = supporters

    def _extract_race_objectives(
        self,
        chara_info: dict,
        current_turn: int,
        race_condition_map: dict,
    ) -> None:
        """Extract default route objectives and filter by turn."""
        card_id = chara_info.get("card_id")
        growth = mdb_utils.get_card_growth(card_id) if card_id else None
        chara_id = growth.get("chara_id") if growth else None
        if not chara_id:
            game_state.race_objectives = []
            return

        objectives = mdb_utils.get_route_objectives(chara_id)
        if not objectives:
            game_state.race_objectives = []
            return

        grade_map = {
            100: "G1",
            200: "G2",
            300: "G3",
            400: "OP/Listed",
            700: "Class",
            800: "Maiden",
            900: "Debut",
            999: "Special",
            1000: "Scenario",
            0: "Special/Practice",
        }
        ground_map = {1: "Turf", 2: "Dirt"}

        filtered = []
        for obj in objectives:
            turn = obj.get("turn")
            if turn and current_turn and turn <= current_turn:
                continue
            program_id = obj.get("program_id")
            if not program_id:
                continue
            program_info = mdb_utils.get_program_info(program_id)
            race_name = program_info.get("race_name") if program_info else None
            race_id = program_info.get("race_id") if program_info else None
            banner_url = None
            if program_id in BANNER_OVERRIDE_MAP:
                race_id = BANNER_OVERRIDE_MAP[program_id]
            elif race_id in BANNER_OVERRIDE_MAP:
                race_id = BANNER_OVERRIDE_MAP[race_id]
            if not race_id:
                race_id = SPECIAL_BANNER_MAP.get(program_id)
            if race_id:
                banner_url = (
                    "https://gametora.com/images/umamusume/en/race_banners/"
                    f"thum_race_rt_000_{int(race_id):04d}_00.png"
                )

            requirement = None
            place_req = obj.get("condition_value_1")
            if place_req is None or place_req == 0:
                requirement = "Participate"
            elif place_req == 1:
                requirement = "Place 1st"
            else:
                requirement = f"Place {place_req}th or better"

            grade_raw = program_info.get("grade") if program_info else None
            ground_raw = program_info.get("ground") if program_info else None
            month = program_info.get("month") if program_info else None
            half = program_info.get("half") if program_info else None
            timing = None
            if month and half:
                timing = f"M{month} {'Early' if half == 1 else 'Late'}"
            track_name = program_info.get("track_name") if program_info else None
            inout_raw = program_info.get("inout") if program_info else None
            course = None
            if inout_raw in (1, 3):
                course = "Inner"
            elif inout_raw in (2, 4):
                course = "Outer"
            turn_raw = program_info.get("turn") if program_info else None
            direction = None
            if turn_raw == 1:
                direction = "Clockwise"
            elif turn_raw == 2:
                direction = "Counterclockwise"
            elif turn_raw == 4:
                direction = "Straight"
            distance_m = program_info.get("distance_m") if program_info else None
            distance_type = None
            if distance_m:
                if distance_m <= 1400:
                    distance_type = "Sprint"
                elif distance_m <= 1800:
                    distance_type = "Mile"
                elif distance_m <= 2400:
                    distance_type = "Medium"
                else:
                    distance_type = "Long"
            race_conditions = race_condition_map.get(program_id, {})

            filtered.append({
                "turn": turn,
                "program_id": program_id,
                "name": race_name,
                "banner_url": banner_url,
                "requirement": requirement,
                "race_id": race_id,
                "month": month,
                "half": half,
                "timing": timing,
                "need_fans": program_info.get("need_fans") if program_info else None,
                "grade": grade_raw,
                "grade_label": grade_map.get(grade_raw),
                "distance_m": distance_m,
                "ground": ground_raw,
                "ground_label": ground_map.get(ground_raw),
                "course_set": program_info.get("course_set") if program_info else None,
                "track_name": track_name,
                "course": course,
                "direction": direction,
                "distance_type": distance_type,
                "season": race_conditions.get("season"),
                "weather": race_conditions.get("weather"),
                "ground_condition": race_conditions.get("ground_condition"),
                "time_zone": race_conditions.get("time_zone"),
            })

        game_state.race_objectives = filtered
        self._build_race_combined()

    def _build_race_combined(self) -> None:
        combined = []
        for obj in game_state.race_objectives:
            item = dict(obj)
            item["kind"] = "objective"
            combined.append(item)
        for deck in game_state.race_agenda:
            for race in deck.get("race_array", []):
                item = dict(race)
                item["kind"] = "agenda"
                combined.append(item)
        game_state.race_combined = combined
