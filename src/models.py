"""Data models for Uma Musume stats."""
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from datetime import datetime


@dataclass
class HorseStats:
    """Current training stats for a horse."""
    speed: int = 0
    stamina: int = 0
    power: int = 0
    guts: int = 0
    wisdom: int = 0
    skill_pts: int = 0
    energy: int = 100
    motivation: int = 0  # 0-4 scale

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TrainingState:
    """Current training session state."""
    horse_name: str = ""
    current_turn: int = 0
    max_turns: int = 78
    stats: HorseStats = field(default_factory=HorseStats)
    fans: int = 0
    scenario: str = ""
    last_update: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["stats"] = self.stats.to_dict()
        return d

    def update_timestamp(self) -> None:
        self.last_update = datetime.now().isoformat()


@dataclass
class GameState:
    """Overall game state container."""
    connected: bool = False
    in_training: bool = False
    training: TrainingState = field(default_factory=TrainingState)
    last_packet_type: str = ""
    raw_data: Optional[dict] = None
    skills_tab: dict = field(default_factory=dict)
    supporters: list = field(default_factory=list)
    event_choices: list = field(default_factory=list)
    veteran: list = field(default_factory=list)
    race_agenda: list = field(default_factory=list)
    race_objectives: list = field(default_factory=list)
    race_combined: list = field(default_factory=list)
    misc_data: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "connected": self.connected,
            "in_training": self.in_training,
            "training": self.training.to_dict(),
            "last_packet_type": self.last_packet_type,
            "skills_tab": self.skills_tab,
            "supporters": self.supporters,
            "event_choices": self.event_choices,
            "veteran": self.veteran,
            "race_agenda": self.race_agenda,
            "race_objectives": self.race_objectives,
            "race_combined": self.race_combined,
            "misc_data": self.misc_data,
            "raw_data": self.raw_data,
        }


# Global state instance
game_state = GameState()


def apply_cached_state(payload: dict) -> None:
    """Apply cached state data to the global game_state."""
    if not isinstance(payload, dict):
        return
    game_state.connected = False
    game_state.in_training = payload.get("in_training", False)
    game_state.last_packet_type = payload.get("last_packet_type", "")

    training = payload.get("training", {})
    if isinstance(training, dict):
        game_state.training.horse_name = training.get("horse_name", "")
        game_state.training.current_turn = training.get("current_turn", 0)
        game_state.training.max_turns = training.get("max_turns", 78)
        game_state.training.fans = training.get("fans", 0)
        game_state.training.scenario = training.get("scenario", "")
        game_state.training.last_update = training.get("last_update", "")
        stats = training.get("stats", {})
        if isinstance(stats, dict):
            game_state.training.stats.speed = stats.get("speed", 0)
            game_state.training.stats.stamina = stats.get("stamina", 0)
            game_state.training.stats.power = stats.get("power", 0)
            game_state.training.stats.guts = stats.get("guts", 0)
            game_state.training.stats.wisdom = stats.get("wisdom", 0)
            game_state.training.stats.skill_pts = stats.get("skill_pts", 0)
            game_state.training.stats.energy = stats.get("energy", 100)
            game_state.training.stats.motivation = stats.get("motivation", 0)

    game_state.skills_tab = payload.get("skills_tab", {}) or {}
    game_state.supporters = payload.get("supporters", []) or []
    game_state.event_choices = payload.get("event_choices", []) or []
    game_state.veteran = payload.get("veteran", []) or []
    game_state.race_agenda = payload.get("race_agenda", []) or []
    game_state.race_objectives = payload.get("race_objectives", []) or []
    game_state.race_combined = payload.get("race_combined", []) or []
    game_state.misc_data = payload.get("misc_data", {}) or {}
    game_state.raw_data = payload.get("raw_data")
