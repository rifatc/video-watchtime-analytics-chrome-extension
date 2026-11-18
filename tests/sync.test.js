'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createSyncSandbox } = require('./helpers');

const SYNC_URL = 'http://127.0.0.1:8420/api/sync';
const NOW_MS = 1769493600000; // fixed fake "now"

function day(duration, actual, byHour) {
    const stats = { durationWatched: duration, actualTimeWatched: actual };
    if (byHour) stats.byHour = byHour;
    return stats;
}

function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('sync alarm is registered once with a 15-minute period on load', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS });
    await sb.flush();

    assert.deepEqual(sb.alarmsCreated, [
        { name: 'syncPush', info: { periodInMinutes: 15 } }
    ]);
});

test('scheduleSync does not reset an already-registered alarm', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS });
    await sb.flush();
    assert.equal(sb.alarmsCreated.length, 1);

    // Simulate the alarm already existing (as it does after a restart):
    // re-running the top-level scheduling on worker wake must not restart
    // the 15-minute countdown.
    sb.alarmsStore.syncPush = { periodInMinutes: 15 };
    sb.sandbox.scheduleSync();
    await sb.flush();

    assert.equal(sb.alarmsCreated.length, 1, 'existing alarm must not be re-created');
});

test('buildSyncPayload matches the export envelope with dates newest-first', () => {
    const sb = createSyncSandbox({ startMs: NOW_MS });
    const history = {
        '2026-11-18': day(3601.99, 1809.75, { '14': 715.27 }),
        '2024-07-14': day(10, 5),
        '2026-01-25': day(120, 90, { '9': 90 }),
    };

    const payload = sb.sandbox.buildSyncPayload(history);

    assert.equal(payload.version, '2.0');
    assert.equal(payload.exportDate, new Date(NOW_MS).toISOString());
    assert.deepEqual(Object.keys(payload.data), ['2026-11-18', '2026-01-25', '2024-07-14']);
    assert.deepEqual(payload.data['2026-01-25'], history['2026-01-25']);
});

test('runSync posts the full history and records an ok state', async () => {
    const history = { '2026-11-18': day(100, 60) };
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: { videoWatchHistory: history },
    });

    const result = await sb.sandbox.runSync();
    assert.deepEqual(result, { ok: true });

    assert.equal(sb.fetchCalls.length, 1);
    assert.equal(sb.fetchCalls[0].url, SYNC_URL);
    assert.equal(sb.fetchCalls[0].options.method, 'POST');

    const body = JSON.parse(sb.fetchCalls[0].options.body);
    assert.equal(body.version, '2.0');
    assert.equal(body.exportDate, new Date(NOW_MS).toISOString());
    assert.deepEqual(body.data, history);

    assert.deepEqual(sb.storeData.syncState, {
        lastSuccessAt: NOW_MS,
        lastAttemptAt: NOW_MS,
        lastStatus: 'ok',
        lastError: null,
    });
    assert.equal(sb.setCalls.length, 1, 'only syncState is written');
});

test('failed sync marks unavailable, preserves lastSuccessAt, touches no history', async () => {
    const history = { '2026-11-18': day(100, 60) };
    const before = JSON.parse(JSON.stringify(history));
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: {
            videoWatchHistory: history,
            syncState: { lastSuccessAt: 12345, lastAttemptAt: 100, lastStatus: 'ok', lastError: null },
        },
    });
    sb.setFetch(async () => {
        throw new Error('ECONNREFUSED: app not running');
    });

    const result = await sb.sandbox.runSync();
    assert.deepEqual(result, { ok: false });

    assert.deepEqual(sb.storeData.syncState, {
        lastSuccessAt: 12345, // previous success preserved for the popup
        lastAttemptAt: NOW_MS,
        lastStatus: 'unavailable',
        lastError: 'ECONNREFUSED: app not running',
    });
    assert.deepEqual(sb.storeData.videoWatchHistory, before, 'history must be untouched on failure');
    assert.equal(sb.setCalls.length, 1);
});

test('HTTP 500 marks unavailable with the status in lastError', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS, storage: { videoWatchHistory: { '2026-11-18': day(1, 1) } } });
    sb.setFetch(async () => ({ ok: false, status: 500 }));

    const result = await sb.sandbox.runSync();
    assert.deepEqual(result, { ok: false });
    assert.equal(sb.storeData.syncState.lastStatus, 'unavailable');
    assert.equal(sb.storeData.syncState.lastError, 'HTTP 500');
});

test('next successful push carries the data tracked while the app was down', async () => {
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: { videoWatchHistory: { '2026-11-18': day(100, 60) } },
    });

    // App down: sync fails, browser keeps everything (already asserted above).
    sb.setFetch(async () => {
        throw new Error('ECONNREFUSED');
    });
    await sb.sandbox.runSync();
    assert.equal(sb.storeData.syncState.lastStatus, 'unavailable');

    // Downtime: content.js keeps flushing to chrome.storage.local, so a new
    // day appears. Simulate that by writing to the same backing store.
    sb.storeData.videoWatchHistory['2026-11-19'] = day(200, 100, { '8': 100 });

    // App back: the full-history push must deliver BOTH days.
    sb.setFetch(async () => ({ ok: true, status: 200 }));
    const result = await sb.sandbox.runSync();
    assert.deepEqual(result, { ok: true });

    const body = JSON.parse(sb.fetchCalls[1].options.body);
    assert.deepEqual(Object.keys(body.data).sort(), ['2026-11-18', '2026-11-19']);
    assert.deepEqual(body.data['2026-11-19'], day(200, 100, { '8': 100 }));
});

test('hung server hits the timeout, aborts the request and reports timeout', async () => {
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: { videoWatchHistory: { '2026-11-18': day(1, 1) } },
        fakeTimers: true,
    });
    // Fetch mock that never resolves on its own but honors abort, like real fetch.
    sb.setFetch((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
        });
    }));

    const pending = sb.sandbox.runSync();
    await sb.tick(); // let readSyncData's queued callback start the fetch
    assert.equal(sb.timers.scheduled.length, 1);
    assert.equal(sb.timers.scheduled[0].ms, 10000);

    sb.fireTimer(sb.timers.scheduled[0]);
    const result = await pending;

    assert.deepEqual(result, { ok: false });
    assert.equal(sb.storeData.syncState.lastStatus, 'unavailable');
    assert.equal(sb.storeData.syncState.lastError, 'timeout');
    assert.equal(sb.timers.cleared.length, 1, 'timeout timer is cleared after the attempt');
});

test('syncNow message runs a sync and replies with the result', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS, storage: { videoWatchHistory: { '2026-11-18': day(5, 2) } } });

    const reply = await sb.sendSyncNow();
    assert.deepEqual(reply, { response: { ok: true }, keepOpen: true });
    assert.equal(sb.fetchCalls.length, 1);
    assert.equal(sb.storeData.syncState.lastStatus, 'ok');
});

test('non-syncNow messages are ignored', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS });
    const reply = await sb.sendSyncNow({ action: 'somethingElse' });
    assert.equal(reply.response, undefined);
    assert.equal(sb.fetchCalls.length, 0);
});

test('alarm firing triggers a sync; unrelated alarms do not', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS, storage: { videoWatchHistory: { '2026-11-18': day(1, 1) } } });

    sb.alarmFired('someOtherAlarm');
    await sb.flush();
    assert.equal(sb.fetchCalls.length, 0);

    sb.alarmFired('syncPush');
    await sb.flush();
    await sb.flush();
    assert.equal(sb.fetchCalls.length, 1);
    assert.equal(sb.storeData.syncState.lastStatus, 'ok');
});

test('browser startup schedules the alarm and immediately catches up', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS, storage: { videoWatchHistory: { '2026-11-18': day(1, 1) } } });

    sb.startup();
    await sb.flush();
    await sb.flush();

    assert.equal(sb.alarmsCreated.length, 1);
    assert.equal(sb.fetchCalls.length, 1, 'startup performs a sync to flush any backlog');
    assert.equal(sb.storeData.syncState.lastStatus, 'ok');
});

test('syncIfDue syncs when no attempt has been recorded yet', async () => {
    const sb = createSyncSandbox({ startMs: NOW_MS, storage: { videoWatchHistory: { '2026-11-18': day(1, 1) } } });

    await sb.sandbox.syncIfDue();

    assert.equal(sb.fetchCalls.length, 1, 'fresh install/reload must sync without waiting for the alarm');
    assert.equal(sb.storeData.syncState.lastStatus, 'ok');
});

test('syncIfDue skips when the last attempt is fresh', async () => {
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: {
            syncState: { lastSuccessAt: NOW_MS - 60000, lastAttemptAt: NOW_MS - 60000, lastStatus: 'ok', lastError: null },
        },
    });

    await sb.sandbox.syncIfDue();
    assert.equal(sb.fetchCalls.length, 0, 'frequent worker wakes must not spam the endpoint');
});

test('syncIfDue syncs when the last attempt is stale', async () => {
    const stale = NOW_MS - 15 * 60 * 1000 - 1; // just past the 15-minute gate
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: {
            videoWatchHistory: { '2026-11-18': day(1, 1) },
            syncState: { lastSuccessAt: stale, lastAttemptAt: stale, lastStatus: 'ok', lastError: null },
        },
    });

    await sb.sandbox.syncIfDue();
    assert.equal(sb.fetchCalls.length, 1);
    assert.equal(sb.storeData.syncState.lastStatus, 'ok');
});

test('syncIfDue still attempts when the last attempt failed', async () => {
    const sb = createSyncSandbox({
        startMs: NOW_MS,
        storage: {
            videoWatchHistory: { '2026-11-18': day(1, 1) },
            syncState: { lastSuccessAt: 0, lastAttemptAt: NOW_MS - 60000, lastStatus: 'unavailable', lastError: 'HTTP 500' },
        },
    });

    await sb.sandbox.syncIfDue();
    assert.equal(sb.fetchCalls.length, 0, 'a fresh failed attempt is still within the gate');
});
