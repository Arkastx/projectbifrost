"""Shared constants for Project Bifrost."""

# Bond color thresholds (UmaLauncher parity)
BOND_COLOR_DICT = {
    0: "#2AC0FF",
    60: "#A2E61E",
    80: "#FFAD1E",
    100: "#FFEB78",
}

# Aptitude rank mapping
APTITUDE_RANK = {
    1: "G",
    2: "F",
    3: "E",
    4: "D",
    5: "C",
    6: "B",
    7: "A",
    8: "S",
}

# Running style mapping
RUNNING_STYLE = {
    1: "Front",  # Nige
    2: "Pace",   # Senko
    3: "Late",   # Sashi
    4: "End",    # Oikomi
}

# Horse evaluation rank labels (trained horse rank)
HORSE_RANK = {
    1: "G",
    2: "G+",
    3: "F",
    4: "F+",
    5: "E",
    6: "E+",
    7: "D",
    8: "D+",
    9: "C",
    10: "C+",
    11: "B",
    12: "B+",
    13: "A",
    14: "A+",
    15: "S",
    16: "S+",
    17: "SS",
}

# Scenario-specific values (UmaLauncher parity)
SCENARIO_SPECIFIC_FIELDS = {
    2: {
        "name": "Unity Cup (Aoharu)",
        "features": [
            {
                "name": "Unity training partner count",
                "data_set": "team_data_set",
                "paths": [
                    "team_data_set.command_info_array[*].guide_event_partner_array",
                    "team_data_set.command_info_array[*].soul_event_partner_array",
                ],
                "notes": "Unity count = len(guide_event_partner_array) + len(soul_event_partner_array).",
            },
            {
                "name": "Useful Unity training partner count",
                "data_set": "team_data_set",
                "paths": [
                    "team_data_set.command_info_array[*].guide_event_partner_array",
                    "team_data_set.evaluation_info_array[*].soul_event_state",
                ],
                "notes": "Useful = guide partners where soul_event_state == 0.",
            },
            {
                "name": "Spirit Burst partner count",
                "data_set": "team_data_set",
                "paths": [
                    "team_data_set.command_info_array[*].soul_event_partner_array",
                ],
                "notes": "Spirit Burst count = len(soul_event_partner_array).",
            },
        ],
    },
    3: {
        "name": "Grand Live",
        "features": [
            {
                "name": "Grand Live tokens gained distribution",
                "data_set": "live_data_set",
                "paths": [
                    "live_data_set.command_info_array[*].performance_inc_dec_info_array[*].performance_type",
                    "live_data_set.command_info_array[*].performance_inc_dec_info_array[*].value",
                ],
                "notes": "Distribution per facility by token_type (dance, passion, vocal, visual, mental).",
            },
            {
                "name": "Grand Live tokens total",
                "data_set": "live_data_set",
                "paths": [
                    "live_data_set.command_info_array[*].performance_inc_dec_info_array[*].value",
                ],
                "notes": "Total = sum(value) per facility.",
            },
        ],
    },
    5: {
        "name": "Grand Masters",
        "features": [
            {
                "name": "Grand Masters fragments",
                "data_set": "venus_data_set",
                "paths": [
                    "venus_data_set.spirit_info_array[*].spirit_num",
                    "venus_data_set.spirit_info_array[*].spirit_id",
                ],
                "notes": "Fragment id by spirit_num (1..8).",
            },
            {
                "name": "Grand Masters double fragment flag",
                "data_set": "venus_data_set",
                "paths": [
                    "venus_data_set.venus_chara_command_info_array[*].is_boost",
                ],
                "notes": "Double fragment indicator for a command.",
            },
        ],
    },
    6: {
        "name": "Project L'Arc",
        "features": [
            {
                "name": "L'Arc star gauge gain",
                "data_set": "arc_data_set",
                "paths": [
                    "arc_data_set.arc_rival_array[*]",
                    "arc_data_set.selection_info.selection_rival_info_array[*]",
                ],
                "notes": "Computed per facility from rivals in training + rainbow count.",
            },
            {
                "name": "L'Arc aptitude points gained",
                "data_set": "arc_data_set",
                "paths": [
                    "arc_data_set.command_info_array[*].add_global_exp",
                ],
                "notes": "Total aptitude points gain per facility.",
            },
            {
                "name": "L'Arc aptitude points total",
                "data_set": "arc_data_set",
                "paths": [
                    "arc_data_set.arc_info.global_exp",
                ],
                "notes": "Total global aptitude points.",
            },
        ],
    },
    7: {
        "name": "U.A.F. Ready GO!",
        "features": [
            {
                "name": "UAF sports point gain",
                "data_set": "sport_data_set",
                "paths": [
                    "sport_data_set.command_info_array[*].gain_sport_rank_array[*].command_id",
                    "sport_data_set.command_info_array[*].gain_sport_rank_array[*].gain_rank",
                ],
                "notes": "Per facility points by sport group.",
            },
            {
                "name": "UAF sport ranks (current)",
                "data_set": "sport_data_set",
                "paths": [
                    "sport_data_set.training_array[*].command_id",
                    "sport_data_set.training_array[*].sport_rank",
                ],
                "notes": "Current sport ranks per training.",
            },
            {
                "name": "UAF active effects",
                "data_set": "sport_data_set",
                "paths": [
                    "sport_data_set.compe_effect_id_array[*]",
                ],
                "notes": "Active effects list.",
            },
            {
                "name": "UAF competition wins",
                "data_set": "sport_data_set",
                "paths": [
                    "sport_data_set.competition_result_array[*].win_command_id_array[*]",
                ],
                "notes": "Competition wins by group.",
            },
            {
                "name": "UAF consultations left",
                "data_set": "sport_data_set",
                "paths": [
                    "sport_data_set.item_id_array[*]",
                ],
                "notes": "Remaining consultations count = len(item_id_array).",
            },
        ],
    },
    8: {
        "name": "Great Food Festival",
        "features": [
            {
                "name": "GFF vegetable gain",
                "data_set": "cook_data_set",
                "paths": [
                    "cook_data_set.material_harvest_info_array[*].harvest_num",
                ],
                "notes": "Total vegetables planted per facility.",
            },
            {
                "name": "GFF vegetables distribution",
                "data_set": "cook_data_set",
                "paths": [
                    "cook_data_set.material_harvest_info_array[*].material_id",
                    "cook_data_set.material_harvest_info_array[*].harvest_num",
                ],
                "notes": "Distribution of vegetables per facility.",
            },
            {
                "name": "GFF per-command harvest distribution",
                "data_set": "cook_data_set",
                "paths": [
                    "cook_data_set.command_material_care_info_array[*].material_harvest_info_array[*]",
                ],
                "notes": "Harvest distribution tied to command.",
            },
            {
                "name": "GFF field point + care point gain",
                "data_set": "cook_data_set",
                "paths": [
                    "cook_data_set.cook_info.care_point",
                    "cook_data_set.care_point_gain_num",
                ],
                "notes": "Field point and gain per turn.",
            },
        ],
    },
    9: {
        "name": "Run! Mecha Umamusume",
        "features": [
            {
                "name": "Research level total",
                "data_set": "mecha_data_set",
                "paths": [
                    "mecha_data_set.command_info_array[*].point_up_info_array[*].value",
                ],
                "notes": "Total research gain per facility.",
            },
            {
                "name": "Research level distribution",
                "data_set": "mecha_data_set",
                "paths": [
                    "mecha_data_set.command_info_array[*].point_up_info_array[*].status_type",
                    "mecha_data_set.command_info_array[*].point_up_info_array[*].value",
                ],
                "notes": "Distribution of research gain per facility.",
            },
        ],
    },
    11: {
        "name": "Design Your Island",
        "features": [
            {
                "name": "Points distribution",
                "data_set": "pioneer_data_set",
                "paths": [
                    "pioneer_data_set.pioneer_point_gain_info_array[*].command_id",
                    "pioneer_data_set.pioneer_point_gain_info_array[*].gain_num",
                ],
                "notes": "Point gain per facility.",
            },
        ],
    },
    12: {
        "name": "Yukoma Hot Springs",
        "features": [
            {
                "name": "Points distribution",
                "data_set": "onsen_data_set",
                "paths": [
                    "onsen_data_set.command_info_array[*].dig_info_array[*].dig_value",
                ],
                "notes": "Total dig points per facility.",
            },
        ],
    },
}
