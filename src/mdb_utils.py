"""MDB lookup helpers for skills, names, and growth rates."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Dict, Tuple, Optional


_LOCAL_DB_PATH = Path(__file__).parent.parent / "data" / "master.mdb"
_APPDATA_DB_PATHS = [
    Path(os.path.expandvars(r"%userprofile%\AppData\LocalLow\Cygames\Umamusume\master\master.mdb")),
    Path(os.path.expandvars(r"%userprofile%\AppData\LocalLow\Cygames\UmamusumePrettyDerby_Jpn\master\master.mdb")),
    Path(os.path.expandvars(r"%userprofile%\AppData\LocalLow\Cygames\umamusume\master\master.mdb")),
]


def _resolve_db_path() -> Path:
    if _LOCAL_DB_PATH.exists():
        return _LOCAL_DB_PATH
    for candidate in _APPDATA_DB_PATHS:
        if candidate.exists():
            return candidate
    return _LOCAL_DB_PATH

_skill_name_dict: Dict[int, str] = {}
_skill_icon_dict: Dict[int, int] = {}
_skill_hint_name_dict: Dict[Tuple[int, int], str] = {}
_skill_hint_icon_dict: Dict[Tuple[int, int], int] = {}
_skill_hint_id_dict: Dict[Tuple[int, int], int] = {}
_skill_hint_rate_dict: Dict[Tuple[int, int], int] = {}
_skill_meta_dict: Dict[int, dict] = {}
_chara_name_dict: Dict[int, str] = {}
_support_card_chara_dict: Dict[int, int] = {}
_support_card_type_dict: Dict[int, int] = {}
_support_card_command_dict: Dict[int, int] = {}
_card_growth_dict: Dict[int, dict] = {}
_card_text_dict: Dict[int, dict] = {}
_dress_title_dict: Dict[int, str] = {}
_program_info_dict: Dict[int, dict] = {}
_track_name_dict: Dict[int, str] = {}
_track_name_norm_dict: Dict[str, int] = {}
_route_objectives_dict: Dict[int, list] = {}
_succession_factor_dict: Dict[int, dict] = {}
_course_set_dict: Dict[int, dict] = {}
_card_skill_set_dict: Dict[int, Optional[int]] = {}
_available_skill_set_dict: Dict[int, list] = {}
_skill_need_point_dict: Dict[int, int] = {}


def _connect() -> sqlite3.Connection:
    return sqlite3.connect(_resolve_db_path())


def _load_skill_names() -> None:
    if _skill_name_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT sd.id, sd.icon_id, td.text
               FROM skill_data sd
               INNER JOIN text_data td
                 ON sd.id = td."index"
                AND td.category = 47"""
        )
        for skill_id, icon_id, name in cur.fetchall():
            _skill_name_dict[skill_id] = name
            _skill_icon_dict[skill_id] = icon_id


def _load_skill_meta() -> None:
    if _skill_meta_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT id, rarity, skill_category, group_id
               FROM skill_data"""
        )
        for skill_id, rarity, skill_category, group_id in cur.fetchall():
            _skill_meta_dict[skill_id] = {
                "rarity": rarity,
                "skill_category": skill_category,
                "group_id": group_id,
            }


def _load_skill_hint_names() -> None:
    if _skill_hint_name_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT sd.id, sd.group_id, sd.rarity, sd.icon_id, sd.group_rate, td.text
               FROM skill_data sd
               INNER JOIN text_data td
                 ON sd.id = td."index"
                AND td.category = 47
               ORDER BY sd.id ASC"""
        )
        for skill_id, group_id, rarity, icon_id, group_rate, name in cur.fetchall():
            key = (group_id, rarity)
            current = _skill_hint_id_dict.get(key)
            if current is not None:
                existing_rate = _skill_hint_rate_dict.get(key)
                if existing_rate is not None:
                    # Prefer group_rate == 1 (single-circle). Avoid negative group_rate unless no choice.
                    if existing_rate == 1:
                        continue
                    if group_rate == 1:
                        pass
                    elif existing_rate is not None and existing_rate >= 0 and group_rate < 0:
                        continue
                    elif existing_rate is not None and existing_rate < 0 and group_rate >= 0:
                        pass
                    else:
                        continue
            _skill_hint_name_dict[key] = name
            _skill_hint_icon_dict[key] = icon_id
            _skill_hint_id_dict[key] = skill_id
            _skill_hint_rate_dict[key] = group_rate


def _load_chara_names() -> None:
    if _chara_name_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute("""SELECT "index", text FROM text_data WHERE category = 170""")
        for chara_id, name in cur.fetchall():
            _chara_name_dict[chara_id] = name


def _load_support_card_chara() -> None:
    if _support_card_chara_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute("""SELECT id, chara_id FROM support_card_data""")
        for support_card_id, chara_id in cur.fetchall():
            _support_card_chara_dict[support_card_id] = chara_id


def _load_support_card_meta() -> None:
    if _support_card_type_dict and _support_card_command_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute("""SELECT id, support_card_type, command_id FROM support_card_data""")
        for support_card_id, support_type, command_id in cur.fetchall():
            _support_card_type_dict[support_card_id] = support_type
            _support_card_command_dict[support_card_id] = command_id


def _load_card_growth(card_id: int) -> Optional[dict]:
    if card_id in _card_growth_dict:
        return _card_growth_dict[card_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT chara_id, default_rarity, talent_speed, talent_stamina,
                      talent_pow, talent_guts, talent_wiz, available_skill_set_id
               FROM card_data WHERE id = ? LIMIT 1""",
            (card_id,),
        )
        row = cur.fetchone()
    if not row:
        _card_growth_dict[card_id] = None
        return None
    growth = {
        "chara_id": row[0],
        "rarity": row[1],
        "growth_speed": row[2],
        "growth_stamina": row[3],
        "growth_power": row[4],
        "growth_guts": row[5],
        "growth_wit": row[6],
        "available_skill_set_id": row[7],
    }
    _card_growth_dict[card_id] = growth
    return growth


def _load_card_skill_set(card_id: int) -> Optional[int]:
    if card_id in _card_skill_set_dict:
        return _card_skill_set_dict[card_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT available_skill_set_id
               FROM card_data
               WHERE id = ? LIMIT 1""",
            (card_id,),
        )
        row = cur.fetchone()
    value = row[0] if row else None
    _card_skill_set_dict[card_id] = value
    return value


def _load_available_skill_set(available_skill_set_id: int) -> list:
    if available_skill_set_id in _available_skill_set_dict:
        return _available_skill_set_dict[available_skill_set_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT skill_id, need_rank
               FROM available_skill_set
               WHERE available_skill_set_id = ?
               ORDER BY need_rank, skill_id""",
            (available_skill_set_id,),
        )
        rows = cur.fetchall()
    skills = [{"skill_id": row[0], "need_rank": row[1]} for row in rows]
    _available_skill_set_dict[available_skill_set_id] = skills
    return skills


def _load_card_text(card_id: int) -> Optional[dict]:
    if card_id in _card_text_dict:
        return _card_text_dict[card_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT category, text
               FROM text_data
               WHERE "index" = ?
                 AND category IN (4, 5)""",
            (card_id,),
        )
        title = None
        full_name = None
        for category, text in cur.fetchall():
            if category == 4:
                full_name = text
            elif category == 5:
                title = text
        if title and title.startswith("[") and title.endswith("]"):
            title = title[1:-1]
        if not title and full_name:
            if full_name.startswith("[") and "]" in full_name:
                title = full_name[1:full_name.index("]")]
        _card_text_dict[card_id] = {
            "title": title,
            "full_name": full_name,
        }
        return _card_text_dict[card_id]


def _load_dress_title(dress_id: int) -> Optional[str]:
    if dress_id in _dress_title_dict:
        return _dress_title_dict[dress_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT text
               FROM text_data
               WHERE "index" = ?
                 AND category = 14""",
            (dress_id,),
        )
        row = cur.fetchone()
        _dress_title_dict[dress_id] = row[0] if row else None
        return _dress_title_dict[dress_id]


def _load_program_info() -> None:
    if _program_info_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT smp.id, td.text
               , smp.month, smp.half, smp.need_fan_count
               , ri.race_id
               , r.grade
               , r.course_set
               , cs.distance, cs.ground, cs.race_track_id, cs.inout, cs.turn
               , cs.course_set_status_id
               , td_track.text
               FROM single_mode_program smp
               INNER JOIN race_instance ri
                 ON smp.race_instance_id = ri.id
               INNER JOIN race r
                 ON r.id = ri.race_id
               INNER JOIN race_course_set cs
                 ON cs.id = r.course_set
               LEFT JOIN text_data td
                 ON td."index" = ri.race_id
                AND td.category = 32
               LEFT JOIN text_data td_track
                 ON td_track."index" = cs.race_track_id
                AND td_track.category = 31"""
        )
        for row in cur.fetchall():
            (program_id, name, month, half, need_fans, race_id,
             grade, course_set, distance, ground, race_track_id, inout, turn,
             course_set_status_id, track_name) = row
            _program_info_dict[program_id] = {
                "race_id": race_id,
                "race_name": name,
                "month": month,
                "half": half,
                "need_fans": need_fans,
                "grade": grade,
                "course_set": course_set,
                "distance_m": distance,
                "ground": ground,
                "race_track_id": race_track_id,
                "track_name": track_name,
                "inout": inout,
                "turn": turn,
                "course_set_status_id": course_set_status_id,
            }


def _load_track_names() -> None:
    if _track_name_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute("""SELECT "index", text FROM text_data WHERE category = 31""")
        for track_id, name in cur.fetchall():
            _track_name_dict[int(track_id)] = name
            normalized = _normalize_track_name(name)
            if normalized:
                _track_name_norm_dict[normalized] = int(track_id)


def _normalize_track_name(name: str) -> str:
    value = name.lower().strip()
    for suffix in ("racecourse", "race course", "racetrack", "race track"):
        if value.endswith(suffix):
            value = value[: -len(suffix)].strip()
    value = value.replace(".", "").replace("-", " ").strip()
    value = " ".join(value.split())
    return value


def _load_succession_factors() -> None:
    if _succession_factor_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT factor_id, factor_group_id, rarity, factor_type
               FROM succession_factor"""
        )
        for factor_id, group_id, rarity, factor_type in cur.fetchall():
            _succession_factor_dict[factor_id] = {
                "group_id": group_id,
                "rarity": rarity,
                "factor_type": factor_type,
            }


def _load_course_sets() -> None:
    if _course_set_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT id, distance, ground
               FROM race_course_set"""
        )
        for course_set_id, distance, ground in cur.fetchall():
            _course_set_dict[int(course_set_id)] = {
                "distance_m": int(distance) if distance is not None else None,
                "ground": int(ground) if ground is not None else None,
            }


def _load_skill_need_points() -> None:
    if _skill_need_point_dict:
        return
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT id, need_skill_point
               FROM single_mode_skill_need_point"""
        )
        for skill_id, need_skill_point in cur.fetchall():
            _skill_need_point_dict[int(skill_id)] = int(need_skill_point)


def get_skill_name(skill_id: int) -> Optional[str]:
    _load_skill_names()
    return _skill_name_dict.get(skill_id)


def get_skill_icon_id(skill_id: int) -> Optional[int]:
    _load_skill_names()
    return _skill_icon_dict.get(skill_id)


def get_skill_hint_name(group_id: int, rarity: int) -> Optional[str]:
    _load_skill_hint_names()
    return _skill_hint_name_dict.get((group_id, rarity))


def get_skill_hint_icon_id(group_id: int, rarity: int) -> Optional[int]:
    _load_skill_hint_names()
    return _skill_hint_icon_dict.get((group_id, rarity))


def get_skill_hint_id(group_id: int, rarity: int) -> Optional[int]:
    _load_skill_hint_names()
    return _skill_hint_id_dict.get((group_id, rarity))


def get_skill_meta(skill_id: int) -> Optional[dict]:
    _load_skill_meta()
    return _skill_meta_dict.get(int(skill_id))


def get_skill_discount_rate(skill_id: int) -> Optional[float]:
    meta = get_skill_meta(skill_id)
    if not meta:
        return None
    rarity = meta.get("rarity")
    skill_category = meta.get("skill_category")
    if rarity == 2:
        return 0.0
    if skill_category == 5:
        return 0.10
    return 0.10


def get_hint_discount(skill_id: int, level: int) -> Optional[float]:
    """Return total discount rate for a hint level."""
    meta = get_skill_meta(skill_id)
    if not meta:
        return None
    level_map = {
        1: 0.10,
        2: 0.20,
        3: 0.30,
        4: 0.35,
        5: 0.40,
    }
    return level_map.get(int(level) if level is not None else 0, 0.0)


def get_chara_name(chara_id: int) -> Optional[str]:
    _load_chara_names()
    return _chara_name_dict.get(chara_id)


def get_support_chara_id(support_card_id: int) -> Optional[int]:
    _load_support_card_chara()
    return _support_card_chara_dict.get(support_card_id)


def get_support_card_type(support_card_id: int) -> Optional[int]:
    _load_support_card_meta()
    return _support_card_type_dict.get(support_card_id)


def get_support_card_command_id(support_card_id: int) -> Optional[int]:
    _load_support_card_meta()
    return _support_card_command_dict.get(support_card_id)


def get_card_growth(card_id: int) -> Optional[dict]:
    return _load_card_growth(card_id)


def get_card_text(card_id: int) -> Optional[dict]:
    return _load_card_text(card_id)


def get_dress_title(dress_id: int) -> Optional[str]:
    return _load_dress_title(dress_id)


def get_program_info(program_id: int) -> Optional[dict]:
    _load_program_info()
    return _program_info_dict.get(program_id)


def get_route_objectives(chara_id: int) -> list:
    if chara_id in _route_objectives_dict:
        return _route_objectives_dict[chara_id]
    with _connect() as con:
        cur = con.cursor()
        cur.execute(
            """SELECT race_set_id
               FROM single_mode_route
               WHERE chara_id = ?
               ORDER BY scenario_id ASC, priority DESC
               LIMIT 1""",
            (chara_id,),
        )
        row = cur.fetchone()
        if not row:
            _route_objectives_dict[chara_id] = []
            return []
        race_set_id = row[0]
        cur.execute(
            """SELECT id, turn, condition_type, condition_id, condition_value_1, condition_value_2, sort_id
               FROM single_mode_route_race
               WHERE race_set_id = ?
               ORDER BY turn, sort_id""",
            (race_set_id,),
        )
        items = []
        for obj in cur.fetchall():
            obj_id, turn, condition_type, condition_id, value1, value2, sort_id = obj
            items.append({
                "id": obj_id,
                "turn": turn,
                "condition_type": condition_type,
                "program_id": condition_id,
                "condition_value_1": value1,
                "condition_value_2": value2,
                "sort_id": sort_id,
            })
        _route_objectives_dict[chara_id] = items
        return items


def get_succession_factor(factor_id: int) -> Optional[dict]:
    _load_succession_factors()
    return _succession_factor_dict.get(factor_id)


def get_course_set_info(course_set_id: int) -> Optional[dict]:
    _load_course_sets()
    return _course_set_dict.get(course_set_id)


def get_race_track_id_by_name(name: str) -> Optional[int]:
    if not name:
        return None
    _load_track_names()
    normalized = _normalize_track_name(name)
    if normalized in _track_name_norm_dict:
        return _track_name_norm_dict[normalized]
    for key, track_id in _track_name_norm_dict.items():
        if key and key in normalized:
            return track_id
    return None


def get_available_skill_set_id(card_id: int) -> Optional[int]:
    return _load_card_skill_set(card_id)


def get_available_skills(available_skill_set_id: int) -> list:
    skills = _load_available_skill_set(available_skill_set_id)
    items = []
    for entry in skills:
        skill_id = entry.get("skill_id")
        if not skill_id:
            continue
        name = get_skill_name(skill_id)
        icon_id = get_skill_icon_id(skill_id)
        need_skill_point = get_skill_need_points(skill_id)
        items.append({
            "skill_id": skill_id,
            "need_rank": entry.get("need_rank", 0),
            "name": name,
            "icon_id": icon_id,
            "need_skill_point": need_skill_point,
        })
    return items


def get_skill_need_points(skill_id: int) -> Optional[int]:
    _load_skill_need_points()
    return _skill_need_point_dict.get(int(skill_id))
