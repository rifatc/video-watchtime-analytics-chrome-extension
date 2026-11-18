// Dashboard client: renders summary cards (with time-saved analytics), the
// daily chart, hour-of-day chart, GitHub-style heatmap and history table from
// a single GET /api/data payload. Chart.js (vendored) is optional — the rest
// of the page still renders if it fails to load.

'use strict';

const PAGE_SIZE = 30;

const state = {
    daily: [],        // [{date, durationWatched, actualTimeWatched}] sorted by date asc
    byDate: new Map(),// date -> {durationWatched, actualTimeWatched}
    hourly: [],       // [{date, hour, seconds}]
    range: 30,        // days; "all" = Infinity
    heatmapYear: null,
    historyPage: 1,
    dailyChart: null,
    hourlyChart: null,
};

// --- Formatting -------------------------------------------------------------

function formatFull(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
}

function formatCompact(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
}

function savedPercent(duration, actual) {
    if (duration <= 0) return '0%';
    return `${((duration - actual) / duration * 100).toFixed(1)}%`;
}

function speedFactor(duration, actual) {
    if (actual <= 0 || duration <= 0) return '—';
    return `${(duration / actual).toFixed(2)}×`;
}

function toLocalDateStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayStr() {
    return toLocalDateStr(new Date());
}

// Inclusive cutoff string for "last N days" (N=7 -> today-6). Non-numeric
// range ("all") returns the earliest possible match.
function rangeCutoffStr(days) {
    if (days === 'all' || days === Infinity) return '0000-00-00';
    const d = new Date();
    d.setDate(d.getDate() - (Number(days) - 1));
    return toLocalDateStr(d);
}

function formatAgo(iso) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

// --- Data slicing -----------------------------------------------------------

function daysInRange() {
    const cutoff = rangeCutoffStr(state.range);
    return state.daily.filter((d) => d.date >= cutoff);
}

function totals(days) {
    let duration = 0;
    let actual = 0;
    for (const d of days) {
        duration += d.durationWatched;
        actual += d.actualTimeWatched;
    }
    return { duration, actual, saved: duration - actual };
}

// --- Summary cards ------------------------------------------------------------

function renderCards() {
    const today = todayStr();
    const weekCutoff = rangeCutoffStr(7);
    const monthCutoff = rangeCutoffStr(30);

    const cards = [
        ['Today', state.daily.filter((d) => d.date === today)],
        ['Last 7 days', state.daily.filter((d) => d.date >= weekCutoff)],
        ['Last 30 days', state.daily.filter((d) => d.date >= monthCutoff)],
        ['All time', state.daily],
    ];

    const container = document.getElementById('summaryCards');
    container.innerHTML = cards.map(([title, days]) => {
        const t = totals(days);
        return `
            <div class="card">
                <h3>${title}</h3>
                <div class="metric"><span class="value">${formatCompact(t.actual)}</span><span class="label">actual watched</span></div>
                <div class="metric"><span class="value">${formatCompact(t.duration)}</span><span class="label">watch duration</span></div>
                <div class="metric saved"><span class="value">${formatCompact(t.saved)}</span>
                    <span class="label">time saved</span>
                    <span class="extra">${savedPercent(t.duration, t.actual)} &middot; ${speedFactor(t.duration, t.actual)}</span></div>
            </div>
        `;
    }).join('');
}

// --- Daily chart ----------------------------------------------------------------

function renderDailyChart() {
    const days = daysInRange();
    const labels = days.map((d) => d.date);
    const saved = days.map((d) => d.durationWatched - d.actualTimeWatched);

    document.getElementById('dailyChartSub').textContent =
        state.range === 'all' ? 'all time' : `last ${state.range} days`;

    const canvas = document.getElementById('dailyChart');
    if (state.dailyChart) state.dailyChart.destroy();
    if (typeof Chart === 'undefined') return;

    state.dailyChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Watch duration',
                    data: days.map((d) => d.durationWatched),
                    borderColor: '#8b8fa3',
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.25,
                },
                {
                    label: 'Actual watched',
                    data: days.map((d) => d.actualTimeWatched),
                    borderColor: '#6ea8fe',
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.25,
                },
                {
                    label: 'Time saved',
                    data: saved,
                    borderColor: '#4cc990',
                    backgroundColor: 'rgba(76, 201, 144, 0.18)',
                    borderWidth: 1.5,
                    fill: true,
                    tension: 0.25,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${formatFull(ctx.parsed.y)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 10,
                        maxRotation: 0,
                        autoSkip: true,
                        // "2026-11-18" -> "11-18": full dates overlap at 30+ points.
                        callback: (value, index) => {
                            const label = labels[index];
                            return typeof label === 'string' && label.length === 10 ? label.slice(5) : label;
                        },
                    },
                },
                y: { ticks: { callback: (v) => formatCompact(v) } },
            },
            elements: { point: { radius: 0, hitRadius: 12 } },
        },
    });
}

// --- Hour-of-day chart -------------------------------------------------------------

function renderHourlyChart() {
    const cutoff = rangeCutoffStr(state.range);
    const buckets = new Array(24).fill(0);
    let coveredAny = false;
    for (const h of state.hourly) {
        if (h.date >= cutoff) {
            buckets[h.hour] += h.seconds;
            coveredAny = true;
        }
    }

    // Flag when part of the selected range predates hourly tracking (byHour
    // only exists in the extension since ~2026-01-25).
    const firstHourlyDate = state.hourly.length ? state.hourly[0].date : null;
    const rangeStart = cutoff !== '0000-00-00' ? cutoff : (state.daily[0] ? state.daily[0].date : '9999-99-99');
    const missing = state.hourly.length > 0 && rangeStart < firstHourlyDate;
    document.getElementById('hourlyNote').classList.toggle('hidden', !missing);

    const canvas = document.getElementById('hourlyChart');
    if (state.hourlyChart) state.hourlyChart.destroy();
    if (typeof Chart === 'undefined') return;

    state.hourlyChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: buckets.map((_, h) => `${String(h).padStart(2, '0')}`),
            datasets: [{ data: buckets, backgroundColor: '#6ea8fe', borderRadius: 3 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => `${String(items[0].label)}:00`,
                        label: (ctx) => ` ${formatFull(ctx.parsed.y)} watched`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
                y: { ticks: { callback: (v) => formatCompact(v) } },
            },
        },
    });
    // coveredAny is intentionally unused beyond future debugging; the buckets
    // already encode the coverage.
    void coveredAny;
}

// --- Heatmap ---------------------------------------------------------------------

function heatThresholds() {
    const positives = state.daily
        .map((d) => d.actualTimeWatched)
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
    if (!positives.length) return null;
    const q = (p) => positives[Math.min(positives.length - 1, Math.floor(p * positives.length))];
    return [q(0.25), q(0.5), q(0.75)];
}

function heatLevel(value, thresholds) {
    if (!thresholds || value <= 0) return 0;
    if (value <= thresholds[0]) return 1;
    if (value <= thresholds[1]) return 2;
    if (value <= thresholds[2]) return 3;
    return 4;
}

function renderHeatmapYears() {
    const years = [...new Set([
        ...state.daily.map((d) => d.date.slice(0, 4)),
        String(new Date().getFullYear()),
    ])].sort();
    if (!state.heatmapYear || !years.includes(state.heatmapYear)) {
        state.heatmapYear = years[years.length - 1];
    }
    const container = document.getElementById('heatmapYears');
    container.innerHTML = years
        .map((y) => `<button data-year="${y}" class="${y === state.heatmapYear ? 'active' : ''}">${y}</button>`)
        .join('');
}

function renderHeatmap() {
    const year = state.heatmapYear;
    const container = document.getElementById('heatmap');
    const thresholds = heatThresholds();

    const weekdayLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
        .map((label) => `<span>${label}</span>`)
        .join('');

    // One grid column per week: a month-label cell on top of 7 day cells.
    const cursor = new Date(Number(year), 0, 1);
    const end = new Date(Number(year) + 1, 0, 1);
    let cells = '';
    let weekCellCount = 0;
    let currentMonth = -1;

    // Offset to the first Sunday on/before Jan 1 so week columns align.
    cursor.setDate(cursor.getDate() - cursor.getDay());

    while (cursor < end) {
        const month = cursor.getMonth();
        cells += `<div class="heat-month">${month !== currentMonth ? cursor.toLocaleString('en', { month: 'short' }) : ''}</div>`;
        currentMonth = month;
        for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
            const dateStr = toLocalDateStr(cursor);
            const inYear = cursor.getFullYear() === Number(year);
            const stats = state.byDate.get(dateStr);
            if (!inYear || !stats) {
                cells += `<div class="heat-cell ${inYear ? '' : 'empty'}"></div>`;
            } else {
                const level = heatLevel(stats.actualTimeWatched, thresholds);
                const t = totals([stats]);
                cells += `<div class="heat-cell l${level}" data-date="${dateStr}"
                    data-actual="${stats.actualTimeWatched}" data-duration="${t.duration}"></div>`;
            }
            cursor.setDate(cursor.getDate() + 1);
            weekCellCount++;
        }
    }

    container.innerHTML = `
        <div class="weekday-labels">${weekdayLabels}</div>
        <div class="heatmap-grid">${cells}</div>
    `;

    const legend = document.getElementById('heatmapLegend');
    legend.innerHTML = [0, 1, 2, 3, 4]
        .map((level) => `<div class="heat-cell l${level}"></div>`)
        .join('');
}

// --- Hourly heatmap (rows = hours 0-23, columns = days) ------------------------------

function renderHourlyHeatmap() {
    const container = document.getElementById('hourlyHeatmap');
    if (!container) return;

    // date -> 24-slot array of seconds watched per hour (sparse upstream).
    const perDay = new Map();
    const positives = [];
    for (const h of state.hourly) {
        if (!perDay.has(h.date)) perDay.set(h.date, new Array(24).fill(0));
        perDay.get(h.date)[h.hour] = h.seconds;
        if (h.seconds > 0) positives.push(h.seconds);
    }
    positives.sort((a, b) => a - b);
    const thresholds = positives.length
        ? [0.25, 0.5, 0.75].map((p) => positives[Math.min(positives.length - 1, Math.floor(p * positives.length))])
        : null;

    const firstHourlyDate = state.hourly.length ? state.hourly[0].date : null;
    const cutoff = rangeCutoffStr(state.range);
    const today = todayStr();
    // Only the selected range, and never days older than hourly tracking
    // (they have no byHour data and would render as misleading empty columns).
    const days = firstHourlyDate
        ? state.daily
            .filter((d) => d.date >= cutoff && d.date >= firstHourlyDate && d.date <= today)
            .map((d) => d.date)
        : []; // ascending: oldest day on the left, newest on the right

    const rangeLabel = state.range === 'all'
        ? `since ${firstHourlyDate} · ${days.length} days`
        : `last ${state.range} days`;
    document.getElementById('hourlyHeatSub').textContent = firstHourlyDate ? rangeLabel : 'no hourly data yet';

    // Y axis: hour labels (every 3rd keeps them readable).
    document.getElementById('hourlyHeatHours').innerHTML =
        [...Array(24).keys()]
            .map((h) => `<span>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`)
            .join('');

    // X axis top row: month labels at each month change.
    let lastMonth = -1;
    document.getElementById('hourlyHeatMonths').innerHTML = days
        .map((date) => {
            const month = new Date(`${date}T00:00:00`).getMonth();
            const label = month !== lastMonth
                ? new Date(`${date}T00:00:00`).toLocaleString('en', { month: 'short' })
                : '';
            lastMonth = month;
            return `<span class="hh-month-label">${label}</span>`;
        })
        .join('');

    // One grid column per day; grid-auto-flow: column fills 24 hour rows.
    container.innerHTML = days.map((date) => {
        const hours = perDay.get(date) || new Array(24).fill(0);
        return hours.map((seconds, hour) =>
            `<div class="hh-cell l${heatLevel(seconds, thresholds)}" data-date="${date}" data-hour="${hour}" data-seconds="${seconds}"></div>`
        ).join('');
    }).join('');

    // X axis bottom row: a date tick on every Monday (weekly grid lines).
    document.getElementById('hourlyHeatTicks').innerHTML = days
        .map((date) => {
            const show = new Date(`${date}T00:00:00`).getDay() === 1;
            return `<span class="hh-day-label">${show ? date.slice(5) : ''}</span>`;
        })
        .join('');

    document.getElementById('hourlyHeatLegend').innerHTML = [0, 1, 2, 3, 4]
        .map((level) => `<div class="heat-cell l${level}"></div>`)
        .join('');
}

// --- History table -----------------------------------------------------------------

function renderHistory() {
    const rows = [...state.daily].reverse();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.historyPage > totalPages) state.historyPage = totalPages;
    const start = (state.historyPage - 1) * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);

    document.getElementById('historyBody').innerHTML = page.map((d) => {
        const saved = d.durationWatched - d.actualTimeWatched;
        return `
            <tr>
                <td>${d.date}</td>
                <td>${formatFull(d.durationWatched)}</td>
                <td>${formatFull(d.actualTimeWatched)}</td>
                <td class="saved-cell">${formatFull(saved)}</td>
                <td class="pct-cell">${savedPercent(d.durationWatched, d.actualTimeWatched)}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('historyPagination').innerHTML = `
        <button id="prevHistory" ${state.historyPage === 1 ? 'disabled' : ''}>&lt;</button>
        <span>Page ${state.historyPage} of ${totalPages}</span>
        <button id="nextHistory" ${state.historyPage === totalPages ? 'disabled' : ''}>&gt;</button>
    `;
}

// --- Tooltip -------------------------------------------------------------------------

function setupTooltip() {
    const tooltip = document.getElementById('tooltip');
    document.addEventListener('mousemove', (event) => {
        const cell = event.target.closest
            ? event.target.closest('.heat-cell[data-date], .hh-cell[data-date]')
            : null;
        if (!cell) {
            tooltip.classList.add('hidden');
            return;
        }

        let html;
        if (cell.dataset.hour !== undefined) {
            // Hourly heatmap cell: one hour of one day.
            const hour = Number(cell.dataset.hour);
            const next = (hour + 1) % 24;
            html = `
                <div class="tip-date">${cell.dataset.date} · ${String(hour).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00</div>
                <div>${formatFull(Number(cell.dataset.seconds))} watched</div>
            `;
        } else {
            // Daily heatmap cell.
            const actual = Number(cell.dataset.actual);
            const duration = Number(cell.dataset.duration);
            const saved = duration - actual;
            html = `
                <div class="tip-date">${cell.dataset.date}</div>
                <div>${formatFull(actual)} actual watched</div>
                <div>${formatFull(duration)} duration</div>
                <div>${formatFull(saved)} saved (${savedPercent(duration, actual)})</div>
            `;
        }

        tooltip.innerHTML = html;
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8)}px`;
        tooltip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8)}px`;
    });
}

// --- Data + wiring ----------------------------------------------------------------------

function renderAll() {
    renderCards();
    renderDailyChart();
    renderHourlyChart();
    renderHourlyHeatmap();
    renderHeatmapYears();
    renderHeatmap();
    renderHistory();
}

async function loadData() {
    const response = await fetch('/api/data');
    const data = await response.json();
    state.daily = data.daily || [];
    state.byDate = new Map(state.daily.map((d) => [d.date, d]));
    state.hourly = data.hourly || [];
    renderAll();

    const syncEl = document.getElementById('lastSync');
    syncEl.textContent = data.lastSync
        ? `Last synced ${formatAgo(data.lastSync.syncedAt)} · ${data.lastSync.days} days`
        : 'No sync yet';
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = '#9aa0b5';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
    }

    document.getElementById('rangeSelector').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-range]');
        if (!button) return;
        state.range = button.dataset.range === 'all' ? 'all' : Number(button.dataset.range);
        for (const el of document.querySelectorAll('#rangeSelector button')) {
            el.classList.toggle('active', el === button);
        }
        renderDailyChart();
        renderHourlyChart();
        renderHourlyHeatmap();
    });

    document.getElementById('heatmapYears').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-year]');
        if (!button) return;
        state.heatmapYear = button.dataset.year;
        renderHeatmapYears();
        renderHeatmap();
    });

    document.getElementById('historyPagination').addEventListener('click', (event) => {
        if (event.target.id === 'prevHistory') state.historyPage--;
        else if (event.target.id === 'nextHistory') state.historyPage++;
        else return;
        renderHistory();
    });

    setupTooltip();
    loadData().catch((err) => console.error('Failed to load dashboard data:', err));

    // Keep an open tab current: poll once a minute and refresh on return to
    // the tab (data is small, ~100 KB, and rendering is idempotent).
    const REFRESH_MS = 60000;
    setInterval(() => {
        if (!document.hidden) loadData().catch(() => {});
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) loadData().catch(() => {});
    });
});
