// Load saved font
const savedFont = localStorage.getItem('bifrost-font');
if (savedFont) {
    $('setting-font').value = savedFont;
    document.documentElement.style.setProperty('--font-family', savedFont);
    document.body.style.fontFamily = savedFont;
} else {
    const defaultFont = "'Inter', 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
    $('setting-font').value = defaultFont;
    document.documentElement.style.setProperty('--font-family', defaultFont);
    document.body.style.fontFamily = defaultFont;
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $('tab-' + tab.dataset.tab).classList.add('active');

        if (tab.dataset.tab === 'raw' && lastRawData) {
            $('raw-data').textContent = JSON.stringify(lastRawData, null, 2);
        }
        if (tab.dataset.tab === 'settings') {
            loadSettings();
        }
        if (tab.dataset.tab.startsWith('veteran')) {
            loadVeteran();
        }
    });
});

$('settings-advanced-toggle')?.addEventListener('click', () => {
    const advanced = $('settings-advanced');
    if (!advanced) return;
    advanced.style.display = advanced.style.display === 'none' ? '' : 'none';
});

$('always-on-top-toggle')?.addEventListener('change', async (event) => {
    const enabled = event.target.checked;
    try {
        const res = await fetch('/api/always-on-top', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, title: document.title }),
        });
        const payload = await res.json();
        if (!payload.ok) {
            event.target.checked = !enabled;
        }
    } catch (e) {
        event.target.checked = !enabled;
    }
});


$('settings-save')?.addEventListener('click', async () => {
    await saveSettings();
});

$('veteran-sort')?.addEventListener('change', () => {
    saveVeteranFilters();
    renderVeteran();
});
document.querySelectorAll('[id^="veteran-filter-"]').forEach(select => {
    select.addEventListener('change', () => {
        saveVeteranFilters();
        renderVeteran();
    });
});
$('veteran-filters-open')?.addEventListener('click', () => {
    const modal = $('veteran-filters-modal');
    if (modal) modal.style.display = 'flex';
});
$('veteran-filters-close')?.addEventListener('click', () => {
    const modal = $('veteran-filters-modal');
    if (modal) modal.style.display = 'none';
});
$('veteran-filters-apply')?.addEventListener('click', () => {
    saveVeteranFilters();
    renderVeteran();
    const modal = $('veteran-filters-modal');
    if (modal) modal.style.display = 'none';
});
$('veteran-filter-locked')?.addEventListener('change', () => {
    saveVeteranFilters();
    renderVeteran();
});
$('veteran-filter-favorite')?.addEventListener('change', () => {
    saveVeteranFilters();
    renderVeteran();
});
$('veteran-search')?.addEventListener('input', () => {
    saveVeteranFilters();
    renderVeteran();
});
$('veteran-sort-order')?.addEventListener('change', () => {
    saveVeteranFilters();
    renderVeteran();
});
$('veteran-preset-select')?.addEventListener('change', (event) => {
    const value = event.target.value;
    selectedPreset = umalatorPresets.find(p => String(p.courseId) === String(value)) || umalatorPresets[0] || null;
    saveVeteranFilters();
});


connect();
