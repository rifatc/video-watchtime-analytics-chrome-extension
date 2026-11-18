'use strict';

// Pushes videoWatchHistory to the local dashboard app (dashboard/ in this
// repo, http://127.0.0.1:8420 by default). Loaded from background.js via
// importScripts().
//
// Backlog guarantee: every sync posts the FULL history, exactly like the
// popup's JSON export. When the app is unavailable nothing is cleared here —
// chrome.storage.local stays the source of truth — so the next successful
// push automatically delivers everything accumulated during the downtime.
// The server upserts per date and never deletes, making replays harmless.

const SYNC_URL = 'http://127.0.0.1:8420/api/sync';
const SYNC_ALARM_NAME = 'syncPush';
const SYNC_PERIOD_MINUTES = 15;
const SYNC_TIMEOUT_MS = 10000;

// Builds the export envelope (same shape as popup.js exportToJSON) with dates
// sorted newest-first. `source` records what triggered the push ('manual',
// 'alarm', 'startup', 'wake', 'poll') — echoed back in logs for debugging.
function buildSyncPayload(history, source) {
    const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));
    const payload = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        data: {}
    };
    if (source) payload.syncSource = source;
    sortedDates.forEach((date) => {
        payload.data[date] = history[date];
    });
    return payload;
}

function readSyncData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['videoWatchHistory', 'syncState'], (result) => resolve(result));
    });
}

function writeSyncState(state) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ syncState: state }, () => resolve());
    });
}

// POST with a hard timeout so a hung server can't leave the state "syncing"
// forever; AbortController covers connect + response time.
function postHistory(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
    return fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
    }).finally(() => clearTimeout(timer));
}

// Runs one sync attempt. Resolves {ok: boolean}. On any failure the recorded
// history and the previous lastSuccessAt are left untouched.
async function runSync(source) {
    const result = await readSyncData();
    const history = result.videoWatchHistory || {};
    const previous = result.syncState || {};
    const payload = buildSyncPayload(history, source);
    const attemptAt = Date.now();

    let state;
    try {
        const response = await postHistory(payload);
        if (response.ok) {
            state = {
                lastSuccessAt: attemptAt,
                lastAttemptAt: attemptAt,
                lastStatus: 'ok',
                lastError: null,
                lastSource: source || 'manual'
            };
        } else {
            state = {
                lastSuccessAt: previous.lastSuccessAt || 0,
                lastAttemptAt: attemptAt,
                lastStatus: 'unavailable',
                lastError: `HTTP ${response.status}`,
                lastSource: source || 'manual'
            };
        }
    } catch (error) {
        state = {
            lastSuccessAt: previous.lastSuccessAt || 0,
            lastAttemptAt: attemptAt,
            lastStatus: 'unavailable',
            lastError: error && error.name === 'AbortError' ? 'timeout' : String((error && error.message) || error),
            lastSource: source || 'manual'
        };
    }

    await writeSyncState(state);
    // Visible via chrome://extensions -> "Inspect views: service worker".
    console.debug(`[sync] push via ${state.lastSource} -> ${state.lastStatus}${state.lastError ? ` (${state.lastError})` : ''}`);
    return { ok: state.lastStatus === 'ok' };
}

// Registers the periodic alarm without resetting it on every service-worker
// start (alarms.create with an existing name would restart the 15-minute
// countdown; frequent event-driven worker starts could then starve it).
function scheduleSync() {
    chrome.alarms.get(SYNC_ALARM_NAME, (existing) => {
        if (chrome.runtime.lastError) {
            console.debug('[sync] alarm check failed:', chrome.runtime.lastError.message);
            return;
        }
        if (!existing) {
            chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
            console.debug(`[sync] alarm scheduled every ${SYNC_PERIOD_MINUTES} minutes`);
        } else {
            console.debug('[sync] alarm already scheduled');
        }
    });
}

// Opportunistic sync, time-gated to at most one attempt per period. Called on
// worker start ('wake') and from the tab-polling loop ('poll') — the polling
// path matters because Chrome API calls every 10s keep the worker alive
// forever, which means it never suspends/wakes and alarms alone would have to
// carry all automatic syncing.
async function syncIfDue(source = 'wake') {
    const result = await readSyncData();
    const previous = result.syncState || {};
    const due = !previous.lastAttemptAt ||
        (Date.now() - previous.lastAttemptAt) >= SYNC_PERIOD_MINUTES * 60 * 1000;
    if (due) {
        console.debug(`[sync] ${SYNC_PERIOD_MINUTES} min elapsed, syncing via ${source}`);
        await runSync(source);
    }
}

chrome.runtime.onStartup.addListener(() => {
    scheduleSync();
    runSync('startup'); // catch up on any backlog accumulated while the browser was closed
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
        console.debug('[sync] alarm fired');
        runSync('alarm');
    }
});

// Popup's "Sync now" button. Returning true keeps the message channel open
// for the async sendResponse.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'syncNow') {
        runSync().then((result) => sendResponse(result));
        return true;
    }
});

scheduleSync();
