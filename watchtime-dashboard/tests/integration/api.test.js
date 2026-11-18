// Integration tests: drive the full request -> validation -> SQLite ->
// response pipeline through the real app handler (no socket), plus one
// real-socket smoke test. Uses a temp data dir so the production DB in
// ./data is never touched.
//
// Run: bun test (inside the container — see README)

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../app.js";

let dataDir;
let app;

beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "watchtime-int-"));
    app = createApp({ dataDir });
});

afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

const BASE = "http://dashboard.test";

function post(path, body, headers = {}) {
    return app.fetch(new Request(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    }));
}

function get(path) {
    return app.fetch(new Request(BASE + path));
}

const day = (duration, actual, byHour) => ({ durationWatched: duration, actualTimeWatched: actual, ...(byHour ? { byHour } : {}) });
const envelope = (data) => ({ exportDate: "2026-01-01T00:00:00Z", version: "2.0", data });

describe("API", () => {
    test("health endpoint responds ok", async () => {
        const res = await get("/api/health");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ok" });
    });

    test("sync accepts a valid payload and /api/data round-trips it", async () => {
        const res = await post("/api/sync", envelope({
            "2026-11-17": day(100, 60, { "21": 60 }),
            "2026-11-18": day(3601.99, 1809.75, { "0": 1094.48, "14": 715.27 }),
        }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe("ok");
        expect(body.days).toBe(2);

        const data = await (await get("/api/data")).json();
        expect(data.daily).toHaveLength(2);
        expect(data.daily.find((d) => d.date === "2026-11-18")).toEqual({
            date: "2026-11-18",
            durationWatched: 3601.99,
            actualTimeWatched: 1809.75,
            updatedAt: expect.any(String),
        });
        expect(data.hourly.find((h) => h.date === "2026-11-18" && h.hour === 14).seconds).toBeCloseTo(715.27);
        expect(data.lastSync).toEqual({ syncedAt: expect.any(String), days: 2 });
    });

    test("invalid JSON body is a 400, not a crash", async () => {
        const res = await post("/api/sync", "{not json at all");
        expect(res.status).toBe(400);
        expect((await res.json()).status).toBe("error");
    });

    test("malformed envelope is a 400", async () => {
        const res = await post("/api/sync", { nope: true });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBeTruthy();
    });

    test("empty data object syncs zero days successfully", async () => {
        const res = await post("/api/sync", envelope({}));
        expect(res.status).toBe(200);
        expect((await res.json()).days).toBe(0);
    });

    test("catch-up flow: downtime backlog arrives in a later sync", async () => {
        // Day A syncs. Day B is tracked while the app is "down" (the extension
        // keeps it in chrome.storage). When the app returns, the extension's
        // full-history push delivers A (unchanged) and B together.
        await post("/api/sync", envelope({ "2026-12-01": day(50, 40) }));
        await post("/api/sync", envelope({
            "2026-12-01": day(50, 40),
            "2026-12-02": day(70, 35, { "10": 35 }),
        }));

        const data = await (await get("/api/data")).json();
        const dates = data.daily.map((d) => d.date);
        expect(dates).toContain("2026-12-01"); // earlier day re-synced unchanged
        expect(dates).toContain("2026-12-02"); // new day delivered with the backlog
        expect(data.daily.find((d) => d.date === "2026-12-02").actualTimeWatched).toBe(35);
    });

    test("serves the dashboard HTML and static assets", async () => {
        const html = await get("/");
        expect(html.status).toBe(200);
        expect(html.headers.get("Content-Type")).toContain("text/html");
        const text = await html.text();
        expect(text).toContain("Video Watchtime Dashboard");
        expect(text).toContain("hourlyHeatmap"); // hourly heatmap panel present

        const css = await get("/static/styles.css");
        expect(css.status).toBe(200);
        expect(css.headers.get("Content-Type")).toContain("text/css");

        const vendor = await get("/static/vendor/chart.umd.min.js");
        expect(vendor.status).toBe(200);
        expect(vendor.headers.get("Content-Type")).toContain("javascript");
        expect((await vendor.text()).length).toBeGreaterThan(50000); // the real Chart.js, not a stub
    });

    test("blocks path traversal out of the static directory", async () => {
        expect((await get("/static/../app.js")).status).toBe(404);       // URL-normalized away
        expect((await get("/static/%2e%2e/app.js")).status).toBe(404);   // encoded traversal
        expect((await get("/static/../../../etc/passwd")).status).toBe(404);
        expect((await get("/static/missing.js")).status).toBe(404);
    });

    test("unknown paths and wrong methods 404", async () => {
        expect((await get("/nope")).status).toBe(404);
        expect((await post("/api/data", {})).status).toBe(404);
        expect((await post("/static/styles.css", {})).status).toBe(404);
    });
});

describe("real socket smoke test", () => {
    test("Bun.serve + fetch end-to-end", async () => {
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
        try {
            const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ status: "ok" });

            const seeded = await fetch(`http://127.0.0.1:${server.port}/api/data`);
            const data = await seeded.json();
            expect(data.daily.length).toBeGreaterThan(0); // earlier tests seeded this DB
        } finally {
            server.stop(true);
        }
    });
});
