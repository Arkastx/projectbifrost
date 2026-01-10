"""Helpers for veteran horse data extraction and caching."""
from __future__ import annotations

import json
from typing import List, Dict

from . import constants
from .config import VETERAN_CACHE_PATH
from . import mdb_utils


CACHE_PATH = VETERAN_CACHE_PATH


def _rank(value: int) -> str:
    return constants.APTITUDE_RANK.get(int(value), "?")


def _horse_rank(value: int) -> str:
    return constants.HORSE_RANK.get(int(value), "?")



def build_veteran_items(trained_array: List[dict]) -> List[Dict]:
    items: List[Dict] = []
    for entry in trained_array:
        card_id = entry.get("card_id")
        growth = mdb_utils.get_card_growth(card_id) if card_id else None
        chara_id = growth.get("chara_id") if growth else None
        chara_name = mdb_utils.get_chara_name(chara_id) if chara_id else None
        portrait_url = None
        portrait_fallback_url = None
        portrait_card_id = (
            entry.get("race_cloth_id")
            or entry.get("chara_dress_id")
            or entry.get("dress_id")
            or card_id
        )
        if portrait_card_id:
            portrait_url = f"https://chronogenesis.net/images/trained_chara/{portrait_card_id}.png"
        if chara_id:
            portrait_fallback_url = (
                f"https://gametora.com/images/umamusume/characters/icons/chr_icon_{chara_id}.png"
            )

        card_text = mdb_utils.get_card_text(card_id) if card_id else None
        title = card_text.get("title") if card_text else None
        full_name = card_text.get("full_name") if card_text else None
        subtitle = None

        skill_array = entry.get("skill_array", [])
        factor_ids = entry.get("factor_id_array", []) or []
        distance_stars = 0
        track_stars = 0
        unique_stars = 0
        skill_stars = 0
        total_sparks = 0
        for factor_id in factor_ids:
            info = mdb_utils.get_succession_factor(factor_id)
            if not info:
                continue
            rarity = int(info.get("rarity") or 0)
            total_sparks += rarity
            factor_type = info.get("factor_type")
            group_id = info.get("group_id")
            if factor_type == 2:
                if group_id in (21, 22, 23, 24):
                    distance_stars += rarity
                elif group_id in (11, 12):
                    track_stars += rarity
            elif factor_type == 3:
                unique_stars += rarity
            elif factor_type == 4:
                skill_stars += rarity

        items.append({
            "trained_chara_id": entry.get("trained_chara_id"),
            "card_id": card_id,
            "chara_id": chara_id,
            "name": chara_name or f"Chara {chara_id}",
            "title": title,
            "subtitle": subtitle,
            "full_name": full_name,
            "portrait_url": portrait_url,
            "portrait_fallback_url": portrait_fallback_url,
            "portrait_card_id": portrait_card_id,
            "race_cloth_id": entry.get("race_cloth_id"),
            "is_locked": entry.get("is_locked", 0),
            "rank_score": entry.get("rank_score", 0),
            "rank": entry.get("rank", 0),
            "rank_label": _horse_rank(entry.get("rank", 0)),
            "skill_count": len(skill_array),
            "fans": entry.get("fans", 0),
            "legacy_sparks": {
                "distance": distance_stars,
                "track": track_stars,
                "unique": unique_stars,
                "skill": skill_stars,
                "total": total_sparks,
            },
            "stats": {
                "speed": entry.get("speed", 0),
                "stamina": entry.get("stamina", 0),
                "power": entry.get("power", 0),
                "guts": entry.get("guts", 0),
                "wit": entry.get("wiz", 0),
            },
            "running_style": constants.RUNNING_STYLE.get(entry.get("running_style"), "Unknown"),
            "aptitudes": {
                "track": {
                    "Turf": _rank(entry.get("proper_ground_turf", 0)),
                    "Dirt": _rank(entry.get("proper_ground_dirt", 0)),
                },
                "distance": {
                    "Sprint": _rank(entry.get("proper_distance_short", 0)),
                    "Mile": _rank(entry.get("proper_distance_mile", 0)),
                    "Medium": _rank(entry.get("proper_distance_middle", 0)),
                    "Long": _rank(entry.get("proper_distance_long", 0)),
                },
                "style": {
                    "Front": _rank(entry.get("proper_running_style_nige", 0)),
                    "Pace": _rank(entry.get("proper_running_style_senko", 0)),
                    "Late": _rank(entry.get("proper_running_style_sashi", 0)),
                    "End": _rank(entry.get("proper_running_style_oikomi", 0)),
                },
            },
            "skills": [
                {
                    "id": s.get("skill_id"),
                    "name": mdb_utils.get_skill_name(s.get("skill_id")) or f"Skill {s.get('skill_id')}",
                    "level": s.get("level", 1),
                    "icon_url": (
                        f"https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_{mdb_utils.get_skill_icon_id(s.get('skill_id'))}.png"
                        if mdb_utils.get_skill_icon_id(s.get("skill_id"))
                        else None
                    ),
                }
                for s in entry.get("skill_array", [])
            ],
        })
    return items


def save_cache(items: List[Dict]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")


def load_cache() -> List[Dict]:
    if not CACHE_PATH.exists():
        return []
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("items", [])
        for item in items:
            chara_id = item.get("chara_id")
            portrait_card_id = (
                item.get("portrait_card_id")
                or item.get("race_cloth_id")
                or item.get("chara_dress_id")
                or item.get("dress_id")
                or item.get("card_id")
            )
            if portrait_card_id:
                item["portrait_url"] = f"https://chronogenesis.net/images/trained_chara/{portrait_card_id}.png"
            if chara_id:
                item["portrait_fallback_url"] = (
                    f"https://gametora.com/images/umamusume/characters/icons/chr_icon_{chara_id}.png"
                )
            if item.get("card_id"):
                card_text = mdb_utils.get_card_text(item.get("card_id"))
                item["title"] = card_text.get("title") if card_text else None
                item["full_name"] = card_text.get("full_name") if card_text else None
                item["subtitle"] = item.get("subtitle")
            if "rank" in item:
                item["rank_label"] = _horse_rank(item.get("rank", 0))
            if item.get("skills"):
                for skill in item["skills"]:
                    if not skill.get("icon_url") and skill.get("id"):
                        icon_id = mdb_utils.get_skill_icon_id(skill.get("id"))
                        if icon_id:
                            skill["icon_url"] = (
                                f"https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_{icon_id}.png"
                            )
            item.setdefault("is_locked", 0)
            item.setdefault("legacy_sparks", {
                "distance": 0,
                "track": 0,
                "unique": 0,
                "skill": 0,
                "total": 0,
            })
        return items
    except Exception:
        return []
