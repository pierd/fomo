import { describe, expect, it } from "vitest";
import { buildBracket, mergeImported, Ranking, type Comparison } from "./ranking";
import { parseDuration } from "./duration";

function simulate(n: number, seed: number, ties = false) {
  const ids = Array.from({ length: n }, (_, i) => `i${i}`);
  // Hidden "true" score: lower index = better (with ties grouped in pairs).
  const score = (id: string) => (ties ? Math.floor(Number(id.slice(1)) / 2) : Number(id.slice(1)));
  const r = new Ranking(ids);
  const log: Comparison[] = [];
  let asked = 0;
  for (;;) {
    const pair = r.nextPair(seed + asked);
    if (!pair) break;
    const [a, b] = pair;
    expect(r.relation(a, b)).toBe("unknown");
    const result = score(a) === score(b) ? "draw" : score(a) < score(b) ? "a" : "b";
    expect(r.add({ a, b, result })).toBe(true);
    log.push({ a, b, result });
    asked++;
    expect(asked).toBeLessThan(n * n);
  }
  return { r, asked, log };
}

describe("ranking", () => {
  it("finds the true top 4", () => {
    for (const n of [2, 3, 4, 5, 8, 17, 64]) {
      const { r, asked } = simulate(n, 7);
      const s = r.standings();
      expect(s.map((x) => x.itemId)).toEqual(Array.from({ length: Math.min(4, n) }, (_, i) => `i${i}`));
      expect(s.map((x) => x.rank)).toEqual(Array.from({ length: Math.min(4, n) }, (_, i) => i + 1));
      if (n === 64) expect(asked).toBeLessThan(130);
    }
  });

  it("handles draws", () => {
    const { r } = simulate(10, 3, true);
    const s = r.standings();
    expect(s.map((x) => x.rank)).toEqual([1, 1, 3, 3]);
  });

  it("infers transitively and rejects contradictions", () => {
    const r = new Ranking(["a", "b", "c"]);
    r.add({ a: "a", b: "b", result: "a" });
    r.add({ a: "b", b: "c", result: "a" });
    expect(r.relation("a", "c")).toBe("above");
    expect(r.add({ a: "c", b: "a", result: "a" })).toBe(false);
  });

  it("propagates draws", () => {
    const r = new Ranking(["a", "b", "c", "d"]);
    r.add({ a: "a", b: "b", result: "draw" });
    r.add({ a: "b", b: "c", result: "a" });
    r.add({ a: "d", b: "a", result: "a" });
    expect(r.relation("a", "c")).toBe("above");
    expect(r.relation("d", "b")).toBe("above");
    expect(r.relation("d", "c")).toBe("above");
  });

  it("counts import conflicts", () => {
    const ids = ["a", "b", "c", "d"];
    const { accepted, conflicts } = mergeImported(ids, [
      { a: "a", b: "b", result: "a" },
      { a: "b", b: "a", result: "a" }, // disagrees with the first
      { a: "b", b: "c", result: "a" },
      { a: "c", b: "d", result: "a" },
      { a: "d", b: "b", result: "a" }, // closes a cycle
      { a: "x", b: "a", result: "a" }, // not a participant
    ]);
    expect(accepted.length).toBe(2);
    expect(conflicts).toBe(2);
  });

  it("builds a bracket ending in the winner", () => {
    const { r, log } = simulate(16, 11);
    const winner = r.standings()[0].itemId;
    const b = buildBracket(log, winner);
    expect(b.itemId).toBe(winner);
    expect(b.kind).toBe("match");
  });
});

describe("parseDuration", () => {
  it("reads common formats", () => {
    expect(parseDuration("2h 30m")).toEqual({ mode: "minutes", minutes: 150 });
    expect(parseDuration("1.5h")).toEqual({ mode: "minutes", minutes: 90 });
    expect(parseDuration("2:15")).toEqual({ mode: "minutes", minutes: 135 });
    expect(parseDuration("142 min")).toEqual({ mode: "minutes", minutes: 142 });
    expect(parseDuration("90")).toEqual({ mode: "minutes", minutes: 90 });
    expect(parseDuration("320 pages")).toMatchObject({ mode: "pages", pages: 320 });
    expect(parseDuration("N/A")).toEqual({ mode: "na" });
    expect(parseDuration("figure this out")).toEqual({ mode: "auto" });
    expect(parseDuration("")).toEqual({ mode: "unset" });
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("300 stron")).toMatchObject({ mode: "pages", pages: 300 });
    expect(parseDuration("250 páginas")).toMatchObject({ mode: "pages", pages: 250 });
    expect(parseDuration("2 godz. 30 min")).toEqual({ mode: "minutes", minutes: 150 });
    expect(parseDuration("2 horas")).toEqual({ mode: "minutes", minutes: 120 });
    expect(parseDuration("n/d")).toEqual({ mode: "na" });
    expect(parseDuration("nie wiem")).toEqual({ mode: "auto" });
    expect(parseDuration("no sé")).toEqual({ mode: "auto" });
  });
});
