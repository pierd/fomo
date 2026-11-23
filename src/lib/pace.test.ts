import { describe, expect, it } from "vitest";
import { computePace, DAY } from "./pace";

const now = Date.UTC(2026, 10, 23);
const h = 60;

describe("computePace", () => {
  it("turns hours left into calendar time at your yearly pace", () => {
    const items = [
      { status: "done", addedAt: now - 800 * DAY, finishedAt: now - 100 * DAY, durationMinutes: 10 * h, durationMode: "minutes" },
      // Finished before the last year: doesn't count towards the pace.
      { status: "done", addedAt: now - 800 * DAY, finishedAt: now - 500 * DAY, durationMinutes: 30 * h, durationMode: "minutes" },
      { status: "active", addedAt: now - 10 * DAY, durationMinutes: 50 * h, durationMode: "pages" },
      { status: "active", addedAt: now - 10 * DAY, durationMode: "unset" },
      { status: "active", addedAt: now - 10 * DAY, durationMode: "na" },
    ];
    const p = computePace(items, now);
    expect(p.remainingMinutes).toBe(50 * h);
    expect(p.untimed).toBe(1);
    expect(p.fullYear).toBe(true);
    expect(p.finishedMinutes).toBe(10 * h);
    // 10h a year, 50h left: 5 years.
    expect(p.daysToClear! / 365).toBeCloseTo(5);
  });

  it("uses the history since you started when it's shorter than a year", () => {
    const items = [
      { status: "done", addedAt: now - 73 * DAY, finishedAt: now - 5 * DAY, durationMinutes: 10 * h, durationMode: "minutes" },
      { status: "active", addedAt: now - 73 * DAY, durationMinutes: 20 * h, durationMode: "minutes" },
    ];
    const p = computePace(items, now);
    expect(p.fullYear).toBe(false);
    expect(p.windowDays).toBeCloseTo(73);
    expect(p.daysToClear).toBeCloseTo(146);
  });

  it("has no pace without finished timed items", () => {
    const p = computePace([{ status: "active", addedAt: now, durationMinutes: 60, durationMode: "minutes" }], now);
    expect(p.daysToClear).toBeNull();
    expect(p.windowDays).toBe(30);
  });
});
