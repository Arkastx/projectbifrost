"""Config and logging setup for Project Bifrost."""
import json
from pathlib import Path
import os
from loguru import logger
from datetime import datetime

PROJECT_DIR = Path(__file__).parent.parent
APPDATA_DIR = Path(os.environ.get("APPDATA", PROJECT_DIR))
APPDATA_PROJECT_DIR = APPDATA_DIR / "projectbifrost"
APPDATA_PROJECT_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_PATH = APPDATA_PROJECT_DIR / "settings.json"
LOG_PATH = APPDATA_PROJECT_DIR / "log.log"
STATE_CACHE_PATH = APPDATA_PROJECT_DIR / "last_state.json"
VETERAN_CACHE_PATH = APPDATA_PROJECT_DIR / "veteran_cache.json"
VETERAN_SELECTION_PATH = APPDATA_PROJECT_DIR / "veteran_selection.json"


DEFAULT_CONFIG = {
    "udp_host": "127.0.0.1",
    "udp_port": 17229,
    "web_host": "127.0.0.1",
    "web_port": 8080,
    "max_buffer_size": 262144,
    "log_level": "INFO",
    "preset_source": "global",
    "calculator": {
        "enabled": True,
        "weights": {
            "speed": 1,
            "stamina": 1,
            "power": 1,
            "guts": 1,
            "wit": 1,
            "skill_pts": 0.6,
            "bond": 0.4,
            "useful_bond": 0.6,
            "energy": -1,
            "fail": -2,
        },
        "thresholds": {
            "fail_pct": 20,
            "energy_min": 30,
            "useful_bond_min": 10,
        },
    },
}


def load_config() -> dict:
    """Load config from settings.json, create with defaults if missing."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r") as f:
            cfg = json.load(f)
        # Merge with defaults for any missing keys
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        return cfg
    else:
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()


def save_config(cfg: dict) -> None:
    """Save config to settings.json."""
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


def setup_logging(level: str = "INFO") -> None:
    """Configure loguru with rotation."""
    logger.remove()
    logger.add(
        LOG_PATH,
        rotation="1 week",
        retention="1 month",
        compression="zip",
        level=level,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:<7} | {message}",
    )
    logger.add(
        lambda msg: print(msg, end=""),
        level=level,
        format="{time:HH:mm:ss} | {level:<7} | {message}",
    )
    logger.info(f"Logging initialized at {level} level")
