const $ = id => document.getElementById(id);
let ws = null;
let reconnectTimer = null;
let lastRawData = null;
let lastState = null;
let statsUmalatorFrame = null;
let statsUmalatorCheckId = 0;
let umalatorCourseData = null;
let optimizerBuilds = [];
let optimizerBuildStatus = '';

// Command IDs for training types
const COMMAND_IDS = {
    speed: [101, 601, 901, 1101, 2101, 2201, 2301, 3601],
    stamina: [105, 602, 905, 1102, 2102, 2202, 2302, 3602],
    power: [102, 603, 902, 1103, 2103, 2203, 2303, 3603],
    guts: [103, 604, 903, 1104, 2104, 2204, 2304, 3604],
    wit: [106, 605, 906, 1105, 2105, 2205, 2305, 3605]
};

// Motivation mapping: 1=Awful, 2=Bad, 3=Normal, 4=Good, 5=Great
const MOTIVATION = {
    1: { name: 'Awful', class: 'awful' },
    2: { name: 'Bad', class: 'bad' },
    3: { name: 'Normal', class: 'normal' },
    4: { name: 'Good', class: 'good' },
    5: { name: 'Great', class: 'great' }
};
const DEFAULT_CALCULATOR = {
    enabled: true,
    weights: {
        speed: 1,
        stamina: 1,
        power: 1,
        guts: 1,
        wit: 1,
        skill_pts: 0,
        bond: 0.4,
        useful_bond: 0.6,
        energy: 1,
        fail: -2
    },
    thresholds: {
        fail_pct: 20,
        energy_min: 30,
        useful_bond_min: 10
    }
};
let calculatorConfig = { ...DEFAULT_CALCULATOR };
let trainingScores = {};
const SCENARIO_NAMES = {
    1: "URA Finals",
    2: "Unity Cup",
    3: "Grand Live",
    4: "Make a New Track",
    5: "Grand Masters",
    6: "Project L'Arc",
    7: "U.A.F. Ready GO!",
    8: "Great Food Festival",
    9: "Run! Mecha Umamusume",
    10: "The Twinkle Legends",
    11: "Design Your Island",
    12: "Yukoma Hot Springs"
};

// Stat value to status rank icon mapping (label-based, same as veteran view)
function getStatRankIcon(statValue) {
    const label = veteranStatRankLabel(statValue);
    return statusRankIcon(label);
}

function updateStatRankIcons(stats) {
    const statMap = {
        speed: stats.speed || 0,
        stamina: stats.stamina || 0,
        power: stats.power || 0,
        guts: stats.guts || 0,
        wit: stats.wisdom || 0,
    };
    for (const [stat, value] of Object.entries(statMap)) {
        const icon = $(`rank-icon-${stat}`);
        if (icon) {
            icon.src = getStatRankIcon(value);
        }
    }
}

async function loadSettings() {
    const status = $('settings-status');
    if (status) status.textContent = 'Loading...';
    try {
        const res = await fetch('/api/settings');
        const cfg = await res.json();
        $('setting-udp-host').value = cfg.udp_host || '127.0.0.1';
        $('setting-udp-port').value = cfg.udp_port || 17229;
        $('setting-web-host').value = cfg.web_host || '127.0.0.1';
        $('setting-web-port').value = cfg.web_port || 8080;
        $('setting-max-buffer').value = cfg.max_buffer_size || 262144;
        $('setting-log-level').value = cfg.log_level || 'INFO';
        const presetSource = cfg.preset_source || 'global';
        const presetSourceEl = $('setting-preset-source');
        if (presetSourceEl) presetSourceEl.value = presetSource;
        const calc = cfg.calculator || {};
        const weights = calc.weights || {};
        const thresholds = calc.thresholds || {};
        $('setting-calc-enabled').value = (calc.enabled === false) ? 'off' : 'on';
        $('setting-calc-weight-speed').value = weights.speed ?? DEFAULT_CALCULATOR.weights.speed;
        $('setting-calc-weight-stamina').value = weights.stamina ?? DEFAULT_CALCULATOR.weights.stamina;
        $('setting-calc-weight-power').value = weights.power ?? DEFAULT_CALCULATOR.weights.power;
        $('setting-calc-weight-guts').value = weights.guts ?? DEFAULT_CALCULATOR.weights.guts;
        $('setting-calc-weight-wit').value = weights.wit ?? DEFAULT_CALCULATOR.weights.wit;
        $('setting-calc-weight-skill').value = weights.skill_pts ?? DEFAULT_CALCULATOR.weights.skill_pts;
        $('setting-calc-weight-bond').value = weights.bond ?? DEFAULT_CALCULATOR.weights.bond;
        $('setting-calc-weight-useful').value = weights.useful_bond ?? DEFAULT_CALCULATOR.weights.useful_bond;
        $('setting-calc-weight-energy').value = weights.energy ?? DEFAULT_CALCULATOR.weights.energy;
        $('setting-calc-weight-fail').value = weights.fail ?? DEFAULT_CALCULATOR.weights.fail;
        $('setting-calc-threshold-fail').value = thresholds.fail_pct ?? DEFAULT_CALCULATOR.thresholds.fail_pct;
        $('setting-calc-threshold-energy').value = thresholds.energy_min ?? DEFAULT_CALCULATOR.thresholds.energy_min;
        $('setting-calc-threshold-useful').value = thresholds.useful_bond_min ?? DEFAULT_CALCULATOR.thresholds.useful_bond_min;
        calculatorConfig = {
            ...DEFAULT_CALCULATOR,
            ...calc,
            weights: {
                ...DEFAULT_CALCULATOR.weights,
                ...(weights || {}),
                skill_pts: 0
            },
            thresholds: {
                ...DEFAULT_CALCULATOR.thresholds,
                ...(thresholds || {})
            }
        };
        if (status) status.textContent = 'Loaded';
    } catch (e) {
        if (status) status.textContent = 'Failed to load';
    }
}

async function saveSettings() {
    const status = $('settings-status');
    if (status) status.textContent = 'Saving...';
    const font = $('setting-font').value;
    document.documentElement.style.setProperty('--font-family', font);
    document.body.style.fontFamily = font;
    localStorage.setItem('bifrost-font', font);

    const numOr = (id, fallback) => {
        const value = Number($(id)?.value);
        return Number.isFinite(value) ? value : fallback;
    };

        const payload = {
            udp_host: $('setting-udp-host').value || '127.0.0.1',
            udp_port: Number($('setting-udp-port').value) || 17229,
            web_host: $('setting-web-host').value || '127.0.0.1',
            web_port: Number($('setting-web-port').value) || 8080,
            max_buffer_size: Number($('setting-max-buffer').value) || 262144,
            log_level: $('setting-log-level').value || 'INFO',
            preset_source: $('setting-preset-source')?.value || 'global',
            calculator: {
            enabled: $('setting-calc-enabled').value !== 'off',
            weights: {
                speed: numOr('setting-calc-weight-speed', DEFAULT_CALCULATOR.weights.speed),
                stamina: numOr('setting-calc-weight-stamina', DEFAULT_CALCULATOR.weights.stamina),
                power: numOr('setting-calc-weight-power', DEFAULT_CALCULATOR.weights.power),
                guts: numOr('setting-calc-weight-guts', DEFAULT_CALCULATOR.weights.guts),
                wit: numOr('setting-calc-weight-wit', DEFAULT_CALCULATOR.weights.wit),
                skill_pts: 0,
                bond: numOr('setting-calc-weight-bond', DEFAULT_CALCULATOR.weights.bond),
                useful_bond: numOr('setting-calc-weight-useful', DEFAULT_CALCULATOR.weights.useful_bond),
                energy: numOr('setting-calc-weight-energy', DEFAULT_CALCULATOR.weights.energy),
                fail: numOr('setting-calc-weight-fail', DEFAULT_CALCULATOR.weights.fail)
            },
            thresholds: {
                fail_pct: numOr('setting-calc-threshold-fail', DEFAULT_CALCULATOR.thresholds.fail_pct),
                energy_min: numOr('setting-calc-threshold-energy', DEFAULT_CALCULATOR.thresholds.energy_min),
                useful_bond_min: numOr('setting-calc-threshold-useful', DEFAULT_CALCULATOR.thresholds.useful_bond_min)
            }
        }
    };

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        calculatorConfig = {
            ...DEFAULT_CALCULATOR,
            ...payload.calculator,
            weights: {
                ...DEFAULT_CALCULATOR.weights,
                ...payload.calculator.weights,
                skill_pts: 0
            },
            thresholds: {
                ...DEFAULT_CALCULATOR.thresholds,
                ...payload.calculator.thresholds
            }
        };
        try {
            await loadUmalatorPresets();
        } catch (e) {
            // Ignore preset refresh errors; settings are already saved.
        }
        if (status) status.textContent = 'Saved';
    } catch (e) {
        if (status) status.textContent = 'Save failed';
    }
}
$('veteran-error-close')?.addEventListener('click', () => {
    const modal = $('veteran-error-modal');
    if (modal) modal.style.display = 'none';
});
$('veteran-open-umalator')?.addEventListener('click', () => {
    openVeteranUmalator();
});
$('stats-open-umalator')?.addEventListener('click', () => {
    openStatsUmalator();
});
$('stats-umalator-check')?.addEventListener('click', () => {
    runStatsUmalatorCheck();
});
$('stats-style-select')?.addEventListener('change', (event) => {
    selectedStatsStyle = event.currentTarget?.value || 'auto';
});
$('optimizer-generate-builds')?.addEventListener('click', () => {
    generateOptimizerBuilds();
});
$('optimizer-build-select')?.addEventListener('change', (event) => {
    const idx = Number(event.currentTarget?.value ?? -1);
    if (!Number.isFinite(idx) || idx < 0 || idx >= optimizerBuilds.length) {
        updateOptimizerBuildSummary(null);
        return;
    }
    applyOptimizerBuild(optimizerBuilds[idx]);
});
['optimizer-target-survival', 'optimizer-target-spurt', 'optimizer-target-finalleg'].forEach((id) => {
    $(id)?.addEventListener('change', () => {
        updateOptimizerBuildSummary(null);
    });
});
$('stats-clear-state')?.addEventListener('click', async () => {
    try {
        await fetch('/api/state-reset', { method: 'POST' });
        const res = await fetch('/api/state');
        const data = await res.json();
        updateUI(data);
    } catch (e) {
        // ignore
    }
});

$('toggle-objectives')?.addEventListener('change', () => {
    if (lastState) updateRaceTab(lastState);
});
$('toggle-agenda')?.addEventListener('change', () => {
    if (lastState) updateRaceTab(lastState);
});

function getFailClass(fail) {
    if (fail === 0) return 'fail-0';
    if (fail <= 10) return 'fail-low';
    if (fail <= 20) return 'fail-mid';
    if (fail <= 30) return 'fail-high';
    return 'fail-danger';
}

function getCalculatorConfig() {
    return calculatorConfig || DEFAULT_CALCULATOR;
}

function getMotivationPenalty(motivation) {
    if (!motivation || motivation >= 4) return 0;
    return (4 - motivation) * 6;
}


function bondColor(value) {
    if (value >= 100) return '#FFEB78';
    if (value >= 80) return '#FFAD1E';
    if (value >= 60) return '#A2E61E';
    return '#2AC0FF';
}

function findCommandInfo(commandInfoArray, commandIds) {
    if (!commandInfoArray) return null;
    for (const cmd of commandInfoArray) {
        if (commandIds.includes(cmd.command_id)) return cmd;
    }
    return null;
}

function getTrainingLevel(trainingLevelArray, commandId) {
    if (!trainingLevelArray) return 1;
    for (const lvl of trainingLevelArray) {
        if (lvl.command_id === commandId) return lvl.level || 1;
    }
    return 1;
}

function countHints(tipsArray) {
    if (!tipsArray) return 0;
    return tipsArray.length;
}


function updateTrainingCard(stat, data) {
    const raw = data.raw_data;
    if (!raw) return;
    trainingScores[stat] = null;

    const inner = raw.data || raw;
    const homeInfo = inner.home_info || {};
    const charaInfo = inner.chara_info || {};
    const commandArray = homeInfo.command_info_array || [];
    const levelArray = charaInfo.training_level_info_array || [];
    const evalArray = charaInfo.evaluation_info_array || [];
    const evalDict = {};
    for (const entry of evalArray) {
        const trainingPartnerId = entry.training_partner_id;
        const targetId = entry.target_id;
        if (trainingPartnerId !== undefined && trainingPartnerId !== null) {
            evalDict[trainingPartnerId] = entry;
        }
        if (targetId !== undefined && targetId !== null) {
            evalDict[targetId] = entry;
        }
    }

    const cmdIds = COMMAND_IDS[stat];
    const cmd = findCommandInfo(commandArray, cmdIds);

    if (cmd) {
        // Level
        const level = getTrainingLevel(levelArray, cmd.command_id);
        $(`level-${stat}`).textContent = `Lv${level}`;

        // Fail rate
        const fail = cmd.failure_rate || 0;
        const failEl = $(`fail-${stat}`);
        failEl.textContent = `${fail}%`;
        failEl.className = 'training-fail ' + getFailClass(fail);

        // Hints count
        const tipsSet = new Set(cmd.tips_event_partner_array || []);
        const hints = countHints(cmd.tips_event_partner_array);
        $(`hints-${stat}`).textContent = `Hints ${hints}`;
        const hintCountEl = $(`hintcount-${stat}`);
        if (hintCountEl) {
            hintCountEl.innerHTML = `<span class="hint-text">Hints ${hints}</span>`;
        }

        // Stat gains from params_inc_dec_info_array
        const params = cmd.params_inc_dec_info_array || [];
        let statGains = { speed: 0, stamina: 0, power: 0, guts: 0, wiz: 0, skill: 0 };
        let energyChange = 0;

        const applyParams = (paramArray) => {
            for (const p of (paramArray || [])) {
                const target = p.target_type ?? p.status_type;
                // target_type/status_type: 1=speed, 2=stamina, 3=power, 4=guts, 5=wiz, 30=skill
                if (target === 1) statGains.speed += p.value || 0;
                else if (target === 2) statGains.stamina += p.value || 0;
                else if (target === 3) statGains.power += p.value || 0;
                else if (target === 4) statGains.guts += p.value || 0;
                else if (target === 5) statGains.wiz += p.value || 0;
                else if (target === 30) statGains.skill += p.value || 0;
                else if (target === 10) energyChange += p.value || 0;
            }
        };

        applyParams(params);

        // Unity (Aoharu) Spirit Burst bonuses can be delivered via team_data_set command arrays.
        if (inner?.chara_info?.scenario_id === 2) {
            const teamData = inner?.team_data_set || {};
            const teamCmd = (teamData.command_info_array || [])
                .find(info => info.command_id === cmd.command_id);
            if (teamCmd) {
                const extraKeys = [
                    "params_inc_dec_info_array",
                    "point_up_info_array",
                    "add_params_info_array",
                    "add_params_inc_dec_info_array",
                    "bonus_params_inc_dec_info_array",
                ];
                for (const key of extraKeys) {
                    applyParams(teamCmd[key]);
                }
            }
        }

        // Primary + secondary gains for this training
        const primaryMap = { speed: 'speed', stamina: 'stamina', power: 'power', guts: 'guts', wit: 'wiz' };
        const secondaryMap = { speed: 'power', stamina: 'guts', power: 'stamina', guts: 'power', wit: 'skill' };
        const extraMap = { guts: 'speed' };
        const primaryGain = statGains[primaryMap[stat]] || 0;
        const secondaryGain = statGains[secondaryMap[stat]] || 0;
        const extraGain = statGains[extraMap[stat]] || 0;
        const totalGain = primaryGain + secondaryGain + extraGain;

        const totalEl = $(`total-${stat}`);
        totalEl.textContent = totalGain > 0 ? `+${totalGain}` : '+0';

        const gainsMap = {
            speed: [
                { label: 'SPD', value: statGains.speed },
                { label: 'POW', value: statGains.power }
            ],
            stamina: [
                { label: 'STA', value: statGains.stamina },
                { label: 'GUT', value: statGains.guts }
            ],
            power: [
                { label: 'STA', value: statGains.stamina },
                { label: 'POW', value: statGains.power }
            ],
            guts: [
                { label: 'SPD', value: statGains.speed },
                { label: 'POW', value: statGains.power },
                { label: 'GUT', value: statGains.guts }
            ],
            wit: [
                { label: 'SPD', value: statGains.speed },
                { label: 'WIT', value: statGains.wiz }
            ]
        };
        const gainsEl = $(`gains-${stat}`);
        if (gainsEl && gainsMap[stat]) {
            const line = gainsMap[stat]
                .map(item => `<span class="gain-value">+${item.value || 0}</span> <span class="gain-label">${item.label}</span>`)
                .join(' ');
            gainsEl.innerHTML = line;
        }
        const metricsEl = $(`metrics-${stat}`);
        if (metricsEl) {
            const energyValue = energyChange || 0;
            const energyClass = energyValue >= 0 ? 'energy-pos' : 'energy-neg';
            const energyText = energyValue >= 0 ? `+${energyValue}` : `${energyValue}`;
            const failClass = getFailClass(fail);
            const failText = fail > 0 ? `${fail}%` : '0%';
            metricsEl.innerHTML =
                `<span class="${energyClass}"><span class="energy-value">${energyText}</span> ENERGY</span> ` +
                `<span class="${failClass}">${failText} FAIL</span>`;
        }

        // Rainbow count: support card type must match training stat, bond >= 80, exclude pal/friend.
        const partnerArray = cmd.training_partner_array || [];
        let rainbows = 0;
        for (const partnerId of partnerArray) {
            if (partnerId > 6) continue;
            const entry = evalDict[partnerId];
            const supporter = (data.supporters || []).find(s => s.position === partnerId);
            if (!supporter) continue;
            if (PAL_SUPPORT_IDS.has(supporter.support_card_id)) continue;
            if (supporter.support_card_type === 2 || supporter.support_card_type === 3) continue;
            const evaluation = entry?.evaluation ?? supporter.bond ?? 0;
            if (evaluation < 80) continue;
            const cmdList = COMMAND_IDS[stat] || [];
            const supportCmdId = Number(supporter.support_card_command_id);
            if (Number.isFinite(supportCmdId) && supportCmdId > 0 && !cmdList.includes(supportCmdId)) continue;
            rainbows += 1;
        }
        $(`rain-${stat}`).textContent = `Rainbows ${rainbows}`;
        const rbEl = $(`rb-${stat}`);
        if (rbEl) {
            rbEl.textContent = `RB:${rainbows}`;
            rbEl.classList.toggle('zeroed', rainbows === 0);
            rbEl.classList.toggle('rainbow', rainbows > 0);
        }

        // Rainbow gradient on label if rainbows > 0
        const labelEl = $(`label-${stat}`);
        const iconEl = $(`label-icon-${stat}`);
        if (rainbows > 0) {
            labelEl.classList.add('rainbow');
            if (iconEl) iconEl.classList.add('rainbow');
        } else {
            labelEl.classList.remove('rainbow');
            if (iconEl) iconEl.classList.remove('rainbow');
        }
        // Projected stat display removed

        const maxMap = {
            speed: 'max_speed',
            stamina: 'max_stamina',
            power: 'max_power',
            guts: 'max_guts',
            wit: 'max_wiz'
        };
        const maxVal = charaInfo[maxMap[stat]] || 1200;
        const maxEl = $(`max-${stat}`);
        if (maxEl) maxEl.textContent = `/${maxVal}`;
        const breakdownEl = $(`breakdown-${stat}`);
        if (breakdownEl) {
            const abbrMap = {
                speed: "SPD",
                stamina: "STA",
                power: "POW",
                guts: "GUT",
                wit: "WIT",
                skill: "SKL",
            };
            const primaryAbbr = abbrMap[primaryMap[stat]];
            const secondaryAbbr = abbrMap[secondaryMap[stat]];
            const extraAbbr = extraMap[stat] ? abbrMap[extraMap[stat]] : null;

            const parts = [];
            if (primaryAbbr && primaryGain) parts.push(`<span class="breakdown-stat">+${primaryGain} ${primaryAbbr}</span>`);
            if (secondaryAbbr && secondaryGain) parts.push(`<span class="breakdown-stat">+${secondaryGain} ${secondaryAbbr}</span>`);
            if (extraAbbr && extraGain) parts.push(`<span class="breakdown-stat">+${extraGain} ${extraAbbr}</span>`);

            breakdownEl.innerHTML = parts.join('');
        }

        let bondGain = 0;
        for (const partnerId of partnerArray) {
            if (partnerId > 6) continue;
            const evaluation = evalDict[partnerId]?.evaluation ?? 0;
            let gain = tipsSet.has(partnerId) ? 12 : 7;
            gain = Math.min(gain, Math.max(0, 100 - evaluation));
            bondGain += gain;
        }

        const reasonResult = updateReasons(stat, statGains, partnerArray, evalDict, charaInfo, tipsSet);
        if (hintCountEl) {
            const hintZero = hints === 0;
            const bondZero = reasonResult.usefulBond === 0;
            hintCountEl.innerHTML =
                `<span class="hint-text${hintZero ? ' zeroed' : ''}">Hints ${hints}</span> ` +
                `<span class="bond-text${bondZero ? ' zeroed' : ''}">Bonds +${reasonResult.usefulBond}</span>`;
        }
        const unityEl = $(`unitycount-${stat}`);
        if (unityEl) {
            const scenarioId = inner?.chara_info?.scenario_id;
            if (scenarioId !== 2) {
                unityEl.style.display = 'none';
            } else {
                const teamData = inner?.team_data_set || {};
                const unityCmd = (teamData.command_info_array || [])
                    .find(info => info.command_id === cmd.command_id);
                const guidePartners = unityCmd?.guide_event_partner_array || [];
                const evalInfo = teamData.evaluation_info_array || [];
                const evalByTarget = {};
                for (const entry of evalInfo) {
                    evalByTarget[entry.target_id] = entry;
                }
                let usefulUnity = 0;
                for (const partnerId of guidePartners) {
                    const evalEntry = evalByTarget[partnerId];
                    if (evalEntry && evalEntry.soul_event_state === 0) {
                        usefulUnity += 1;
                    }
                }
                unityEl.style.display = '';
                const burstCount = (unityCmd?.soul_event_partner_array || []).length;
                const unityZero = usefulUnity === 0;
                const burstZero = burstCount === 0;
                unityEl.innerHTML =
                    `<span class="${unityZero ? 'zeroed' : ''}">Unity T: ${usefulUnity}</span> ` +
                    `<span class="spirit-text${burstZero ? ' zeroed' : ''}">Burst ${burstCount}</span>`;
            }
        }
        updateTrainingSupporters(stat, partnerArray, evalDict, data, cmd);

        const calc = getCalculatorConfig();
        const weights = calc.weights || {};
        const baseScore =
            (statGains.speed || 0) * (weights.speed ?? 0) +
            (statGains.stamina || 0) * (weights.stamina ?? 0) +
            (statGains.power || 0) * (weights.power ?? 0) +
            (statGains.guts || 0) * (weights.guts ?? 0) +
            (statGains.wiz || 0) * (weights.wit ?? 0) +
            bondGain * (weights.bond ?? 0) +
            reasonResult.usefulBond * (weights.useful_bond ?? 0) +
            (energyChange || 0) * (weights.energy ?? 0) +
            fail * (weights.fail ?? 0);
        const motivationPenalty = getMotivationPenalty(data?.training?.stats?.motivation);
        trainingScores[stat] = baseScore - motivationPenalty;

        const costEnergy = $(`cost-energy-${stat}`);
        if (costEnergy) {
            const value = energyChange || 0;
            const label = value >= 0 ? `Energy +${value}` : `Energy ${value}`;
            costEnergy.textContent = label;
            costEnergy.classList.remove('low', 'mid', 'high');
            const abs = Math.abs(value);
            if (abs <= 10) costEnergy.classList.add('low');
            else if (abs <= 20) costEnergy.classList.add('mid');
            else costEnergy.classList.add('high');
        }
        const costFail = $(`cost-fail-${stat}`);
        if (costFail) {
            costFail.textContent = `Fail ${fail}%`;
        }
        const costBond = $(`cost-bond-${stat}`);
        if (costBond) {
            costBond.textContent = `Bond +${bondGain}`;
        }
        const costUseful = $(`cost-useful-${stat}`);
        if (costUseful) {
            costUseful.textContent = `Useful +${reasonResult.usefulBond}`;
            const holder = costUseful.parentElement;
            if (holder) {
                holder.classList.toggle('hidden', reasonResult.usefulBond <= 0);
            }
        }

        const riskBadge = $(`risk-${stat}`);
        if (riskBadge) {
            riskBadge.classList.toggle('hidden', fail < 20);
        }
        const bondBadge = $(`bond-${stat}`);
        if (bondBadge) {
            bondBadge.classList.toggle('hidden', reasonResult.usefulBond < 10);
        }
    }
}

const PAL_SUPPORT_IDS = new Set([
    30160, // Mei Satake (friend)
    30052, // Light Hello (friend)
    30188  // Ryoka (friend)
]);

function updateReasons(stat, gains, partners, evalDict, charaInfo, tipsSet) {
    // Map stat to its secondary stat display
    const reasonMaps = {
        speed: { primary: 'spd', secondary: 'pow', pGain: gains.speed, sGain: gains.power },
        stamina: { primary: 'sta', secondary: 'gut', pGain: gains.stamina, sGain: gains.guts },
        power: { primary: 'pow', secondary: 'sta', pGain: gains.power, sGain: gains.stamina },
        guts: { primary: 'gut', secondary: 'pow', pGain: gains.guts, sGain: gains.power },
        wit: { primary: 'wiz', secondary: 'skl', pGain: gains.wiz, sGain: gains.skill }
    };

    const map = reasonMaps[stat];
    if (!map) return { usefulBond: 0, hasPal: false };

    // Primary stat gain
    const pEl = $(`r-${stat}-${map.primary}`);
    if (pEl) {
        pEl.textContent = map.pGain > 0 ? `+${map.pGain}` : '+0';
        pEl.classList.toggle('negative', map.pGain < 0);
    }

    // Secondary stat gain
    const sEl = $(`r-${stat}-${map.secondary}`);
    if (sEl) {
        sEl.textContent = map.sGain > 0 ? `+${map.sGain}` : '+0';
        sEl.classList.toggle('negative', map.sGain < 0);
    }

    const supportByPos = {};
    for (const card of (charaInfo?.support_card_array || [])) {
        supportByPos[card.position] = card.support_card_id;
    }

    // Useful bond: if below threshold, count the full gain (7 or 12), even if it crosses the threshold.
    let usefulBond = 0;
    let hasPal = false;
    for (const partnerId of partners) {
        const entry = evalDict[partnerId];
        if (!entry) continue;

        const evaluation = entry.evaluation || 0;
        const isSupport = partnerId <= 6;
        const supportId = supportByPos[partnerId];
        const isPal = isSupport && supportId && PAL_SUPPORT_IDS.has(supportId);

        const gain = tipsSet && tipsSet.has(partnerId) ? 12 : 7;
        const cappedGain = Math.min(gain, Math.max(0, 100 - evaluation));
        if (isPal) {
            hasPal = true;
            if (evaluation < 60) usefulBond += cappedGain;
        } else if (isSupport) {
            if (evaluation < 80) usefulBond += cappedGain;
        }
    }

    const bondEl = $(`r-${stat}-bond`);
    if (bondEl) bondEl.textContent = usefulBond > 0 ? `+${usefulBond}` : '+0';

    return { usefulBond, hasPal };
}


function updateTrainingSupporters(stat, partnerArray, evalDict, state, cmd) {
    const container = $(`supporters-line-${stat}`) || $(`supp-${stat}`);
    if (!container) return;
    container.innerHTML = '';

    const supporters = state.supporters || [];
    const tips = new Set(cmd?.tips_event_partner_array || []);

    for (const partnerId of (partnerArray || [])) {
        if (partnerId > 6) continue; // only support cards for now
        const supporter = supporters.find(s => s.position === partnerId);
        if (!supporter) continue;

        const evaluation = evalDict[partnerId]?.evaluation ?? supporter.bond ?? 0;
        const maxPossible = Math.min(100, 100 - evaluation);
        let gain = Math.min(7, maxPossible);
        if (tips.has(partnerId)) {
            gain = Math.min(7 + 5, maxPossible);
        }

        const chip = document.createElement('div');
        chip.className = 'supporter-chip';

        const img = document.createElement('img');
        img.src = supporter.icon_url || 'https://umapyoi.net/missing_chara.png';
        img.alt = supporter.name || 'Supporter';

        const text = document.createElement('span');
        const resultBond = Math.min(100, evaluation + gain);
        text.textContent = `+${gain}`;
        text.style.color = bondColor(resultBond);

        chip.appendChild(img);
        chip.appendChild(text);

        if (tips.has(partnerId)) {
            const badge = document.createElement('div');
            badge.className = 'hint-badge';
            badge.textContent = '!';
            chip.appendChild(badge);
        }

        container.appendChild(chip);
    }

    if (!container.children.length) {
        container.textContent = '';
    }
}

function applySuggestedTraining(state) {
    const calc = getCalculatorConfig();
    const restPill = $('rest-pill');
    document.querySelectorAll('.training-card').forEach(card => card.classList.remove('suggested'));
    if (restPill) restPill.classList.remove('suggested');

    if (!calc.enabled) {
        const suggested = state?.training?.suggested_training || state?.training?.suggested_command || state?.training?.suggested;
        if (suggested && $(`card-${suggested}`)) {
            $(`card-${suggested}`).classList.add('suggested');
        }
        return;
    }

    let bestStat = null;
    let bestScore = -Infinity;
    for (const [stat, score] of Object.entries(trainingScores)) {
        if (score === null || score === undefined) continue;
        if (score > bestScore) {
            bestScore = score;
            bestStat = stat;
        }
    }

    const energy = state?.training?.stats?.energy ?? 0;
    const motivation = state?.training?.stats?.motivation ?? 3;
    const thresholds = calc.thresholds || {};
    const energyMin = thresholds.energy_min ?? DEFAULT_CALCULATOR.thresholds.energy_min;
    const motivationPenalty = getMotivationPenalty(motivation);
    let restScore = 0;
    if (energy < energyMin) {
        restScore += (energyMin - energy) * 2;
    }
    if (motivationPenalty > 0) {
        restScore += motivationPenalty * 1.5;
    }

    if (restPill && (restScore >= bestScore || bestStat === null)) {
        restPill.classList.add('suggested');
    } else if (bestStat && $(`card-${bestStat}`)) {
        $(`card-${bestStat}`).classList.add('suggested');
    }
}

function updateSupporters(state) {
    const list = $('supporter-list');
    if (!list) return;
    list.innerHTML = '';

    const supporters = state.supporters || [];
    const raw = state.raw_data?.data || state.raw_data || {};
    const commandInfo = raw?.home_info?.command_info_array || [];
    const hintPartners = new Set();
    for (const cmd of commandInfo) {
        for (const partnerId of (cmd.tips_event_partner_array || [])) {
            hintPartners.add(partnerId);
        }
    }
    if (!supporters.length) {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No supporters data available';
        list.appendChild(empty);
        return;
    }

    for (const supporter of supporters) {
        const item = document.createElement('div');
        item.className = 'supporter-item';

        const img = document.createElement('img');
        img.src = supporter.icon_url || 'https://umapyoi.net/missing_chara.png';
        img.alt = supporter.name || 'Supporter';
        if (hintPartners.has(supporter.position)) {
            const hintIcon = document.createElement('img');
            hintIcon.className = 'supporter-hint-icon';
            hintIcon.src = '/assets/icons/hint.png';
            hintIcon.alt = 'Hint';
            item.appendChild(hintIcon);
        }

        const bondValue = supporter.bond ?? 0;
        const bond = document.createElement('div');
        bond.className = 'supporter-bond';
        bond.textContent = bondValue;
        bond.style.color = bondColor(bondValue);

        const bar = document.createElement('div');
        bar.className = 'supporter-bond-bar';
        const fill = document.createElement('div');
        fill.className = 'supporter-bond-fill';
        fill.style.width = `${Math.min(100, Math.max(0, bondValue))}%`;
        fill.style.background = bondColor(bondValue);
        bar.appendChild(fill);

        const name = document.createElement('div');
        name.className = 'supporter-name';
        name.textContent = supporter.name || `Support ${supporter.support_card_id}`;

        item.appendChild(img);
        item.appendChild(bond);
        item.appendChild(bar);
        item.appendChild(name);
        list.appendChild(item);
    }
}

function updateSkillsTab(state) {
    const data = state.skills_tab || {};
    // Only skip if we have neither skills_tab data nor training stats
    if (!Object.keys(data).length && !state.training?.stats) return;

    const portrait = $('skills-portrait');
    portrait.src = data.portrait_url || 'https://umapyoi.net/missing_chara.png';
    portrait.onerror = () => {
        portrait.onerror = null;
        portrait.src = data.portrait_fallback_url || 'https://umapyoi.net/missing_chara.png';
    };

    $('skills-name').textContent = data.chara_name || 'Unknown';
    $('skills-talent').textContent = `Potential Lv ${data.talent_level ?? '-'}`;
    $('skills-style').textContent = `Running Style: ${data.running_style || '-'}`;

    const stats = state.training?.stats || {};
    $('skills-stat-speed').textContent = stats.speed ?? 0;
    $('skills-stat-stamina').textContent = stats.stamina ?? 0;
    $('skills-stat-power').textContent = stats.power ?? 0;
    $('skills-stat-guts').textContent = stats.guts ?? 0;
    $('skills-stat-wit').textContent = stats.wisdom ?? 0;

    const raw = state.raw_data?.data || state.raw_data || {};
    const maxStats = raw?.chara_info || {};
    $('skills-max-speed').textContent = `/${maxStats.max_speed ?? 1200}`;
    $('skills-max-stamina').textContent = `/${maxStats.max_stamina ?? 1200}`;
    $('skills-max-power').textContent = `/${maxStats.max_power ?? 1200}`;
    $('skills-max-guts').textContent = `/${maxStats.max_guts ?? 1200}`;
    $('skills-max-wit').textContent = `/${maxStats.max_wiz ?? 1200}`;

    const statIconMap = {
        speed: '/assets/icons/status_00.png',
        stamina: '/assets/icons/status_01.png',
        power: '/assets/icons/status_02.png',
        guts: '/assets/icons/status_03.png',
        wit: '/assets/icons/status_04.png',
    };
    $('stat-icon-speed').src = statIconMap.speed;
    $('stat-icon-stamina').src = statIconMap.stamina;
    $('stat-icon-power').src = statIconMap.power;
    $('stat-icon-guts').src = statIconMap.guts;
    $('stat-icon-wit').src = statIconMap.wit;

    $('rank-speed').src = getStatRankIcon(stats.speed);
    $('rank-stamina').src = getStatRankIcon(stats.stamina);
    $('rank-power').src = getStatRankIcon(stats.power);
    $('rank-guts').src = getStatRankIcon(stats.guts);
    $('rank-wit').src = getStatRankIcon(stats.wisdom);

    const apt = data.aptitudes || {};
    const aptIconIndex = {
        'G': 0, 'G+': 1, 'F': 2, 'F+': 3, 'E': 4, 'E+': 5,
        'D': 6, 'D+': 7, 'C': 8, 'C+': 9, 'B': 10, 'B+': 11,
        'A': 12, 'A+': 13, 'S': 14,
    };
    const aptIcon = (letter) => {
        const idx = aptIconIndex[letter] ?? 0;
        return `/assets/icons/statusrank/ui_statusrank_${String(idx).padStart(2, '0')}.png`;
    };
    const setApt = (id, letter, label) => {
        const el = $(id);
        if (!el) return;
        const value = letter || '-';
        el.innerHTML = `<span>${label}</span><img class="apt-icon" src="${aptIcon(value)}" alt="${value}">`;
    };
    setApt('apt-turf', apt.track?.Turf, 'Turf');
    setApt('apt-dirt', apt.track?.Dirt, 'Dirt');
    setApt('apt-sprint', apt.distance?.Sprint, 'Sprint');
    setApt('apt-mile', apt.distance?.Mile, 'Mile');
    setApt('apt-medium', apt.distance?.Medium, 'Medium');
    setApt('apt-long', apt.distance?.Long, 'Long');
    setApt('apt-front', apt.style?.Front, 'Front');
    setApt('apt-pace', apt.style?.Pace, 'Pace');
    setApt('apt-late', apt.style?.Late, 'Late');
    setApt('apt-end', apt.style?.End, 'End');

    const growth = $('skills-growth');
    growth.innerHTML = '';
    const growthRates = data.growth_rates || {};
    const growthKeys = [
        ['Speed', growthRates.speed, statIconMap.speed],
        ['Stamina', growthRates.stamina, statIconMap.stamina],
        ['Power', growthRates.power, statIconMap.power],
        ['Guts', growthRates.guts, statIconMap.guts],
        ['Wit', growthRates.wit, statIconMap.wit],
    ];
    const anyGrowth = growthKeys.some(([, val]) => val && val !== 0);
    if (anyGrowth) {
        for (const [label, value, icon] of growthKeys) {
            if (!value) continue;
            const pill = document.createElement('span');
            pill.className = 'growth-pill';
            pill.innerHTML = `<img class="stat-icon" src="${icon}" alt="${label}"> +${value}%`;
            growth.appendChild(pill);
        }
    } else {
        const pill = document.createElement('span');
        pill.className = 'growth-pill';
        pill.textContent = 'Growth: -';
        growth.appendChild(pill);
    }

    const owned = $('skills-owned');
    owned.innerHTML = '';
    if (data.skills && data.skills.length) {
        for (const skill of data.skills) {
            const item = document.createElement('div');
            item.className = 'skill-item';
            const img = document.createElement('img');
            img.className = 'skill-icon';
            img.src = skill.icon_url || '';
            img.alt = skill.name || 'Skill';
            const text = document.createElement('div');
            text.className = 'skill-text';
            text.textContent = `${skill.name} Lv ${skill.level}`;
            item.appendChild(img);
            item.appendChild(text);
            owned.appendChild(item);
        }
    } else {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No skills data available';
        owned.appendChild(empty);
    }

    const availableTitle = $('skills-available-title');
    const fallbackSp = state.raw_data?.data?.chara_info?.skill_point;
    const baseSkillPoints = Number(stats.skill_pts ?? fallbackSp ?? 0);
    const updateAvailableTitle = () => {
        if (!availableTitle) return;
        let selectedTotal = 0;
        for (const skillId of selectedAvailableSkills) {
            const cost = availableSkillCosts.get(skillId);
            if (Number.isFinite(cost)) selectedTotal += cost;
        }
        const remaining = baseSkillPoints - selectedTotal;
        if (remaining >= 0) {
            availableTitle.textContent = `Available Skills (${remaining.toLocaleString()} SP)`;
        } else {
            availableTitle.textContent = `Available Skills (NEED ${Math.abs(remaining).toLocaleString()} POINTS)`;
        }
    };

    const tips = $('skills-tips');
    tips.innerHTML = '';

    const hintMap = new Map();
    for (const tip of (data.skill_tips || [])) {
        const skillId = tip.skill_id ?? null;
        if (!skillId) continue;
        hintMap.set(skillId, {
            name: tip.name,
            level: tip.level ?? 0,
            base_cost: tip.need_skill_point ?? null,
            discounted_cost: tip.discounted_skill_point ?? null,
            icon_url: tip.icon_url,
            skill_category: tip.skill_category ?? null,
            group_id: tip.skill_group_id ?? tip.group_id ?? null,
            rarity: tip.skill_rarity ?? null,
        });
    }

    const availableMap = new Map();
    for (const skill of (data.available_skills || [])) {
        const id = skill.id ?? skill.skill_id ?? null;
        if (!id) continue;
        availableMap.set(id, {
            id,
            name: skill.name,
            need_rank: skill.need_rank ?? 0,
            base_cost: skill.need_skill_point ?? null,
            unlocked: skill.unlocked,
            icon_url: skill.icon_url,
            skill_category: skill.skill_category ?? null,
            group_id: skill.skill_group_id ?? null,
            rarity: skill.skill_rarity ?? null,
            hint_level: 0,
            hint_cost: null,
        });
    }
    for (const [skillId, hint] of hintMap.entries()) {
        const existing = availableMap.get(skillId);
        if (existing) {
            existing.hint_level = Math.max(existing.hint_level, hint.level ?? 0);
            existing.hint_cost = hint.discounted_cost ?? null;
            if (!existing.icon_url && hint.icon_url) {
                existing.icon_url = hint.icon_url;
            }
            if (existing.skill_category == null && hint.skill_category != null) {
                existing.skill_category = hint.skill_category;
            }
            if (existing.group_id == null && hint.group_id != null) {
                existing.group_id = hint.group_id;
            }
            if (existing.rarity == null && hint.rarity != null) {
                existing.rarity = hint.rarity;
            }
        } else {
            availableMap.set(skillId, {
                id: skillId,
                name: hint.name || `Skill ${skillId}`,
                need_rank: 0,
                base_cost: hint.base_cost ?? null,
                unlocked: true,
                icon_url: hint.icon_url,
                skill_category: hint.skill_category ?? null,
                group_id: hint.group_id ?? null,
                rarity: hint.rarity ?? null,
                hint_level: hint.level ?? 0,
                hint_cost: hint.discounted_cost ?? null,
            });
        }
    }

    const groupMap = new Map();
    for (const item of availableMap.values()) {
        if (!item.group_id) continue;
        if (!groupMap.has(item.group_id)) groupMap.set(item.group_id, []);
        groupMap.get(item.group_id).push(item);
    }
    const findGroupPair = (item) => {
        if (!item?.group_id) return {};
        const group = groupMap.get(item.group_id) || [];
        return {
            white: group.find(entry => entry.rarity === 1),
            gold: group.find(entry => entry.rarity === 2),
        };
    };

    const computeSkillCost = (item) => {
        const baseCost = Number.isFinite(item.hint_cost) ? item.hint_cost : item.base_cost;
        if (!Number.isFinite(baseCost)) return null;
        if (item.rarity === 2 && item.group_id && groupMap.has(item.group_id)) {
            const white = groupMap.get(item.group_id).find(entry => entry.rarity === 1);
            if (white && !selectedAvailableSkills.has(white.id)) {
                const whiteCost = Number.isFinite(white.hint_cost) ? white.hint_cost : white.base_cost;
                if (Number.isFinite(whiteCost)) {
                    return baseCost + whiteCost;
                }
            }
        }
        return baseCost;
    };

    availableSkillMeta = new Map();
    for (const item of availableMap.values()) {
        if (item.id) {
            availableSkillMeta.set(item.id, {
                group_id: item.group_id ?? null,
                rarity: item.rarity ?? null,
            });
        }
    }

    const availableItems = Array.from(availableMap.values()).sort((a, b) => {
        const aIsUnique = a.skill_category === 5;
        const bIsUnique = b.skill_category === 5;
        if (aIsUnique !== bIsUnique) return aIsUnique ? -1 : 1;
        const aIsGreen = a.skill_category === 0;
        const bIsGreen = b.skill_category === 0;
        if (aIsGreen !== bIsGreen) return aIsGreen ? -1 : 1;
        const aGroup = a.group_id ?? 0;
        const bGroup = b.group_id ?? 0;
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aRarity = a.rarity ?? 0;
        const bRarity = b.rarity ?? 0;
        if (aRarity !== bRarity) return bRarity - aRarity;
        const rankDiff = (a.need_rank ?? 0) - (b.need_rank ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    availableSkillCosts = new Map();
    for (const item of availableItems) {
        const cost = computeSkillCost(item);
        if (item.id && Number.isFinite(cost)) {
            availableSkillCosts.set(item.id, cost);
        }
    }
    for (const key of Array.from(selectedAvailableSkills)) {
        if (!availableSkillCosts.has(key)) selectedAvailableSkills.delete(key);
    }
    updateAvailableTitle();

    if (availableItems.length) {
        for (const tip of availableItems) {
            const item = document.createElement('div');
            item.className = 'skill-item';
            if (tip.unlocked === false) {
                item.classList.add('locked');
            }
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'skill-check';
            const costValue = computeSkillCost(tip);
            checkbox.disabled = !Number.isFinite(costValue);
            if (tip.id && selectedAvailableSkills.has(tip.id)) {
                checkbox.checked = true;
            }
            checkbox.addEventListener('change', () => {
                if (!tip.id) return;
                const pair = findGroupPair(tip);
                if (checkbox.checked) {
                    selectedAvailableSkills.add(tip.id);
                    if (tip.rarity === 2 && pair.white?.id) {
                        selectedAvailableSkills.add(pair.white.id);
                    }
                } else {
                    selectedAvailableSkills.delete(tip.id);
                    if (tip.rarity === 1 && pair.gold?.id && selectedAvailableSkills.has(pair.gold.id)) {
                        selectedAvailableSkills.delete(pair.gold.id);
                    }
                }
                updateSkillsTab(lastState);
            });
            item.appendChild(checkbox);
            if (tip.icon_url) {
                const img = document.createElement('img');
                img.className = 'skill-icon';
                img.src = tip.icon_url;
                img.alt = tip.name || 'Skill';
                img.onerror = () => {
                    img.onerror = null;
                    img.remove();
                };
                item.appendChild(img);
            }
            const info = document.createElement('div');
            info.className = 'skill-info';
            const text = document.createElement('div');
            text.className = 'skill-text';
            text.textContent = tip.name || 'Skill';
            const meta = document.createElement('span');
            meta.className = 'skill-meta';
            const hintLevel = tip.hint_level ?? 0;
            if (Number.isFinite(costValue)) {
                meta.textContent = `${costValue} SP | Hint Lv ${hintLevel}`;
            } else {
                meta.textContent = `Hint Lv ${hintLevel}`;
            }
            if (tip.unlocked === false) {
                meta.classList.add('locked');
            }
            info.appendChild(text);
            info.appendChild(meta);
            item.appendChild(info);
            if (hintLevel > 0) {
                const hint = document.createElement('img');
                hint.className = 'skill-hint-icon';
                hint.src = '/assets/icons/hint.png';
                hint.alt = 'Hint';
                item.appendChild(hint);
            }
            tips.appendChild(item);
        }
    } else {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No available skills';
        tips.appendChild(empty);
    }

    const rawJson = $('skills-raw-json');
    if (rawJson) {
        const compactSkills = (data.skills || []).map(({ icon_url, ...rest }) => rest);
        const compactHints = (data.skill_tips || []).map(({ icon_url, ...rest }) => rest);
        const compactAvailable = (data.available_skills || []).map(({ icon_url, ...rest }) => rest);
        rawJson.textContent = JSON.stringify({
            chara: {
                id: data.chara_id ?? null,
                name: data.chara_name ?? null,
            },
            stats: {
                speed: stats.speed ?? 0,
                stamina: stats.stamina ?? 0,
                power: stats.power ?? 0,
                guts: stats.guts ?? 0,
                wit: stats.wisdom ?? 0,
                skill_pts: stats.skill_pts ?? 0,
                energy: stats.energy ?? 0,
                motivation: stats.motivation ?? 0,
            },
            aptitudes: data.aptitudes || {},
            skills: compactSkills,
            skill_hints: compactHints,
            available_skills: compactAvailable,
        }, null, 2);
    }

    const conditions = $('skills-conditions');
    conditions.innerHTML = '';
    if (data.conditions && data.conditions.length) {
        for (const cond of data.conditions) {
            const tag = document.createElement('span');
            tag.className = 'skill-tag';
            tag.textContent = `Effect ${cond}`;
            conditions.appendChild(tag);
        }
    } else {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'Nothing of note';
        conditions.appendChild(empty);
    }
}

function classFromTurn(turn) {
    if (!turn) return null;
    if (turn >= 49) return 'Senior';
    if (turn >= 25) return 'Classic';
    if (turn >= 13) return 'Junior';
    return 'Pre-Debut';
}

function classFromYear(year) {
    const yr = Number(year);
    if (yr === 1) return 'Junior';
    if (yr === 2) return 'Classic';
    if (yr === 3) return 'Senior';
    return null;
}

function racePill(label, iconUrl, options = {}) {
    const pill = document.createElement('span');
    pill.className = 'race-pill';
    if (options.className) {
        pill.classList.add(options.className);
    }
    if (iconUrl) {
        const img = document.createElement('img');
        img.className = 'race-pill-icon';
        img.src = iconUrl;
        img.alt = label || '';
        pill.appendChild(img);
    }
    if (label) {
        const text = document.createElement('span');
        text.textContent = label;
        pill.appendChild(text);
    }
    return pill;
}

function seasonFromMonth(month) {
    if (!month) return null;
    const m = Number(month);
    if ([12, 1, 2].includes(m)) {
        return { label: 'Winter', icon: '/assets/icons/utx_txt_season_03.png' };
    }
    if ([3, 4, 5].includes(m)) {
        return { label: 'Spring', icon: '/assets/icons/utx_txt_season_00.png' };
    }
    if ([6, 7, 8].includes(m)) {
        return { label: 'Summer', icon: '/assets/icons/utx_txt_season_01.png' };
    }
    return { label: 'Autumn', icon: '/assets/icons/utx_txt_season_02.png' };
}

function seasonFromValue(value) {
    const map = {
        1: { label: 'Spring', icon: '/assets/icons/utx_txt_season_00.png' },
        2: { label: 'Summer', icon: '/assets/icons/utx_txt_season_01.png' },
        3: { label: 'Autumn', icon: '/assets/icons/utx_txt_season_02.png' },
        4: { label: 'Winter', icon: '/assets/icons/utx_txt_season_03.png' },
    };
    return map[Number(value)] || null;
}

function weatherFromValue(value) {
    const map = {
        0: { label: 'Sunny', icon: '/assets/icons/utx_ico_weather_00.png' },
        1: { label: 'Cloudy', icon: '/assets/icons/utx_ico_weather_01.png' },
        2: { label: 'Rainy', icon: '/assets/icons/utx_ico_weather_02.png' },
        3: { label: 'Snowy', icon: '/assets/icons/utx_ico_weather_03.png' },
    };
    return map[Number(value)] || null;
}

function timeFromValue(value) {
    const map = {
        0: { label: 'Daytime', icon: '/assets/icons/utx_ico_timezone_00.png' },
        1: { label: 'Evening', icon: '/assets/icons/utx_ico_timezone_01.png' },
        2: { label: 'Night', icon: '/assets/icons/utx_ico_timezone_02.png' },
    };
    return map[Number(value)] || null;
}

function groundConditionFromValue(value) {
    const map = {
        1: 'Firm',
        2: 'Good',
        3: 'Soft',
        4: 'Heavy',
    };
    return map[Number(value)] || null;
}

function monthToSeasonValue(month) {
    if (!month) return null;
    const m = Number(month);
    if ([3, 4, 5].includes(m)) return 1;
    if ([6, 7, 8].includes(m)) return 2;
    if ([9, 10, 11].includes(m)) return 3;
    return 4;
}

async function encodeUmalatorState(payload) {
    if (!('CompressionStream' in window)) return null;
    const json = JSON.stringify(payload);
    const encoded = new TextEncoder().encode(json);
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoded);
            controller.close();
        }
    }).pipeThrough(new CompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    return encodeURIComponent(btoa(binary));
}

function distanceTypeFromMeters(meters) {
    if (!meters) return null;
    const m = Number(meters);
    if (m <= 1400) return 'Sprint';
    if (m <= 1800) return 'Mile';
    if (m <= 2400) return 'Medium';
    return 'Long';
}

function surfaceLabelFromGround(ground) {
    return Number(ground) === 2 ? 'Dirt' : 'Turf';
}

function findStatsDefaultPreset() {
    if (!umalatorPresets.length) return null;
    const pickByName = (pattern) => umalatorPresets.find(p => (p.name || '').toLowerCase().includes(pattern));
    return pickByName('sagittarius') || pickByName('champions meeting') || umalatorPresets[0];
}

function getOptimizerTargets() {
    const read = (id, fallback) => {
        const value = Number($(id)?.value);
        return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : fallback;
    };
    return {
        survival: read('optimizer-target-survival', 50),
        spurt: read('optimizer-target-spurt', 50),
        finalLeg: read('optimizer-target-finalleg', 0),
    };
}

function formatRate(value) {
    if (!Number.isFinite(value)) return '--';
    return `${(value * 100).toFixed(1)}%`;
}

function getBaseSkillPoints() {
    if (!lastState) return 0;
    const stats = lastState.training?.stats || {};
    const fallback = lastState.raw_data?.data?.chara_info?.skill_point;
    const value = Number(stats.skill_pts ?? fallback ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function normalizeSkillSet(skillIds) {
    const final = new Set(skillIds);
    const groupMap = new Map();
    for (const id of final) {
        const meta = availableSkillMeta.get(id);
        if (!meta?.group_id) continue;
        const existing = groupMap.get(meta.group_id);
        if (!existing || (meta.rarity ?? 0) > (existing.rarity ?? 0)) {
            groupMap.set(meta.group_id, { id, rarity: meta.rarity ?? 0 });
        }
    }
    for (const [groupId, top] of groupMap.entries()) {
        for (const id of Array.from(final)) {
            const meta = availableSkillMeta.get(id);
            if (!meta?.group_id || meta.group_id !== groupId) continue;
            if (id !== top.id && (meta.rarity ?? 0) < (top.rarity ?? 0)) {
                final.delete(id);
            }
        }
    }
    return Array.from(final);
}

function buildCurrentUmaForUmalator(context = {}) {
    if (!lastState) return null;
    const skillsTab = lastState.skills_tab || {};
    const stats = lastState.training?.stats || {};
    const aptitudes = skillsTab.aptitudes || {};
    const runningStyle = (selectedStatsStyle && selectedStatsStyle !== 'auto')
        ? selectedStatsStyle
        : (skillsTab.running_style || 'Pace');
    const styleMap = {
        Front: { strategy: 'Nige', label: 'Front' },
        Pace: { strategy: 'Senkou', label: 'Pace' },
        Late: { strategy: 'Sasi', label: 'Late' },
        End: { strategy: 'Oikomi', label: 'End' },
    };
    const style = styleMap[runningStyle] || styleMap.Pace;
    const distanceType = context.distanceType || null;
    const surfaceLabel = context.surfaceLabel || null;
    return {
        outfitId: skillsTab.card_id ? String(skillsTab.card_id) : '',
        speed: stats.speed ?? 0,
        stamina: stats.stamina ?? 0,
        power: stats.power ?? 0,
        guts: stats.guts ?? 0,
        wisdom: stats.wisdom ?? 0,
        strategy: style.strategy,
        distanceAptitude: distanceType ? (aptitudes.distance?.[distanceType] || 'A') : 'A',
        surfaceAptitude: surfaceLabel ? (aptitudes.track?.[surfaceLabel] || 'A') : 'A',
        strategyAptitude: aptitudes.style?.[style.label] || 'A',
        skills: (skillsTab.skills || []).map(s => s.id ?? s.skill_id).filter(Boolean),
    };
}

async function buildStatsUmalatorPayload() {
    if (!lastState) return null;
    if (!selectedStatsPreset && umalatorPresets.length) {
        selectedStatsPreset = findStatsDefaultPreset() || umalatorPresets[0];
    }
    const preset = selectedStatsPreset;
    const courseId = preset?.courseId || null;
    let courseInfo = null;
    if (courseId) {
        try {
            const res = await fetch(`/api/course-set/${courseId}`);
            courseInfo = await res.json();
        } catch (e) {
            courseInfo = null;
        }
    }
    const distanceMeters = courseInfo?.distance_m ?? preset?.distance_m ?? null;
    const distanceType = distanceTypeFromMeters(distanceMeters);
    const surfaceLabel = courseInfo?.ground
        ? surfaceLabelFromGround(courseInfo.ground)
        : (preset?.is_dirt === true ? 'Dirt' : preset?.is_dirt === false ? 'Turf' : null);
    const context = { distanceType, surfaceLabel };
    const uma1 = buildCurrentUmaForUmalator(context);
    if (!uma1) return null;
    const selectedSkillIds = (() => {
        const selected = new Set(Array.from(selectedAvailableSkills || []).filter(Boolean));
        const groupSelected = new Map();
        for (const id of selected) {
            const meta = availableSkillMeta.get(id);
            if (!meta?.group_id) continue;
            const existing = groupSelected.get(meta.group_id);
            if (!existing || (meta.rarity ?? 0) > (existing.rarity ?? 0)) {
                groupSelected.set(meta.group_id, { id, rarity: meta.rarity ?? 0 });
            }
        }
        for (const [groupId, top] of groupSelected.entries()) {
            if (top.rarity === 2) {
                for (const [id, meta] of availableSkillMeta.entries()) {
                    if (meta.group_id === groupId && meta.rarity === 1) {
                        selected.delete(id);
                    }
                }
            }
        }
        return Array.from(selected);
    })();
    const uma2 = {
        ...uma1,
        skills: (() => {
            const merged = new Set([...(uma1.skills || []), ...selectedSkillIds]);
            for (const id of selectedSkillIds) {
                const meta = availableSkillMeta.get(id);
                if (meta?.rarity === 2 && meta.group_id) {
                    for (const [candidateId, candidateMeta] of availableSkillMeta.entries()) {
                        if (candidateMeta.group_id === meta.group_id && candidateMeta.rarity === 1) {
                            merged.delete(candidateId);
                        }
                    }
                }
            }
            return Array.from(merged);
        })(),
    };

    const payload = courseId ? {
        courseId,
        nsamples: 1000,
        seed: 0,
        usePosKeep: false,
        useIntChecks: false,
        racedef: {
            mood: lastState.training?.stats?.motivation ?? 3,
            ground: preset?.ground ?? 1,
            groundCondition: preset?.ground ?? 1,
            weather: preset?.weather ?? 1,
            season: preset?.season ?? 1,
            time: preset?.time ?? 2,
            grade: 100,
            popularity: 1,
            skillId: '',
            orderRange: null,
            numUmas: 2,
        },
        uma1,
        uma2,
    } : { uma1, uma2 };
    return { payload, uma1, uma2 };
}

async function openStatsUmalator() {
    const data = await buildStatsUmalatorPayload();
    if (!data) return;
    const { payload } = data;
    const hash = await encodeUmalatorState(payload);
    const baseUrl = 'https://kachi-dev.github.io/uma-tools/umalator-global/';
    if (!hash) {
        window.open(baseUrl, '_blank');
        return;
    }
    window.open(`${baseUrl}#${hash}`, '_blank');
}

function ensureStatsUmalatorFrame() {
    if (statsUmalatorFrame) return statsUmalatorFrame;
    const frame = document.createElement('iframe');
    frame.className = 'umalator-hidden-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.appendChild(frame);
    statsUmalatorFrame = frame;
    return frame;
}

function updateStatsUmalatorResults(values, { loading = false } = {}) {
    const container = $('stats-umalator-results');
    if (!container) return;
    container.classList.toggle('loading', loading);
    const lines = container.querySelectorAll('.umalator-check-line');
    const withSkills = values?.withSkills ?? '--';
    const base = values?.base ?? '--';
    const draw = values?.draw ?? '--';
    if (lines[0]) lines[0].textContent = `Selected Skills Win Rate: ${withSkills}`;
    if (lines[1]) lines[1].textContent = `Current Build Win Rate: ${base}`;
    if (lines[2]) lines[2].textContent = `Draw Rate: ${draw}`;
}

async function loadUmalatorCourseData() {
    if (umalatorCourseData) return umalatorCourseData;
    try {
        const res = await fetch('/static/umalator/course_data.json');
        umalatorCourseData = await res.json();
    } catch (e) {
        umalatorCourseData = null;
    }
    return umalatorCourseData;
}

async function getUmalatorCourse(courseId) {
    if (!courseId) return null;
    const data = await loadUmalatorCourseData();
    if (!data) return null;
    return data[String(courseId)] || null;
}

function summarizeCompareResults(results) {
    if (!results || !results.length) return null;
    let baseWins = 0;
    let skillWins = 0;
    let draws = 0;
    // Umalator compare results: negative = uma1 faster, positive = uma2 faster.
    for (const value of results) {
        if (value > 0) {
            skillWins += 1;
        } else if (value < 0) {
            baseWins += 1;
        } else {
            draws += 1;
        }
    }
    const total = results.length;
    const formatRate = (count) => `${((count / total) * 100).toFixed(1)}%`;
    return {
        withSkills: formatRate(skillWins),
        base: formatRate(baseWins),
        draw: formatRate(draws),
    };
}

function extractCompareMean(results) {
    if (!results || !results.length) return 0;
    return results.reduce((sum, value) => sum + value, 0) / results.length;
}

async function runUmalatorCompare({ payload, course, uma2Skills, nsamples = 400 }) {
    const uma2 = {
        ...payload.uma1,
        skills: normalizeSkillSet([...(payload.uma1.skills || []), ...(uma2Skills || [])]),
    };
    const worker = new Worker('/static/umalator/simulator.worker.js');
    const compareResult = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), 30000);
        worker.onmessage = (event) => {
            if (event.data?.type !== 'compare') return;
            const result = event.data?.results || null;
            const resultCount = result?.results?.length || 0;
            if (resultCount >= nsamples) {
                clearTimeout(timer);
                finish(result);
            }
        };
        worker.onerror = () => finish(null);
        worker.postMessage({
            msg: 'compare',
            data: {
                nsamples,
                course,
                racedef: payload.racedef,
                uma1: payload.uma1,
                uma2,
                options: {
                    seed: payload.seed || 0,
                    usePosKeep: !!payload.usePosKeep,
                    useIntChecks: !!payload.useIntChecks,
                },
            },
        });
    });
    worker.terminate();
    return compareResult;
}

async function runUmalatorChart({ payload, course, skills }) {
    if (!skills.length) return new Map();
    const worker = new Worker('/static/umalator/simulator.worker.js');
    const results = await new Promise((resolve) => {
        let lastResult = null;
        let bestResult = null;
        let bestCount = 0;
        const timer = setTimeout(() => resolve(bestResult || lastResult), 15000);
        worker.onmessage = (event) => {
            if (event.data?.type !== 'chart') return;
            lastResult = event.data?.results || lastResult;
            let currentCount = 0;
            if (lastResult && typeof lastResult.size === 'number') {
                currentCount = lastResult.size;
            } else if (lastResult && typeof lastResult === 'object') {
                currentCount = Object.keys(lastResult).length;
            }
            if (currentCount > bestCount) {
                bestCount = currentCount;
                bestResult = lastResult;
            }
            const anyValue = lastResult?.values?.().next?.()?.value;
            const sampleSize = anyValue?.results?.length || 0;
            if (sampleSize >= 200 && currentCount > 0) {
                clearTimeout(timer);
                resolve(lastResult);
            }
        };
        worker.onerror = () => resolve(bestResult || lastResult);
        worker.postMessage({
            msg: 'chart',
            data: {
                skills,
                course,
                racedef: payload.racedef,
                uma: payload.uma1,
                options: {
                    seed: payload.seed || 0,
                    usePosKeep: !!payload.usePosKeep,
                    useIntChecks: false,
                },
            },
        });
    });
    worker.terminate();
    return results;
}

async function runUmalatorSkillMeta(skillIds) {
    if (!skillIds.length) return {};
    const worker = new Worker('/static/umalator/simulator.worker.js');
    const results = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value || {});
        };
        const timer = setTimeout(() => finish({}), 10000);
        worker.onmessage = (event) => {
            if (event.data?.type !== 'skillmeta') return;
            clearTimeout(timer);
            finish(event.data?.results || {});
        };
        worker.onerror = () => finish({});
        worker.postMessage({
            msg: 'skillmeta',
            data: { skills: skillIds },
        });
    });
    worker.terminate();
    return results;
}

function chartResultsToMap(results) {
    const map = new Map();
    if (!results) return map;
    if (typeof results.forEach === 'function') {
        results.forEach((value, key) => {
            map.set(String(key), value?.mean ?? 0);
        });
        return map;
    }
    for (const [key, value] of Object.entries(results)) {
        map.set(String(key), value?.mean ?? 0);
    }
    return map;
}

function getChartMeta(results) {
    if (!results) return { size: 0, sampleSize: 0 };
    let size = 0;
    if (typeof results.size === 'number') {
        size = results.size;
    } else if (typeof results === 'object') {
        size = Object.keys(results).length;
    }
    const anyValue = results?.values?.().next?.()?.value;
    const sampleSize = anyValue?.results?.length || 0;
    return { size, sampleSize };
}

function updateOptimizerBuildSummary(build) {
    const summary = $('optimizer-build-summary');
    if (!summary) return;
    if (!build) {
        summary.textContent = optimizerBuildStatus || 'No build selected';
        return;
    }
    const extra = (build.nonRecoveryCount != null && build.recoveryCount != null)
        ? ` | Non-Recovery ${build.nonRecoveryCount} | Recovery ${build.recoveryCount}`
        : '';
    summary.textContent = `SP ${build.cost} | Mean ${build.mean.toFixed(2)} | Survival ${formatRate(build.metrics?.survival ?? null)} | Spurt ${formatRate(build.metrics?.spurt ?? null)} | Final Leg ${formatRate(build.metrics?.finalLeg ?? null)}${extra}`;
}

function updateOptimizerBuildSelect() {
    const select = $('optimizer-build-select');
    if (!select) return;
    select.innerHTML = '';
    if (!optimizerBuilds.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No builds';
        select.appendChild(option);
        return;
    }
    optimizerBuilds.forEach((build, idx) => {
        const option = document.createElement('option');
        option.value = String(idx);
        option.textContent = build.name;
        select.appendChild(option);
    });
    select.value = '0';
    applyOptimizerBuild(optimizerBuilds[0]);
}

function applyOptimizerBuild(build) {
    if (!build) return;
    selectedAvailableSkills = new Set(build.skills);
    updateSkillsTab(lastState);
    updateOptimizerBuildSummary(build);
}

async function generateOptimizerBuilds() {
    if (!lastState) return;
    const data = await buildStatsUmalatorPayload();
    if (!data?.payload?.courseId) return;
    const { payload } = data;
    const course = await getUmalatorCourse(payload.courseId);
    if (!course) return;

    const basePoints = getBaseSkillPoints();
    const targets = getOptimizerTargets();
    optimizerBuildStatus = 'Generating builds...';
    updateOptimizerBuildSummary(null);

    const availableIds = Array.from(availableSkillCosts.keys());
    if (!availableIds.length) {
        optimizerBuildStatus = 'No available skills to build from (skill list empty).';
        updateOptimizerBuildSummary(null);
        return;
    }

    const skillMeta = await runUmalatorSkillMeta(availableIds);
    const recoveryIds = availableIds.filter(id => skillMeta[id]?.isRecovery);
    const nonRecoveryIds = availableIds.filter(id => !skillMeta[id]?.isRecovery);

    const chartResults = await runUmalatorChart({ payload, course, skills: nonRecoveryIds });
    const chartMeans = chartResultsToMap(chartResults);
    if (!chartMeans.size && nonRecoveryIds.length) {
        optimizerBuildStatus = 'Chart data empty; running per-skill compare fallback...';
        updateOptimizerBuildSummary(null);
        for (const id of nonRecoveryIds.slice(0, 30)) {
            const compareResult = await runUmalatorCompare({
                payload,
                course,
                uma2Skills: [id],
                nsamples: 150,
            });
            if (!compareResult) continue;
            chartMeans.set(id, extractCompareMean(compareResult.results || []));
        }
    }

    const ignoredSkills = new Set(['200271', '200272']);
    const nonRecoveryCandidates = nonRecoveryIds
        .filter(id => !ignoredSkills.has(id))
        .map(id => ({
            id,
            cost: availableSkillCosts.get(id) || 0,
            mean: chartMeans.get(id) || 0,
        }))
        .filter(item => item.mean > 0 && item.cost > 0)
        .sort((a, b) => b.mean - a.mean);
    if (!nonRecoveryCandidates.length) {
        optimizerBuildStatus = `No positive chart skills found. Recovery-only builds (skills: ${availableIds.length}, recovery: ${recoveryIds.length}).`;
    }

    const recoveryCandidates = recoveryIds
        .map(id => ({ id, cost: availableSkillCosts.get(id) || 0 }))
        .filter(item => item.cost > 0)
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 10);

    const combos = [[]];
    for (const item of recoveryCandidates) {
        const snapshot = combos.slice();
        snapshot.forEach((combo) => {
            if (combo.length >= 3) return;
            combos.push([...combo, item]);
        });
    }
    const recoveryCombos = combos
        .map(combo => ({
            ids: combo.map(item => item.id),
            cost: combo.reduce((sum, item) => sum + item.cost, 0),
        }))
        .filter(combo => combo.cost <= basePoints)
        .slice(0, 12);

    const evaluatedRecovery = [];
    for (const combo of recoveryCombos) {
        const compareResult = await runUmalatorCompare({
            payload,
            course,
            uma2Skills: combo.ids,
            nsamples: 300,
        });
        if (!compareResult) continue;
        evaluatedRecovery.push({
            ...combo,
            metrics: compareResult.metrics || {},
        });
    }

    const meetsTargets = (metrics) => {
        const survival = (metrics?.survival ?? 0) * 100;
        const spurt = (metrics?.spurt ?? 0) * 100;
        const finalLeg = (metrics?.finalLeg ?? 0) * 100;
        return survival >= targets.survival && spurt >= targets.spurt && finalLeg >= targets.finalLeg;
    };

    let baseCombos = evaluatedRecovery.filter(entry => meetsTargets(entry.metrics));
    if (!baseCombos.length) {
        baseCombos = evaluatedRecovery.sort((a, b) => {
            const aSurv = a.metrics?.survival ?? 0;
            const bSurv = b.metrics?.survival ?? 0;
            if (aSurv !== bSurv) return bSurv - aSurv;
            const aSpurt = a.metrics?.spurt ?? 0;
            const bSpurt = b.metrics?.spurt ?? 0;
            return bSpurt - aSpurt;
        }).slice(0, 3);
    }

    const builds = [];
    const baseSkillSet = new Set(payload.uma1.skills || []);
    for (const combo of baseCombos) {
        let remaining = basePoints - combo.cost;
        const skills = [...combo.ids];
        for (const candidate of nonRecoveryCandidates) {
            if (candidate.cost <= remaining) {
                skills.push(candidate.id);
                remaining -= candidate.cost;
            }
        }
        const normalized = normalizeSkillSet(skills);
        const buildCost = normalized.reduce((sum, id) => sum + (availableSkillCosts.get(id) || 0), 0);
        if (buildCost > basePoints) continue;
        const compareResult = await runUmalatorCompare({
            payload,
            course,
            uma2Skills: normalized,
            nsamples: 500,
        });
        if (!compareResult) continue;
        const mean = extractCompareMean(compareResult.results || []);
        const addedSkills = normalized.filter((id) => !baseSkillSet.has(id));
        const recoveryCount = addedSkills.filter((id) => skillMeta[id]?.isRecovery).length;
        const nonRecoveryCount = addedSkills.length - recoveryCount;
        builds.push({
            name: `Build ${builds.length + 1}`,
            skills: normalized,
            cost: buildCost,
            mean,
            metrics: compareResult.metrics || {},
            recoveryCount,
            nonRecoveryCount,
        });
        if (builds.length >= 8) break;
    }

    optimizerBuilds = builds
        .sort((a, b) => b.mean - a.mean)
        .slice(0, 5)
        .map((build, idx) => ({ ...build, name: `Build ${idx + 1}` }));

    optimizerBuildStatus = optimizerBuilds.length ? '' : 'No viable builds found.';
    updateOptimizerBuildSelect();
    updateOptimizerBuildSummary(optimizerBuilds[0] || null);
}

async function runStatsUmalatorCheck() {
    const data = await buildStatsUmalatorPayload();
    if (!data) return;
    const { payload } = data;
    if (!payload?.courseId) {
        updateStatsUmalatorResults({ withSkills: '--', base: '--', draw: '--' }, { loading: false });
        return;
    }
    const course = await getUmalatorCourse(payload.courseId);
    if (!course) {
        updateStatsUmalatorResults({ withSkills: '--', base: '--', draw: '--' }, { loading: false });
        return;
    }

    const checkId = ++statsUmalatorCheckId;
    updateStatsUmalatorResults({ withSkills: 'Running...', base: 'Running...', draw: 'Running...' }, { loading: true });

    const worker = new Worker('/static/umalator/simulator.worker.js');
    const nsamples = payload.nsamples || 1000;
    const compareResult = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), 30000);
        worker.onmessage = (event) => {
            if (checkId !== statsUmalatorCheckId) return;
            if (event.data?.type !== 'compare') return;
            const result = event.data?.results || null;
            const resultCount = result?.results?.length || 0;
            if (resultCount >= nsamples) {
                clearTimeout(timer);
                finish(result);
            }
        };
        worker.onerror = () => finish(null);
        worker.postMessage({
            msg: 'compare',
            data: {
                nsamples,
                course,
                racedef: payload.racedef,
                uma1: payload.uma1,
                uma2: payload.uma2,
                options: {
                    seed: payload.seed || 0,
                    usePosKeep: !!payload.usePosKeep,
                    useIntChecks: !!payload.useIntChecks,
                },
            },
        });
    });
    worker.terminate();

    if (!compareResult || checkId !== statsUmalatorCheckId) {
        updateStatsUmalatorResults({ withSkills: '--', base: '--', draw: '--' }, { loading: false });
        return;
    }

    const summary = summarizeCompareResults(compareResult.results || []);
    if (!summary) {
        updateStatsUmalatorResults({ withSkills: '--', base: '--', draw: '--' }, { loading: false });
        return;
    }

    updateStatsUmalatorResults(summary, { loading: false });
}
async function openUmalator(item) {
    if (!item?.course_set || !lastState) {
        window.open('https://kachi-dev.github.io/uma-tools/umalator-global/', '_blank');
        return;
    }
    const skillsTab = lastState.skills_tab || {};
    const stats = lastState.training?.stats || {};
    const aptitudes = skillsTab.aptitudes || {};
    const runningStyle = skillsTab.running_style || 'Pace';
    const styleMap = {
        Front: { strategy: 'Nige', label: 'Front' },
        Pace: { strategy: 'Senkou', label: 'Pace' },
        Late: { strategy: 'Sasi', label: 'Late' },
        End: { strategy: 'Oikomi', label: 'End' },
    };
    const style = styleMap[runningStyle] || styleMap.Pace;
    const distanceType = item.distance_type || null;
    const surfaceLabel = item.ground_label || (item.ground === 1 ? 'Turf' : 'Dirt');

    const uma1 = {
        outfitId: skillsTab.card_id ? String(skillsTab.card_id) : '',
        speed: stats.speed ?? 0,
        stamina: stats.stamina ?? 0,
        power: stats.power ?? 0,
        guts: stats.guts ?? 0,
        wisdom: stats.wisdom ?? 0,
        strategy: style.strategy,
        distanceAptitude: aptitudes.distance?.[distanceType] || 'A',
        surfaceAptitude: aptitudes.track?.[surfaceLabel] || 'A',
        strategyAptitude: aptitudes.style?.[style.label] || 'A',
        skills: (skillsTab.skills || []).map(s => s.id ?? s.skill_id).filter(Boolean),
    };

    const seasonValue = item.season ?? monthToSeasonValue(item.month) ?? 1;
    const uma2 = {
        outfitId: '',
        speed: 1200,
        stamina: 1200,
        power: 800,
        guts: 400,
        wisdom: 400,
        strategy: 'Senkou',
        distanceAptitude: 'S',
        surfaceAptitude: 'A',
        strategyAptitude: 'A',
        skills: [],
    };

    const payload = {
        courseId: item.course_set,
        nsamples: 1000,
        seed: 0,
        usePosKeep: false,
        useIntChecks: false,
        racedef: {
            mood: stats.motivation ?? 3,
            groundCondition: item.ground_condition ?? 1,
            weather: item.weather ?? 1,
            season: seasonValue,
            time: item.time_zone ?? 2,
            grade: item.grade ?? 100,
            popularity: 1,
            skillId: '',
            orderRange: null,
            numUmas: 9,
        },
        uma1,
        uma2,
    };

    const hash = await encodeUmalatorState(payload);
    const baseUrl = 'https://kachi-dev.github.io/uma-tools/umalator-global/';
    if (!hash) {
        window.open(baseUrl, '_blank');
        return;
    }
    window.open(`${baseUrl}#${hash}`, '_blank');
}

function showUmalatorError(message) {
    const modal = $('veteran-error-modal');
    const text = $('veteran-error-message');
    if (text) text.textContent = message || 'Select Uma 1 and Uma 2 first.';
    if (modal) modal.style.display = 'flex';
}

function buildVeteranUma(item, context = {}) {
    if (!item) return null;
    const stats = item.stats || {};
    const aptitudes = item.aptitudes || {};
    const runningStyle = item.running_style || 'Pace';
    const styleMap = {
        Front: { strategy: 'Nige', label: 'Front' },
        Pace: { strategy: 'Senkou', label: 'Pace' },
        Late: { strategy: 'Sasi', label: 'Late' },
        End: { strategy: 'Oikomi', label: 'End' },
    };
    const style = styleMap[runningStyle] || styleMap.Pace;
    const order = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];
    const maxApt = (values) => {
        if (!values) return 'A';
        let best = 'G';
        for (const value of Object.values(values)) {
            if (order.indexOf(value) > order.indexOf(best)) best = value;
        }
        return best || 'A';
    };
    const distanceType = context.distanceType || null;
    const surfaceLabel = context.surfaceLabel || null;
    return {
        outfitId: item.card_id ? String(item.card_id) : '',
        speed: stats.speed ?? 0,
        stamina: stats.stamina ?? 0,
        power: stats.power ?? 0,
        guts: stats.guts ?? 0,
        wisdom: stats.wit ?? 0,
        strategy: style.strategy,
        distanceAptitude: distanceType ? (aptitudes.distance?.[distanceType] || 'A') : (maxApt(aptitudes.distance) || 'A'),
        surfaceAptitude: surfaceLabel ? (aptitudes.track?.[surfaceLabel] || 'A') : (maxApt(aptitudes.track) || 'A'),
        strategyAptitude: aptitudes.style?.[style.label] || 'A',
        skills: (item.skills || []).map(s => s.id ?? s.skill_id).filter(Boolean),
    };
}

function buildVeteranUmaFromData(data, context = {}) {
    if (!data) return null;
    const stats = data.stats || {};
    const aptitudes = data.aptitudes || {};
    const order = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];
    const maxApt = (values) => {
        if (!values) return 'A';
        let best = 'G';
        for (const value of Object.values(values)) {
            if (order.indexOf(value) > order.indexOf(best)) best = value;
        }
        return best || 'A';
    };
    const distanceType = context.distanceType || null;
    const surfaceLabel = context.surfaceLabel || null;
    return {
        outfitId: data.chara?.id ? String(data.chara.id) : '',
        speed: stats.speed ?? 0,
        stamina: stats.stamina ?? 0,
        power: stats.power ?? 0,
        guts: stats.guts ?? 0,
        wisdom: stats.wit ?? 0,
        strategy: 'Senkou',
        distanceAptitude: distanceType ? (aptitudes.distance?.[distanceType] || 'A') : (maxApt(aptitudes.distance) || 'A'),
        surfaceAptitude: surfaceLabel ? (aptitudes.track?.[surfaceLabel] || 'A') : (maxApt(aptitudes.track) || 'A'),
        strategyAptitude: maxApt(aptitudes.style) || 'A',
        skills: (data.skills || []).map(s => s.id ?? s.skill_id).filter(Boolean),
    };
}

async function openVeteranUmalator() {
    if (!selectedVeteranUma1 && !cachedVeteranUma1Data) {
        showUmalatorError('Select Uma 1 first.');
        return;
    }
    if (!selectedVeteranUma2 && !cachedVeteranUma2Data) {
        showUmalatorError('Select Uma 2 first.');
        return;
    }
    const preset = selectedPreset;
    const courseId = preset?.courseId || null;
    let courseInfo = null;
    if (courseId) {
        try {
            const res = await fetch(`/api/course-set/${courseId}`);
            courseInfo = await res.json();
        } catch (e) {
            courseInfo = null;
        }
    }
    const distanceMeters = courseInfo?.distance_m ?? preset?.distance_m ?? null;
    const distanceType = distanceTypeFromMeters(distanceMeters);
    const surfaceLabel = courseInfo?.ground
        ? surfaceLabelFromGround(courseInfo.ground)
        : (preset?.is_dirt === true ? 'Dirt' : preset?.is_dirt === false ? 'Turf' : null);
    const context = { distanceType, surfaceLabel };

    const uma1 = selectedVeteranUma1
        ? buildVeteranUma(selectedVeteranUma1, context)
        : buildVeteranUmaFromData(cachedVeteranUma1Data, context);
    const uma2 = selectedVeteranUma2
        ? buildVeteranUma(selectedVeteranUma2, context)
        : buildVeteranUmaFromData(cachedVeteranUma2Data, context);
    if (!uma1 || !uma2) {
        showUmalatorError('Missing veteran data for Uma 1 or Uma 2.');
        return;
    }
    const payload = courseId ? {
        courseId,
        nsamples: 1000,
        seed: 0,
        usePosKeep: false,
        useIntChecks: false,
        racedef: {
            mood: 2,
            ground: preset?.ground ?? 1,
            weather: preset?.weather ?? 1,
            season: preset?.season ?? 1,
            time: preset?.time ?? 2,
            grade: 100,
        },
        uma1,
        uma2,
    } : { uma1, uma2 };
    const hash = await encodeUmalatorState(payload);
    const baseUrl = 'https://kachi-dev.github.io/uma-tools/umalator-global/';
    if (!hash) {
        window.open(baseUrl, '_blank');
        return;
    }
    window.open(`${baseUrl}#${hash}`, '_blank');
}

function renderRaceRow(list, item) {
    const row = document.createElement('div');
    row.className = 'race-item';

    const label = document.createElement('div');
    label.className = 'race-label';
    const line1 = document.createElement('div');
    const line2 = document.createElement('div');
    if (item.turn) {
        line1.textContent = `Turn ${item.turn}`;
    } else {
        line1.textContent = item.kind === 'objective' ? 'Turn -' : (item.year ? `Year ${item.year}` : 'Race');
    }
    const classLabel = item.kind === 'objective'
        ? classFromTurn(item.turn)
        : classFromYear(item.year);
    const halfLabel = item.half === 1 ? 'Early' : item.half === 2 ? 'Late' : null;
    const monthNames = {
        1: 'January', 2: 'February', 3: 'March', 4: 'April',
        5: 'May', 6: 'June', 7: 'July', 8: 'August',
        9: 'September', 10: 'October', 11: 'November', 12: 'December',
    };
    const monthLabel = item.month ? monthNames[item.month] || `M${item.month}` : null;
    const timing = (halfLabel && monthLabel) ? `${halfLabel} ${monthLabel}` : (item.timing || null);
    if (classLabel || timing) {
        line2.textContent = `${classLabel || ''}${classLabel && timing ? ' ' : ''}${timing || ''}`.trim();
    }
    label.appendChild(line1);
    if (line2.textContent) {
        label.appendChild(line2);
    }
    const gradeIconMap = {
        "G1": "/assets/icons/utx_txt_grade_ribbon_05.png",
        "G2": "/assets/icons/utx_txt_grade_ribbon_04.png",
        "G3": "/assets/icons/utx_txt_grade_ribbon_03.png",
        "OP/Listed": "/assets/icons/utx_txt_grade_ribbon_02.png",
        "Pre-OP": "/assets/icons/utx_txt_grade_ribbon_06.png",
        "Maiden": "/assets/icons/utx_txt_grade_ribbon_01.png",
        "Debut": "/assets/icons/utx_txt_grade_ribbon_01.png",
        "Class": "/assets/icons/utx_txt_grade_ribbon_07.png",
    };
    if (item.grade_label || item.grade) {
        const labelText = item.grade_label ? item.grade_label : `Grade ${item.grade}`;
        label.appendChild(racePill(null, gradeIconMap[labelText], { className: 'race-pill-grade' }));
    }
    if (item.need_fans) {
        const fans = document.createElement('div');
        fans.textContent = `Fan Req: ${item.need_fans}`;
        label.appendChild(fans);
    }
    if (item.kind === 'objective') {
        const tag = document.createElement('div');
        tag.className = 'race-objective-tag';
        tag.textContent = 'Objective';
        label.appendChild(tag);
    }

    const info = document.createElement('div');
    info.className = 'race-info';

    if (item.banner_url) {
        const img = document.createElement('img');
        img.className = 'race-banner';
        img.src = item.banner_url;
        img.alt = item.name || `Program ${item.program_id}`;
        info.appendChild(img);
    }

    const id = document.createElement('div');
    id.className = 'race-id';

    const title = document.createElement('div');
    const program = document.createElement('span');
    program.textContent = `Program ${item.program_id}`;
    title.appendChild(program);
    if (item.name) {
        const name = document.createElement('span');
        name.textContent = ` - ${item.name}`;
        title.appendChild(name);
    }
    id.appendChild(title);

    if (item.kind === 'objective') {
        const requirement = document.createElement('div');
        requirement.className = 'race-requirement';
        requirement.textContent = item.requirement || 'Participate';
        id.appendChild(requirement);
    }

    const meta = document.createElement('div');
    meta.className = 'race-meta';
    if (item.ground_label || item.ground) {
        meta.appendChild(racePill(item.ground_label ? item.ground_label : (item.ground === 1 ? 'Turf' : 'Dirt')));
    }
    if (item.distance_type) {
        meta.appendChild(racePill(item.distance_type));
    }
    if (item.distance_m) {
        meta.appendChild(racePill(`${item.distance_m}m`));
    }
    if (item.track_name) {
        meta.appendChild(racePill(item.track_name));
    }
    if (item.direction) {
        const handed = item.direction === 'Clockwise'
            ? 'Right-handed'
            : item.direction === 'Counterclockwise'
                ? 'Left-handed'
                : item.direction;
        meta.appendChild(racePill(handed));
    }
    const season = item.season ? seasonFromValue(item.season) : seasonFromMonth(item.month);
    if (season) {
        meta.appendChild(racePill(season.label, season.icon));
    }
    const timeOfDay = item.time_zone !== null && item.time_zone !== undefined ? timeFromValue(item.time_zone) : null;
    if (timeOfDay) {
        meta.appendChild(racePill(timeOfDay.label, timeOfDay.icon));
    }
    const weather = item.weather !== null && item.weather !== undefined ? weatherFromValue(item.weather) : null;
    if (weather) {
        meta.appendChild(racePill(weather.label, weather.icon));
    }
    const condition = item.ground_condition !== null && item.ground_condition !== undefined
        ? groundConditionFromValue(item.ground_condition)
        : null;
    if (condition) {
        meta.appendChild(racePill(condition));
    }
    if (meta.childNodes.length) {
        id.appendChild(meta);
    }

    if (item.grade_label === 'G1') {
        const btn = document.createElement('button');
        btn.className = 'umalator-btn';
        btn.textContent = 'Open in Umalator';
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openUmalator(item);
        });
        id.appendChild(btn);
    }

    info.appendChild(id);
    row.appendChild(label);
    row.appendChild(info);
    list.appendChild(row);
}

function updateRaceTab(state) {
    const list = $('race-list');
    const combinedList = $('race-combined');
    if (!list || !combinedList) return;
    list.innerHTML = '';
    combinedList.innerHTML = '';

    const currentTurn = state.training?.current_turn || 0;
    const isPastTurn = (item) => {
        const turn = item?.turn || 0;
        if (!turn || !currentTurn) return false;
        return turn < currentTurn;
    };

    const agendaList = state.race_agenda || [];
    const agenda = agendaList.find(item => item.deck_num === 0) || agendaList[0];
    const races = (agenda?.race_array || []).filter(item => !isPastTurn(item));
    if (!races.length) {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No race data available';
        list.appendChild(empty);
    } else {
        for (const race of races) {
            renderRaceRow(list, { ...race, kind: 'agenda' });
        }
    }

    const objectives = $('objective-list');
    if (objectives) {
        objectives.innerHTML = '';
        const items = (state.race_objectives || []).filter(item => !isPastTurn(item));
        if (!items.length) {
            const empty = document.createElement('span');
            empty.className = 'skills-empty';
            empty.textContent = 'No objectives available';
            objectives.appendChild(empty);
        } else {
            for (const obj of items) {
                renderRaceRow(objectives, { ...obj, kind: 'objective' });
            }
        }
    }

    let combinedItems = (state.race_combined || []).filter(item => !isPastTurn(item));
    if (combinedItems.length) {
        combinedItems = [...combinedItems].sort((a, b) => {
            const aTurn = a.turn || 0;
            const bTurn = b.turn || 0;
            if (aTurn && bTurn) return aTurn - bTurn;
            if (aTurn && !bTurn) return -1;
            if (!aTurn && bTurn) return 1;
            const yearDiff = (a.year || 0) - (b.year || 0);
            if (yearDiff !== 0) return yearDiff;
            const monthDiff = (a.month || 0) - (b.month || 0);
            if (monthDiff !== 0) return monthDiff;
            const halfDiff = (a.half || 0) - (b.half || 0);
            if (halfDiff !== 0) return halfDiff;
            return (a.program_id || 0) - (b.program_id || 0);
        });
    }
    if (!combinedItems.length) {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No race data available';
        combinedList.appendChild(empty);
    } else {
        for (const item of combinedItems) {
            renderRaceRow(combinedList, item);
        }
    }

    const objectiveCard = $('objective-card');
    const agendaCard = $('agenda-card');
    const toggleObj = $('toggle-objectives');
    const toggleAgenda = $('toggle-agenda');
    if (objectiveCard && toggleObj) {
        objectiveCard.style.display = toggleObj.checked ? '' : 'none';
    }
    if (agendaCard && toggleAgenda) {
        agendaCard.style.display = toggleAgenda.checked ? '' : 'none';
    }
    const eventBox = $('event-choices');
    if (!eventBox) return;
    eventBox.innerHTML = '';

    const choices = state.event_choices || [];
    if (!choices.length) {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No event choices available';
        eventBox.appendChild(empty);
        return;
    }

    const effectMap = {
        1: 'Speed',
        2: 'Stamina',
        3: 'Power',
        4: 'Guts',
        5: 'Wit',
        10: 'Energy',
        20: 'Mood',
        30: 'Skill Pts',
    };

    for (const choice of choices) {
        const card = document.createElement('div');
        card.className = 'event-choice';

        const title = document.createElement('div');
        title.className = 'event-title';
        title.textContent = `Choice ${choice.select_index}`;
        card.appendChild(title);

        const effects = choice.gain_param_array || [];
        if (!effects.length) {
            const eff = document.createElement('div');
            eff.className = 'event-effect';
            eff.textContent = 'No effects';
            card.appendChild(eff);
        } else {
            for (const effect of effects) {
                const eff = document.createElement('div');
                eff.className = 'event-effect';
                const label = effectMap[effect.effect_value_0] || `Effect ${effect.effect_value_0}`;
                const value = effect.effect_value_1 ?? 0;
                eff.textContent = `${label} +${value}`;
                card.appendChild(eff);
            }
        }

        eventBox.appendChild(card);
    }
}

function updateMiscTab(state) {
    const grid = $('misc-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const misc = state.misc_data || {};
    const sections = [
        ["User Info", misc.user_info || {}],
        ["TP Info", misc.tp_info || {}],
        ["RP Info", misc.rp_info || {}],
        ["Coin Info", misc.coin_info || {}],
        ["Common Define", misc.common_define || {}],
    ];

    const hasData = sections.some(([, data]) => data && Object.keys(data).length);
    if (!hasData) {
        const empty = document.createElement('span');
        empty.className = 'skills-empty';
        empty.textContent = 'No misc data available';
        grid.appendChild(empty);
        return;
    }

    for (const [title, data] of sections) {
        if (!data || !Object.keys(data).length) {
            continue;
        }
        const section = document.createElement('div');
        section.className = 'misc-section';
        const heading = document.createElement('h3');
        heading.textContent = title;
        section.appendChild(heading);

        for (const [key, value] of Object.entries(data)) {
            const row = document.createElement('div');
            row.className = 'misc-item';
            const label = document.createElement('div');
            label.className = 'misc-key';
            label.textContent = key;
            const val = document.createElement('div');
            val.className = 'misc-value';
            val.textContent = value === null ? '-' : String(value);
            row.appendChild(label);
            row.appendChild(val);
            section.appendChild(row);
        }
        grid.appendChild(section);
    }
}

const HORSE_RANK_ORDER = ["G", "G+", "F", "F+", "E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+", "S", "S+", "SS"];
const STATUS_RANK_ICON_INDEX = {
    'G': 0, 'G+': 1, 'F': 2, 'F+': 3, 'E': 4, 'E+': 5,
    'D': 6, 'D+': 7, 'C': 8, 'C+': 9, 'B': 10, 'B+': 11,
    'A': 12, 'A+': 13, 'S': 14, 'SS': 16, 'SS+': 17,
};
function horseRankIcon(label) {
    const idx = HORSE_RANK_ORDER.indexOf(label);
    if (idx < 0) return null;
    return `/assets/icons/umarank/utx_txt_rank_${String(idx).padStart(2, '0')}.png`;
}
function statusRankIcon(label) {
    const idx = STATUS_RANK_ICON_INDEX[label];
    if (idx === undefined) return null;
    return `/assets/icons/statusrank/ui_statusrank_${String(idx).padStart(2, '0')}.png`;
}
function veteranStatRankLabel(value) {
    const val = Number(value || 0);
    if (val >= 1150) return 'SS+';
    if (val >= 1100) return 'SS';
    if (val >= 1000) return 'S';
    if (val >= 800) return 'A';
    if (val >= 600) return 'B';
    if (val >= 400) return 'C';
    if (val >= 300) return 'D';
    if (val >= 200) return 'E';
    if (val >= 100) return 'F';
    return 'G';
}

let veteranCache = [];
let favoriteIds = new Set();
let selectedVeteranUma1 = null;
let selectedVeteranUma2 = null;
let cachedVeteranUma1Data = null;
let cachedVeteranUma2Data = null;
let umalatorPresets = [];
let selectedPreset = null;
let selectedStatsPreset = null;
let selectedStatsStyle = 'auto';
let selectedAvailableSkills = new Set();
let availableSkillCosts = new Map();
let availableSkillMeta = new Map();
const VETERAN_FILTERS_KEY = 'bifrost-veteran-filters';

function updateUmalatorSlots() {
    const slot1 = $('umalator-slot-1');
    const slot2 = $('umalator-slot-2');
    if (slot1) {
        const name = selectedVeteranUma1?.name || cachedVeteranUma1Data?.chara?.name;
        slot1.textContent = name || 'No selection';
    }
    if (slot2) {
        const name = selectedVeteranUma2?.name || cachedVeteranUma2Data?.chara?.name;
        slot2.textContent = name || 'No selection';
    }
}

function buildVeteranSelectionData(item) {
    if (!item) return null;
    const stats = item.stats || {};
    const aptitudes = item.aptitudes || {};
    return {
        chara: {
            id: item.chara_id ?? item.single_mode_chara_id ?? item.card_id ?? 0,
            name: item.name || 'Unknown',
            portrait_url: item.portrait_url || '',
            portrait_fallback_url: item.portrait_fallback_url || '',
        },
        stats: {
            speed: stats.speed ?? 0,
            stamina: stats.stamina ?? 0,
            power: stats.power ?? 0,
            guts: stats.guts ?? 0,
            wit: stats.wit ?? 0,
            skill_pts: item.skill_pts ?? 0,
            energy: item.energy ?? 0,
            motivation: item.motivation ?? 0,
        },
        aptitudes: {
            track: aptitudes.track || {},
            distance: aptitudes.distance || {},
            style: aptitudes.style || {},
        },
        skills: (item.skills || []).map((skill) => ({
            id: skill.id ?? skill.skill_id,
            name: skill.name,
            level: skill.level ?? 1,
        })).filter(skill => skill.id),
    };
}

async function saveSelectedVeterans() {
    const toKey = (item) => {
        if (!item) return null;
        return item.trained_chara_id ?? item.card_id ?? null;
    };
    const payload = {
        uma1_id: toKey(selectedVeteranUma1),
        uma2_id: toKey(selectedVeteranUma2),
        uma1_data: buildVeteranSelectionData(selectedVeteranUma1),
        uma2_data: buildVeteranSelectionData(selectedVeteranUma2),
    };
    try {
        await fetch('/api/veteran-selection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        // ignore cache write errors
    }
}

async function restoreSelectedVeterans() {
    const matchByKey = (items, key) => {
        if (!key) return null;
        return items.find(item => (item.trained_chara_id ?? item.card_id) === key) || null;
    };
    try {
        const res = await fetch('/api/veteran-selection');
        const data = await res.json();
        const key1 = data.uma1_id ?? data.uma1;
        const key2 = data.uma2_id ?? data.uma2;
        selectedVeteranUma1 = matchByKey(veteranCache, key1);
        selectedVeteranUma2 = matchByKey(veteranCache, key2);
        cachedVeteranUma1Data = data.uma1_data || null;
        cachedVeteranUma2Data = data.uma2_data || null;
    } catch (e) {
        selectedVeteranUma1 = null;
        selectedVeteranUma2 = null;
        cachedVeteranUma1Data = null;
        cachedVeteranUma2Data = null;
    }
    updateUmalatorSlots();
}

function loadFavorites() {
    try {
        const raw = localStorage.getItem('bifrost-veteran-favorites');
        const ids = raw ? JSON.parse(raw) : [];
        favoriteIds = new Set(Array.isArray(ids) ? ids : []);
    } catch (e) {
        favoriteIds = new Set();
    }
}

function saveFavorites() {
    localStorage.setItem('bifrost-veteran-favorites', JSON.stringify([...favoriteIds]));
}

function initVeteranFilters() {
    const filterOptions = ['Any', 'G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];
    const filterIds = [
        'veteran-filter-turf',
        'veteran-filter-dirt',
        'veteran-filter-sprint',
        'veteran-filter-mile',
        'veteran-filter-medium',
        'veteran-filter-long',
        'veteran-filter-front',
        'veteran-filter-pace',
        'veteran-filter-late',
        'veteran-filter-end',
    ];
    for (const id of filterIds) {
        const el = $(id);
        if (!el || el.dataset.ready) continue;
        el.innerHTML = '';
        for (const opt of filterOptions) {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            el.appendChild(option);
        }
        el.dataset.ready = '1';
    }
}

function saveVeteranFilters() {
    const payload = {
        sort: $('veteran-sort')?.value || 'rank_score',
        order: $('veteran-sort-order')?.value || 'desc',
        locked: $('veteran-filter-locked')?.checked || false,
        favorite: $('veteran-filter-favorite')?.checked || false,
        search: $('veteran-search')?.value || '',
        filters: {
            turf: $('veteran-filter-turf')?.value || 'Any',
            dirt: $('veteran-filter-dirt')?.value || 'Any',
            sprint: $('veteran-filter-sprint')?.value || 'Any',
            mile: $('veteran-filter-mile')?.value || 'Any',
            medium: $('veteran-filter-medium')?.value || 'Any',
            long: $('veteran-filter-long')?.value || 'Any',
            front: $('veteran-filter-front')?.value || 'Any',
            pace: $('veteran-filter-pace')?.value || 'Any',
            late: $('veteran-filter-late')?.value || 'Any',
            end: $('veteran-filter-end')?.value || 'Any',
        },
        preset: $('veteran-preset-select')?.value || '',
    };
    localStorage.setItem(VETERAN_FILTERS_KEY, JSON.stringify(payload));
}

function restoreVeteranFilters() {
    try {
        const raw = localStorage.getItem(VETERAN_FILTERS_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if ($('veteran-sort')) $('veteran-sort').value = data.sort || 'rank_score';
        if ($('veteran-sort-order')) $('veteran-sort-order').value = data.order || 'desc';
        if ($('veteran-filter-locked')) $('veteran-filter-locked').checked = !!data.locked;
        if ($('veteran-filter-favorite')) $('veteran-filter-favorite').checked = !!data.favorite;
        if ($('veteran-search')) $('veteran-search').value = data.search || '';
        const filters = data.filters || {};
        const applyValue = (id, value) => {
            const el = $(id);
            if (el && value) el.value = value;
        };
        applyValue('veteran-filter-turf', filters.turf);
        applyValue('veteran-filter-dirt', filters.dirt);
        applyValue('veteran-filter-sprint', filters.sprint);
        applyValue('veteran-filter-mile', filters.mile);
        applyValue('veteran-filter-medium', filters.medium);
        applyValue('veteran-filter-long', filters.long);
        applyValue('veteran-filter-front', filters.front);
        applyValue('veteran-filter-pace', filters.pace);
        applyValue('veteran-filter-late', filters.late);
        applyValue('veteran-filter-end', filters.end);
        if (data.preset && $('veteran-preset-select')) {
            $('veteran-preset-select').value = data.preset;
        }
        const presetValue = $('veteran-preset-select')?.value;
        if (presetValue && umalatorPresets.length) {
            selectedPreset = umalatorPresets.find(p => String(p.courseId) === String(presetValue)) || umalatorPresets[0];
        }
    } catch (e) {
        // ignore cache restore errors
    }
}

async function loadUmalatorPresets() {
    const veteranSelect = $('veteran-preset-select');
    const statsSelect = $('stats-preset-select');
    if (!veteranSelect && !statsSelect) return;
    try {
        const res = await fetch('/api/umalator-presets');
        const data = await res.json();
        umalatorPresets = data.presets || [];
    } catch (e) {
        umalatorPresets = [];
    }

    const fillSelect = (selectEl) => {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        if (!umalatorPresets.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No presets available';
            selectEl.appendChild(option);
            return;
        }
        for (let i = 0; i < umalatorPresets.length; i += 1) {
            const preset = umalatorPresets[i];
            const option = document.createElement('option');
            option.value = String(preset.courseId || '');
            const meters = preset.distance_m ? `${preset.distance_m}m` : 'Unknown';
            const surface = preset.is_dirt === true ? 'Dirt' : 'Turf';
            const rawName = preset.name || `Preset ${preset.courseId}`;
            const cmIndex = umalatorPresets.length - i;
            const hasCmPrefix = /^CM\d+\s/i.test(rawName);
            const displayName = hasCmPrefix ? rawName : `CM${cmIndex} ${rawName}`;
            option.textContent = `${displayName} (${surface} ${meters})`;
            selectEl.appendChild(option);
        }
    };
    fillSelect(veteranSelect);
    fillSelect(statsSelect);

    const saved = (() => {
        try {
            return JSON.parse(localStorage.getItem(VETERAN_FILTERS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    })();
    const savedPreset = saved.preset ? String(saved.preset) : '';
    if (veteranSelect) {
        if (savedPreset && umalatorPresets.find(p => String(p.courseId) === savedPreset)) {
            veteranSelect.value = savedPreset;
        }
        if (veteranSelect.value) {
            selectedPreset = umalatorPresets.find(p => String(p.courseId) === veteranSelect.value) || umalatorPresets[0];
        } else {
            selectedPreset = umalatorPresets[0];
            veteranSelect.value = String(selectedPreset.courseId || '');
        }
        veteranSelect.addEventListener('change', () => {
            selectedPreset = umalatorPresets.find(p => String(p.courseId) === String(veteranSelect.value)) || umalatorPresets[0];
            saveVeteranFilters();
        });
    }
    if (statsSelect) {
        const defaultPreset = findStatsDefaultPreset();
        selectedStatsPreset = defaultPreset || umalatorPresets[0] || null;
        if (selectedStatsPreset) {
            statsSelect.value = String(selectedStatsPreset.courseId || '');
        }
        statsSelect.addEventListener('change', () => {
            selectedStatsPreset = umalatorPresets.find(p => String(p.courseId) === String(statsSelect.value)) || umalatorPresets[0] || null;
        });
    }
}

async function loadVeteran() {
    try {
        const res = await fetch('/api/veteran');
        const data = await res.json();
        veteranCache = data.items || [];
        loadFavorites();
        initVeteranFilters();
        await loadUmalatorPresets();
        restoreVeteranFilters();
        await restoreSelectedVeterans();
        renderVeteran();
    } catch (e) {
        const list = $('veteran-list');
        if (list) {
            list.innerHTML = '<span class="skills-empty">Failed to load veteran data</span>';
        }
    }
}

function renderVeteran() {
    const list = $('veteran-list');
    if (!list) return;
    list.innerHTML = '';

    const sortKey = $('veteran-sort')?.value || 'rank_score';
    const sortOrder = $('veteran-sort-order')?.value || 'desc';
    const lockedOnly = $('veteran-filter-locked')?.checked || false;
    const favoriteOnly = $('veteran-filter-favorite')?.checked || false;
    const searchTerm = ($('veteran-search')?.value || '').trim();
    const items = [...veteranCache];
    const applyLocked = lockedOnly;
    const applyFavorite = favoriteOnly;
    let titleQuery = null;
    let nameQuery = searchTerm;
    const titleMatch = searchTerm.match(/\[([^\]]+)\]/);
    if (titleMatch) {
        titleQuery = titleMatch[1].trim().toLowerCase();
        nameQuery = searchTerm.replace(titleMatch[0], "").trim();
    }

    const filterValue = (id) => ($(`${id}`)?.value || 'Any');
    const order = ['G', 'G+', 'F', 'F+', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'];
    const rankIndex = (label) => {
        const idx = order.indexOf(label);
        return idx < 0 ? -1 : idx;
    };
    const atLeast = (value, min) => {
        if (!min || min === 'Any') return true;
        return rankIndex(value) >= rankIndex(min);
    };
    const filtered = items.filter((item) => {
        const apt = item.aptitudes || {};
        if (applyLocked && !item.is_locked) {
            return false;
        }
        const favoriteId = item.trained_chara_id ?? item.card_id;
        if (applyFavorite && !favoriteIds.has(favoriteId)) {
            return false;
        }
        if (searchTerm) {
            if (titleQuery) {
                const title = (item.title || '').toLowerCase();
                if (!title.startsWith(titleQuery)) {
                    return false;
                }
            }
            if (nameQuery) {
                const name = (item.name || '').toLowerCase();
                if (!name.includes(nameQuery.toLowerCase())) {
                    return false;
                }
            }
        }
        return (
            atLeast(apt.track?.Turf, filterValue('veteran-filter-turf')) &&
            atLeast(apt.track?.Dirt, filterValue('veteran-filter-dirt')) &&
            atLeast(apt.distance?.Sprint, filterValue('veteran-filter-sprint')) &&
            atLeast(apt.distance?.Mile, filterValue('veteran-filter-mile')) &&
            atLeast(apt.distance?.Medium, filterValue('veteran-filter-medium')) &&
            atLeast(apt.distance?.Long, filterValue('veteran-filter-long')) &&
            atLeast(apt.style?.Front, filterValue('veteran-filter-front')) &&
            atLeast(apt.style?.Pace, filterValue('veteran-filter-pace')) &&
            atLeast(apt.style?.Late, filterValue('veteran-filter-late')) &&
            atLeast(apt.style?.End, filterValue('veteran-filter-end'))
        );
    });

    const sortValue = (item) => {
        if (sortKey === 'skill_count') return item.skills?.length || 0;
        return item[sortKey] || item.stats?.[sortKey] || 0;
    };
    filtered.sort((a, b) => {
        const diff = sortValue(b) - sortValue(a);
        return sortOrder === 'asc' ? -diff : diff;
    });

    const summary = [];
    if (lockedOnly) summary.push('Locked only');
    if (favoriteOnly) summary.push('Favorites only');
    if (searchTerm) summary.push(`Search "${searchTerm}"`);
    const filterPairs = [
        ['Turf', filterValue('veteran-filter-turf')],
        ['Dirt', filterValue('veteran-filter-dirt')],
        ['Sprint', filterValue('veteran-filter-sprint')],
        ['Mile', filterValue('veteran-filter-mile')],
        ['Medium', filterValue('veteran-filter-medium')],
        ['Long', filterValue('veteran-filter-long')],
        ['Front', filterValue('veteran-filter-front')],
        ['Pace', filterValue('veteran-filter-pace')],
        ['Late', filterValue('veteran-filter-late')],
        ['End', filterValue('veteran-filter-end')],
    ];
    for (const [label, value] of filterPairs) {
        if (value && value !== 'Any') summary.push(`${label} ${value}+`);
    }
    const summaryEl = $('veteran-filters-summary');
    if (summaryEl) {
        summaryEl.textContent = summary.length ? summary.join(' | ') : 'No filters';
    }

    if (!filtered.length) {
        list.innerHTML = '<span class="skills-empty">No veteran data available</span>';
        return;
    }

    const selectedKey1 = selectedVeteranUma1
        ? (selectedVeteranUma1.trained_chara_id ?? selectedVeteranUma1.card_id)
        : null;
    const selectedKey2 = selectedVeteranUma2
        ? (selectedVeteranUma2.trained_chara_id ?? selectedVeteranUma2.card_id)
        : null;

    for (const item of filtered) {
        const card = document.createElement('div');
        card.className = 'veteran-card';
        card.style.cursor = 'pointer';
        card.onclick = () => showVeteranDetail(item);

        const favoriteId = item.trained_chara_id ?? item.card_id;
        const isFavorite = favoriteIds.has(favoriteId);
        if (favoriteId && favoriteId === selectedKey1) {
            card.classList.add('selected-uma', 'selected-uma-1');
            const tag = document.createElement('span');
            tag.className = 'veteran-compare-tag';
            tag.textContent = 'Uma 1';
            card.appendChild(tag);
        } else if (favoriteId && favoriteId === selectedKey2) {
            card.classList.add('selected-uma', 'selected-uma-2');
            const tag = document.createElement('span');
            tag.className = 'veteran-compare-tag uma2';
            tag.textContent = 'Uma 2';
            card.appendChild(tag);
        }
        const favBtn = document.createElement('button');
        favBtn.className = 'favorite-star';
        favBtn.textContent = isFavorite ? '★' : '☆';
        favBtn.title = isFavorite ? 'Unfavorite' : 'Favorite';
        favBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (favoriteIds.has(favoriteId)) {
                favoriteIds.delete(favoriteId);
            } else {
                favoriteIds.add(favoriteId);
            }
            saveFavorites();
            renderVeteran();
        });
        card.appendChild(favBtn);

        const img = document.createElement('img');
        img.className = 'veteran-portrait';
        img.src = item.portrait_url || 'https://umapyoi.net/missing_chara.png';
        img.alt = item.name || 'Veteran';
        img.onerror = () => {
            img.onerror = null;
            img.src = item.portrait_fallback_url || 'https://umapyoi.net/missing_chara.png';
        };

        const body = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'veteran-name';
        name.textContent = item.name || 'Unknown';

        const meta = document.createElement('div');
        meta.className = 'veteran-meta';
        const rankLabel = item.rank_label || item.rank || '-';
        const rankIcon = horseRankIcon(rankLabel);
        const lockText = item.is_locked ? 'Locked' : 'Unlocked';
        meta.innerHTML = `${rankIcon ? `<img class="umarank-icon" src="${rankIcon}" alt="${rankLabel}">` : ''}` +
            `${rankLabel} | Score ${item.rank_score || 0} | Skills ${(item.skills || []).length} | ${item.running_style || '-'} | ${lockText}`;

        const stats = document.createElement('div');
        stats.className = 'veteran-stats';
        const s = item.stats || {};
        stats.innerHTML = `
            <div><span class="veteran-stat-label">SPD</span><span class="veteran-stat-value">${s.speed || 0}</span></div>
            <div><span class="veteran-stat-label">STA</span><span class="veteran-stat-value">${s.stamina || 0}</span></div>
            <div><span class="veteran-stat-label">POW</span><span class="veteran-stat-value">${s.power || 0}</span></div>
            <div><span class="veteran-stat-label">GUT</span><span class="veteran-stat-value">${s.guts || 0}</span></div>
            <div><span class="veteran-stat-label">WIT</span><span class="veteran-stat-value">${s.wit || 0}</span></div>
        `;

        body.appendChild(name);
        body.appendChild(meta);
        body.appendChild(stats);
        card.appendChild(img);
        card.appendChild(body);
        list.appendChild(card);
    }
}

function renderVeteranDetail(item) {
    const empty = $('veteran-detail-empty');
    const detail = $('veteran-detail');
    const detailCard = $('veteran-detail-card');
    if (!detail || !empty) return;

    if (detailCard) detailCard.style.display = '';
    empty.style.display = 'none';
    detail.style.display = '';

    const rankLabel = item.rank_label || item.rank || '-';
    const rankIcon = horseRankIcon(rankLabel);
    const portrait = $('veteran-portrait');
    portrait.src = item.portrait_url || 'https://umapyoi.net/missing_chara.png';
    portrait.onerror = () => {
        portrait.onerror = null;
        portrait.src = item.portrait_fallback_url || 'https://umapyoi.net/missing_chara.png';
    };
    $('veteran-name').textContent = item.name || 'Unknown';
    $('veteran-rank').innerHTML = `${rankIcon ? `<img class="umarank-icon" src="${rankIcon}" alt="${rankLabel}">` : ''} ${rankLabel} | Score ${item.rank_score || 0}`;
    $('veteran-style').textContent = `Running Style: ${item.running_style || '-'} | Fans ${(item.fans || 0).toLocaleString()}`;
    $('veteran-uma1').onclick = () => {
        selectedVeteranUma1 = item;
        updateUmalatorSlots();
        saveSelectedVeterans();
        renderVeteran();
        if (window.__closeVeteranDetail) window.__closeVeteranDetail();
    };
    $('veteran-uma2').onclick = () => {
        selectedVeteranUma2 = item;
        updateUmalatorSlots();
        saveSelectedVeterans();
        renderVeteran();
        if (window.__closeVeteranDetail) window.__closeVeteranDetail();
    };

    const s = item.stats || {};
    $('vstat-speed').textContent = s.speed ?? 0;
    $('vstat-stamina').textContent = s.stamina ?? 0;
    $('vstat-power').textContent = s.power ?? 0;
    $('vstat-guts').textContent = s.guts ?? 0;
    $('vstat-wit').textContent = s.wit ?? 0;
    $('vmax-speed').textContent = '/1200';
    $('vmax-stamina').textContent = '/1200';
    $('vmax-power').textContent = '/1200';
    $('vmax-guts').textContent = '/1200';
    $('vmax-wit').textContent = '/1200';

    const statIconMap = {
        speed: '/assets/icons/status_00.png',
        stamina: '/assets/icons/status_01.png',
        power: '/assets/icons/status_02.png',
        guts: '/assets/icons/status_03.png',
        wit: '/assets/icons/status_04.png',
    };
    $('vstat-icon-speed').src = statIconMap.speed;
    $('vstat-icon-stamina').src = statIconMap.stamina;
    $('vstat-icon-power').src = statIconMap.power;
    $('vstat-icon-guts').src = statIconMap.guts;
    $('vstat-icon-wit').src = statIconMap.wit;

    const statRankIcon = (value) => {
        const label = veteranStatRankLabel(value);
        return statusRankIcon(label);
    };
    $('vrank-speed').src = statRankIcon(s.speed) || '';
    $('vrank-stamina').src = statRankIcon(s.stamina) || '';
    $('vrank-power').src = statRankIcon(s.power) || '';
    $('vrank-guts').src = statRankIcon(s.guts) || '';
    $('vrank-wit').src = statRankIcon(s.wit) || '';

    const apt = item.aptitudes || {};
    const aptIconIndex = {
        'G': 0, 'G+': 1, 'F': 2, 'F+': 3, 'E': 4, 'E+': 5,
        'D': 6, 'D+': 7, 'C': 8, 'C+': 9, 'B': 10, 'B+': 11,
        'A': 12, 'A+': 13, 'S': 14,
    };
    const aptIcon = (letter) => {
        const idx = aptIconIndex[letter] ?? 0;
        return `/assets/icons/statusrank/ui_statusrank_${String(idx).padStart(2, '0')}.png`;
    };
    const setApt = (id, letter, label) => {
        const el = $(id);
        if (!el) return;
        const value = letter || '-';
        el.innerHTML = `<span>${label}</span><img class="apt-icon" src="${aptIcon(value)}" alt="${value}">`;
    };
    setApt('vapt-turf', apt.track?.Turf, 'Turf');
    setApt('vapt-dirt', apt.track?.Dirt, 'Dirt');
    setApt('vapt-sprint', apt.distance?.Sprint, 'Sprint');
    setApt('vapt-mile', apt.distance?.Mile, 'Mile');
    setApt('vapt-medium', apt.distance?.Medium, 'Medium');
    setApt('vapt-long', apt.distance?.Long, 'Long');
    setApt('vapt-front', apt.style?.Front, 'Front');
    setApt('vapt-pace', apt.style?.Pace, 'Pace');
    setApt('vapt-late', apt.style?.Late, 'Late');
    setApt('vapt-end', apt.style?.End, 'End');

    const skills = $('veteran-skills');
    skills.innerHTML = '';
    if (item.skills && item.skills.length) {
        for (const skill of item.skills) {
            const srow = document.createElement('div');
            srow.className = 'skill-item';
            let iconUrl = skill.icon_url || skill.icon || '';
            if (!iconUrl && skill.id) {
                const skillId = String(skill.id).padStart(6, '0');
                iconUrl = `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${skillId}.png`;
            }
            if (iconUrl) {
                const icon = document.createElement('img');
                icon.className = 'skill-icon';
                icon.src = iconUrl;
                icon.alt = skill.name || 'Skill';
                icon.onerror = () => {
                    icon.onerror = null;
                    icon.remove();
                };
                srow.appendChild(icon);
            }
            const text = document.createElement('div');
            text.className = 'skill-text';
            text.textContent = `${skill.name} Lv ${skill.level}`;
            srow.appendChild(text);
            skills.appendChild(srow);
        }
    } else {
        const emptySkill = document.createElement('span');
        emptySkill.className = 'skills-empty';
        emptySkill.textContent = 'No skills data available';
        skills.appendChild(emptySkill);
    }
}

function resetVeteranDetail() {
    const empty = $('veteran-detail-empty');
    const detail = $('veteran-detail');
    const detailCard = $('veteran-detail-card');
    if (!detail || !empty) return;
    detail.style.display = 'none';
    empty.style.display = '';
    if (detailCard) detailCard.style.display = 'none';
}

function showVeteranDetail(item) {
    renderVeteranDetail(item);
    const detailCard = $('veteran-detail-card');
    if (!detailCard) return;

    const modal = document.createElement('div');
    modal.className = 'veteran-modal';
    const content = document.createElement('div');
    content.className = 'veteran-modal-content';
    modal.appendChild(content);

    const placeholder = document.createElement('div');
    detailCard.parentNode.insertBefore(placeholder, detailCard);
    content.appendChild(detailCard);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'veteran-modal-close';
    closeBtn.textContent = 'Close';

    const closeModal = () => {
        if (placeholder.parentNode) {
            placeholder.parentNode.insertBefore(detailCard, placeholder);
            placeholder.remove();
        }
        resetVeteranDetail();
        modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    content.appendChild(closeBtn);
    document.body.appendChild(modal);
    window.__closeVeteranDetail = closeModal;
}

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
        $('status-text').textContent = 'Connected';
        $('status-dot').classList.add('connected');
        const connection = $('session-connection');
        if (connection) {
            connection.textContent = 'Connected';
            connection.classList.remove('training', 'disconnected');
            connection.classList.add('connected');
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    ws.onclose = () => {
        $('status-text').textContent = 'Disconnected';
        $('status-dot').classList.remove('connected', 'training');
        const connection = $('session-connection');
        if (connection) {
            connection.textContent = 'Disconnected';
            connection.classList.remove('connected', 'training');
            connection.classList.add('disconnected');
        }
        if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, 3000);
        }
    };

    ws.onerror = () => {
        try {
            ws.close();
        } catch (e) {
            // ignore
        }
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
            updateUI(msg.data);
        } else if (msg.type === 'ping') {
            ws.send('ping');
        }
    };
}

function getTurnDateInfo(turn) {
    if (!turn) return null;
    const exceptionMap = {
        1: { month: "April", half: "Early" },
        2: { month: "April", half: "Early" },
        3: { month: "May", half: "Early" },
        4: { month: "May", half: "Early" },
        5: { month: "June", half: "Early" },
        6: { month: "June", half: "Early" },
        7: { month: "April", half: "Late" },
        8: { month: "April", half: "Late" },
        9: { month: "May", half: "Late" },
        10: { month: "May", half: "Late" },
        11: { month: "June", half: "Late" },
        12: { month: "June", half: "Late" },
    };
    const yearLabel = turn <= 24 ? "Junior Year"
        : turn <= 48 ? "Classic Year"
        : turn <= 72 ? "Senior Year"
        : "URA Finals";
    const phase = turn <= 24 ? "Junior"
        : turn <= 48 ? "Classic"
        : turn <= 72 ? "Senior"
        : "URA";

    if (exceptionMap[turn]) {
        const entry = exceptionMap[turn];
        return { yearLabel, phase, month: entry.month, half: entry.half };
    }

    const months = [
        "July", "August", "September", "October", "November", "December",
        "January", "February", "March", "April", "May", "June"
    ];
    const offset = turn - 13;
    const monthIndex = Math.floor(offset / 2) % months.length;
    const half = (offset % 2 === 0) ? "Early" : "Late";
    return { yearLabel, phase, month: months[monthIndex], half };
}

function getNextRaceInfo(state) {
    const currentTurn = state?.training?.current_turn || 0;
    const races = state?.race_combined || [];
    let next = null;
    for (const item of races) {
        if (!item?.turn) continue;
        if (item.turn < currentTurn) continue;
        if (!next || item.turn < next.turn) next = item;
    }
    return next;
}

function updateUI(state) {
    lastState = state;
    if (state.in_training) {
        $('status-dot').classList.add('training');
        $('status-text').textContent = 'In Training';
    } else {
        $('status-dot').classList.remove('training');
        $('status-text').textContent = 'Connected';
    }

    const s = state.training.stats;
    const t = state.training;

    // Session bar
    $('session-turn').textContent = `${t.current_turn}/${t.max_turns}`;
    const raw = state.raw_data?.data || state.raw_data;
    const maxVital = raw?.chara_info?.max_vital || 100;
    $('session-energy').textContent = `${s.energy}/${maxVital}`;
    $('session-skillpts').textContent = s.skill_pts.toLocaleString();
    $('session-fans').textContent = t.fans.toLocaleString();
    const dateInfo = getTurnDateInfo(t.current_turn);
    const dateEl = $('session-date');
    if (dateEl && dateInfo) {
        dateEl.textContent = `${dateInfo.yearLabel} ${dateInfo.half} ${dateInfo.month}`;
    } else if (dateEl) {
        dateEl.textContent = '-';
    }
    const scenarioId = raw?.chara_info?.scenario_id;
    const scenarioName = t.scenario || SCENARIO_NAMES[scenarioId] || '-';
    const scenarioEl = $('session-scenario');
    if (scenarioEl) scenarioEl.textContent = scenarioName;
    const energyFill = $('session-energy-bar');
    if (energyFill) {
        const pct = Math.max(0, Math.min(100, (s.energy / maxVital) * 100));
        energyFill.style.width = `${pct}%`;
        energyFill.style.background = pct < 30 ? 'var(--danger)' : pct < 60 ? 'var(--warning)' : 'var(--success)';
    }

    // Motivation bubble
    const mot = MOTIVATION[s.motivation] || MOTIVATION[3];
    const motEl = $('session-motivation');
    motEl.textContent = mot.name;
    motEl.className = 'motivation-bubble ' + mot.class;
    const nextRace = getNextRaceInfo(state);
    const nextRaceEl = $('session-next-race');
    const nextIcon = $('session-next-icon');
    if (nextRaceEl) {
        if (nextRace && nextRace.turn) {
            const diff = Math.max(0, nextRace.turn - t.current_turn);
            nextRaceEl.textContent = diff === 0 ? 'Next race: Now' : `Next race in ${diff} turns`;
        } else {
            nextRaceEl.textContent = 'Next race -';
        }
    }
    if (nextIcon) {
        if (nextRace?.banner_url) {
            nextIcon.src = nextRace.banner_url;
            nextIcon.style.display = '';
        } else {
            nextIcon.removeAttribute('src');
            nextIcon.style.display = 'none';
        }
    }
    const connection = $('session-connection');
    if (connection) {
        connection.style.display = 'none';
    }

    // Stats
    $('stat-speed').textContent = s.speed;
    $('stat-stamina').textContent = s.stamina;
    $('stat-power').textContent = s.power;
    $('stat-guts').textContent = s.guts;
    $('stat-wisdom').textContent = s.wisdom;

    // Update stat rank icons
    updateStatRankIcons(s);

    // Update training cards with command data
    trainingScores = {};
    ['speed', 'stamina', 'power', 'guts', 'wit'].forEach(stat => {
        updateTrainingCard(stat, state);
    });
    applySuggestedTraining(state);

    updateSupporters(state);
    updateSkillsTab(state);
    updateRaceTab(state);
    updateMiscTab(state);

    // Debug info
    $('info-packet').textContent = state.last_packet_type || '-';
    $('info-update').textContent = t.last_update ?
        new Date(t.last_update).toLocaleTimeString() : '-';

    // Store raw data
    if (state.raw_data) {
        lastRawData = state.raw_data;
    }
}
