// Video Watchtime Dashboard — single-file Bun app (zero npm dependencies).
//
// Receives watch-history pushes from the extension (POST /api/sync), mirrors
// them into SQLite, and serves the dashboard UI + JSON data for it.
//
// Run:  bun app.js          (env: PORT, DATA_DIR)
// Test: bun test

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";

// Mirrors popup.js isValidSeconds: rejects negatives, non-numbers, non-finite
// values (JSON "1e400" parses to Infinity and poisons totals), and absurd
// magnitudes (> 31 years of seconds in a single day).
const MAX_SECONDS = 1e9;

export function isValidSeconds(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS;
}

// Accepts "YYYY-MM-DD" only when it is a real calendar date ("2026-02-30"
// passes the regex but must not create rows the UI can't sort).
export function isValidDate(date) {
    if (typeof date !== "string" || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// Validates a sync payload (the extension's export envelope:
// {exportDate, version, data: {date: {durationWatched, actualTimeWatched, byHour?}}}).
// Mirrors popup.js mergeImportedHistory's gates: bad dates / garbage fields are
// skipped (never coerced), hour keys must be integers 0-23 (defuses
// "__proto__" and "25"), and all-zero days are skipped so they don't create
// empty rows. Returns {rows, skipped} or {error} when the envelope itself is
// malformed.
export function validateSyncPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { error: "payload must be a JSON object" };
    }
    const data = payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { error: 'missing or invalid "data" field' };
    }

    const rows = [];
    let skipped = 0;

    for (const [date, stats] of Object.entries(data)) {
        if (!isValidDate(date)) { skipped++; continue; }
        if (!stats || typeof stats !== "object" || Array.isArray(stats)) { skipped++; continue; }

        let duration = 0;
        let actual = 0;
        const byHour = new Map(); // hour (int 0-23) -> seconds

        if (isValidSeconds(stats.durationWatched)) {
            duration = stats.durationWatched;
        }
        if (isValidSeconds(stats.actualTimeWatched)) {
            actual = stats.actualTimeWatched;
        }

        if (stats.byHour && typeof stats.byHour === "object" && !Array.isArray(stats.byHour)) {
            for (const [hour, seconds] of Object.entries(stats.byHour)) {
                const hourNum = Number(hour);
                if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) continue;
                if (!isValidSeconds(seconds)) continue;
                byHour.set(hourNum, seconds);
            }
        }

        // Only keep days that contribute a nonzero amount somewhere — mirrors
        // the importer so a hostile payload of a million zero days creates
        // nothing.
        const hasContribution = duration > 0 || actual > 0 || [...byHour.values()].some((s) => s > 0);
        if (!hasContribution) { skipped++; continue; }

        rows.push({ date, duration, actual, byHour });
    }

    return { rows, skipped };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_watch (
    date                TEXT PRIMARY KEY,
    duration_watched    REAL NOT NULL DEFAULT 0,
    actual_time_watched REAL NOT NULL DEFAULT 0,
    updated_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hourly_watch (
    date    TEXT NOT NULL,
    hour    INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (date, hour)
);
CREATE TABLE IF NOT EXISTS sync_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    synced_at TEXT NOT NULL,
    days      INTEGER NOT NULL
);
`;

export function openDatabase(path) {
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    return db;
}

// Applies a sync payload: upserts per date (never deletes anything outside the
// synced dates), replacing each synced date's hourly rows wholesale so the DB
// converges to the browser's state. Idempotent — replaying the same payload
// yields identical rows. One transaction per sync.
export function applySync(db, payload, nowIso = new Date().toISOString()) {
    const validated = validateSyncPayload(payload);
    if (validated.error) return validated;

    const upsertDaily = db.query(`
        INSERT INTO daily_watch (date, duration_watched, actual_time_watched, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            duration_watched = excluded.duration_watched,
            actual_time_watched = excluded.actual_time_watched,
            updated_at = excluded.updated_at
    `);
    const deleteHourly = db.query("DELETE FROM hourly_watch WHERE date = ?");
    const insertHourly = db.query("INSERT INTO hourly_watch (date, hour, seconds) VALUES (?, ?, ?)");
    const insertLog = db.query("INSERT INTO sync_log (synced_at, days) VALUES (?, ?)");

    db.transaction(() => {
        for (const row of validated.rows) {
            upsertDaily.run(row.date, row.duration, row.actual, nowIso);
            deleteHourly.run(row.date);
            for (const [hour, seconds] of row.byHour) {
                insertHourly.run(row.date, hour, seconds);
            }
        }
        insertLog.run(nowIso, validated.rows.length);
    })();

    return { ok: true, days: validated.rows.length, skipped: validated.skipped };
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// Builds the full request handler (routing + DB + static files) without
// opening a network socket, so integration tests can drive it directly.
export function createApp({ dataDir } = {}) {
    const dir = dataDir || join(import.meta.dir, "data");
    mkdirSync(dir, { recursive: true });
    const db = openDatabase(join(dir, "watchtime.db"));
    const staticDir = resolve(import.meta.dir, "static");

    function serveFile(absPath) {
        // Bun.file().exists() is async; existsSync keeps routing synchronous.
        if (!existsSync(absPath)) return new Response("Not found", { status: 404 });
        const file = Bun.file(absPath);
        return new Response(file, {
            headers: { "Content-Type": MIME[extname(absPath)] || "application/octet-stream" },
        });
    }

    async function handler(req) {
        const url = new URL(req.url);
        const path = url.pathname;
        try {
            if (req.method === "POST" && path === "/api/sync") {
                // Refuse absurd bodies before parsing them; a legitimate full
                // history is ~200 KB (834 days), so 64 MB leaves huge headroom.
                const contentLength = Number(req.headers.get("content-length") || 0);
                if (contentLength > 64 * 1024 * 1024) {
                    return jsonResponse({ status: "error", error: "payload too large" }, 413);
                }
                let payload;
                try {
                    payload = await req.json();
                } catch {
                    return jsonResponse({ status: "error", error: "request body must be valid JSON" }, 400);
                }
                const result = applySync(db, payload);
                if (result.error) return jsonResponse({ status: "error", error: result.error }, 400);
                // Visible in `docker logs watchtime-dashboard` — makes it easy
                // to confirm the extension is actually reaching the server.
                console.log(`[sync] stored ${result.days} days (${result.skipped} skipped)`);
                return jsonResponse({ status: "ok", days: result.days, skipped: result.skipped });
            }

            if (req.method === "GET" && path === "/api/data") {
                const daily = db
                    .query(`SELECT date, duration_watched AS durationWatched,
                                   actual_time_watched AS actualTimeWatched,
                                   updated_at AS updatedAt
                            FROM daily_watch ORDER BY date`)
                    .all();
                const hourly = db
                    .query("SELECT date, hour, seconds FROM hourly_watch ORDER BY date, hour")
                    .all();
                const lastSync =
                    db.query("SELECT synced_at AS syncedAt, days FROM sync_log ORDER BY id DESC LIMIT 1").get() ?? null;
                return jsonResponse({ daily, hourly, lastSync });
            }

            if (req.method === "GET" && path === "/api/health") {
                return jsonResponse({ status: "ok" });
            }

            if (req.method === "GET" && (path === "/" || path === "/index.html")) {
                return serveFile(join(staticDir, "index.html"));
            }

            if (req.method === "GET" && path.startsWith("/static/")) {
                // Resolve and re-check the prefix so encoded traversal
                // ("..%2f") can never escape the static directory.
                const candidate = resolve(staticDir, "." + path.slice("/static".length));
                if (candidate === staticDir || candidate.startsWith(staticDir + sep)) {
                    return serveFile(candidate);
                }
                return new Response("Not found", { status: 404 });
            }

            return new Response("Not found", { status: 404 });
        } catch (err) {
            return jsonResponse({ status: "error", error: String((err && err.message) || err) }, 500);
        }
    }

    return { db, fetch: handler };
}

if (import.meta.main) {
    const port = Number(process.env.PORT || 3000);
    const dataDir = process.env.DATA_DIR || join(import.meta.dir, "data");
    const app = createApp({ dataDir });
    Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });
    console.log(`Watchtime dashboard listening on http://127.0.0.1:${port} (data: ${dataDir})`);
}
