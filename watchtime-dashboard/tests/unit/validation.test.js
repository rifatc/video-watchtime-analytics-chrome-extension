// Unit tests for the sync payload validation + upsert semantics.
// Run: bun test (from the dashboard/ directory, inside Docker or any machine
// with Bun — nothing here touches a network socket).

import { describe, test, expect } from "bun:test";
import { isValidSeconds, isValidDate, validateSyncPayload, openDatabase, applySync } from "../../app.js";

describe("isValidSeconds", () => {
    test("accepts finite non-negative numbers", () => {
        expect(isValidSeconds(0)).toBe(true);
        expect(isValidSeconds(3601.99)).toBe(true);
        expect(isValidSeconds(1e9)).toBe(true);
    });

    test("rejects non-numbers, strings, negatives, infinities and absurd values", () => {
        expect(isValidSeconds("5")).toBe(false);   // string corruption
        expect(isValidSeconds(null)).toBe(false);
        expect(isValidSeconds(undefined)).toBe(false);
        expect(isValidSeconds(-0.5)).toBe(false);
        expect(isValidSeconds(Number.NaN)).toBe(false);
        expect(isValidSeconds(Infinity)).toBe(false);
        expect(isValidSeconds(1e9 + 1)).toBe(false); // > 31 years in one day
    });
});

describe("isValidDate", () => {
    test("accepts real calendar dates", () => {
        expect(isValidDate("2026-11-18")).toBe(true);
        expect(isValidDate("2024-02-29")).toBe(true); // leap year
    });

    test("rejects malformed and non-calendar dates", () => {
        expect(isValidDate("2026-13-45")).toBe(false); // regex-passes, impossible date
        expect(isValidDate("2026-02-30")).toBe(false);
        expect(isValidDate("2026-1-18")).toBe(false);
        expect(isValidDate("20261118")).toBe(false);
        expect(isValidDate(20261118)).toBe(false);
        expect(isValidDate("banana")).toBe(false);
    });
});

describe("validateSyncPayload", () => {
    const day = (duration, actual, byHour) => ({ durationWatched: duration, actualTimeWatched: actual, ...(byHour ? { byHour } : {}) });

    test("rejects a malformed envelope", () => {
        expect(validateSyncPayload(null).error).toBeTruthy();
        expect(validateSyncPayload("data").error).toBeTruthy();
        expect(validateSyncPayload([]).error).toBeTruthy();
        expect(validateSyncPayload({}).error).toBeTruthy();          // no data field
        expect(validateSyncPayload({ data: [] }).error).toBeTruthy(); // data must be an object
    });

    test("accepts a valid day with partial byHour", () => {
        const result = validateSyncPayload({
            exportDate: "2026-11-18T00:00:00Z",
            version: "2.0",
            data: { "2026-11-18": day(3601.99, 1809.75, { "0": 1094.48, "14": 61.7 }) },
        });
        expect(result.error).toBeUndefined();
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toEqual({
            date: "2026-11-18",
            duration: 3601.99,
            actual: 1809.75,
            byHour: new Map([[0, 1094.48], [14, 61.7]]),
        });
    });

    test("skips invalid and non-calendar dates instead of coercing them", () => {
        const result = validateSyncPayload({
            data: {
                "2026-13-45": day(10, 10),
                "2026-02-30": day(10, 10),
                "banana": day(10, 10),
                "2026-11-18": day(10, 10),
            },
        });
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].date).toBe("2026-11-18");
        expect(result.skipped).toBe(3);
    });

    test("skips days whose fields are all garbage (string seconds used to corrupt totals)", () => {
        const result = validateSyncPayload({
            data: { "2026-11-18": { durationWatched: "5", actualTimeWatched: "7" } },
        });
        expect(result.rows).toHaveLength(0);
        expect(result.skipped).toBe(1);
    });

    test("parses 1e400 as Infinity and keeps the valid half of the day", () => {
        // JSON cannot encode Infinity directly; 1e400 parses to it, which used
        // to poison every downstream total.
        const payload = JSON.parse('{"data":{"2026-11-18":{"durationWatched":1e400,"actualTimeWatched":10}}}');
        const result = validateSyncPayload(payload);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].duration).toBe(0); // Infinity rejected
        expect(result.rows[0].actual).toBe(10);  // valid field survives
    });

    test("hour gate: rejects '25', 'banana' and '__proto__' keys, keeps valid hours", () => {
        const result = validateSyncPayload({
            data: { "2026-11-18": day(10, 10, { "8": 100, "25": 999, "banana": 5, "__proto__": 7, "-1": 3 }) },
        });
        expect(result.rows[0].byHour).toEqual(new Map([[8, 100]]));
    });

    test("hour gate: rejects non-numeric hour seconds values", () => {
        const result = validateSyncPayload({
            data: { "2026-11-18": day(10, 10, { "8": "many", "9": Infinity }) },
        });
        expect(result.rows[0].byHour.size).toBe(0);
    });

    test("skips all-zero days (a million zero days must create nothing)", () => {
        const result = validateSyncPayload({
            data: { "2026-11-18": day(0, 0, { "8": 0 }) },
        });
        expect(result.rows).toHaveLength(0);
    });

    test("keeps a day with only a valid actualTimeWatched", () => {
        const result = validateSyncPayload({ data: { "2026-11-18": day(undefined, 10) } });
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].actual).toBe(10);
    });
});

describe("applySync (upsert semantics on an in-memory DB)", () => {
    function freshDb() {
        return openDatabase(":memory:");
    }

    const payload = (data) => ({ exportDate: "2026-01-01T00:00:00Z", version: "2.0", data });
    const dailyRow = (db, date) =>
        db.query("SELECT date, duration_watched AS durationWatched, actual_time_watched AS actualTimeWatched FROM daily_watch WHERE date = ?").get(date);
    const hoursOf = (db, date) =>
        db.query("SELECT hour, seconds FROM hourly_watch WHERE date = ? ORDER BY hour").all(date);

    test("inserts days and is idempotent when replayed", () => {
        const db = freshDb();
        const p = payload({ "2026-11-18": { durationWatched: 100, actualTimeWatched: 50, byHour: { "8": 50 } } });

        const first = applySync(db, p);
        expect(first.ok).toBe(true);
        expect(first.days).toBe(1);

        // Replay: same payload must not duplicate or change anything.
        const second = applySync(db, p);
        expect(second.days).toBe(1);
        expect(db.query("SELECT COUNT(*) AS n FROM daily_watch").get().n).toBe(1);
        expect(db.query("SELECT COUNT(*) AS n FROM hourly_watch").get().n).toBe(1);
        expect(dailyRow(db, "2026-11-18")).toEqual({ date: "2026-11-18", durationWatched: 100, actualTimeWatched: 50 });
        expect(hoursOf(db, "2026-11-18")).toEqual([{ hour: 8, seconds: 50 }]);
    });

    test("overwrites existing days with newer values (browser is source of truth)", () => {
        const db = freshDb();
        applySync(db, payload({ "2026-11-18": { durationWatched: 100, actualTimeWatched: 50 } }));
        applySync(db, payload({ "2026-11-18": { durationWatched: 200, actualTimeWatched: 80 } }));

        expect(db.query("SELECT COUNT(*) AS n FROM daily_watch").get().n).toBe(1);
        expect(dailyRow(db, "2026-11-18")).toEqual({ date: "2026-11-18", durationWatched: 200, actualTimeWatched: 80 });
    });

    test("replaces hourly rows wholesale for synced dates only", () => {
        const db = freshDb();
        applySync(db, payload({
            "2026-11-17": { durationWatched: 10, actualTimeWatched: 5, byHour: { "21": 5 } },
            "2026-11-18": { durationWatched: 10, actualTimeWatched: 5, byHour: { "8": 3, "9": 2 } },
        }));

        // v2: hours {9,10} replace {8,9} on the 18th; the 17th is untouched
        // because it is absent from the payload (never wiped).
        applySync(db, payload({
            "2026-11-18": { durationWatched: 20, actualTimeWatched: 12, byHour: { "9": 7, "10": 5 } },
        }));

        expect(hoursOf(db, "2026-11-18")).toEqual([{ hour: 9, seconds: 7 }, { hour: 10, seconds: 5 }]);
        expect(hoursOf(db, "2026-11-17")).toEqual([{ hour: 21, seconds: 5 }]);
        expect(db.query("SELECT COUNT(*) AS n FROM daily_watch").get().n).toBe(2);
    });

    test("drops hours that fell to zero via replacement and reports skipped days", () => {
        const db = freshDb();
        const first = applySync(db, payload({
            "2026-11-18": { durationWatched: 10, actualTimeWatched: 5, byHour: { "8": 5 } },
            "2026-11-19": { durationWatched: 0, actualTimeWatched: 0 }, // zero day skipped
        }));
        expect(first.days).toBe(1);
        expect(first.skipped).toBe(1);
        applySync(db, payload({ "2026-11-18": { durationWatched: 10, actualTimeWatched: 5, byHour: { "9": 5 } } }));
        expect(hoursOf(db, "2026-11-18")).toEqual([{ hour: 9, seconds: 5 }]);
    });

    test("returns the validation error for malformed envelopes", () => {
        const db = freshDb();
        expect(applySync(db, "nope").ok).toBeUndefined();
        expect(applySync(db, { data: 42 }).error).toBeTruthy();
    });
});
