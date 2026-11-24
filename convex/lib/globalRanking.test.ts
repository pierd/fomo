import { describe, expect, it } from "vitest";
import { confirmedTop, GlobalRanking, nextPlacement, nextSharpening, type Answer } from "./globalRanking";
import { mulberry32, Ranking } from "./ranking";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
const num = (id: string) => Number(id.slice(1));
const better = (a: string, b: string) => (num(a) === num(b) ? "draw" : num(a) < num(b) ? "a" : "b") as "a" | "b" | "draw";

// A knockout over `list` where a lower number wins.
function knockout(list: string[], at = 0): Answer[] {
  const r = new Ranking(list);
  const out: Answer[] = [];
  for (let pair = r.nextPair(1); pair; pair = r.nextPair(out.length)) {
    const c = { a: pair[0], b: pair[1], result: better(pair[0], pair[1]) };
    r.add(c);
    out.push({ ...c, at: at + out.length });
  }
  return out;
}

describe("global ranking", () => {
  it("keeps a tournament's order, and unranked items between the proven and the beaten", () => {
    const g = new GlobalRanking(knockout(ids(40)));
    const sorted = g.sort([...ids(40), "new"], (x) => x);
    expect(sorted.slice(0, 4)).toEqual(ids(4));
    expect(g.isRanked("new")).toBe(false);
    expect(g.score("i0")).toBeGreaterThan(0);
    expect(Math.min(...ids(40).map((x) => g.score(x)))).toBeLessThan(0);
  });

  it("values winning a big tournament over winning a small one", () => {
    const small = ["i100", "i101", "i102"];
    const g = new GlobalRanking([...knockout(ids(32)), ...knockout(small, 1000)]);
    expect(g.score("i0")).toBeGreaterThan(g.score("i100"));
    expect(g.score("i100")).toBeGreaterThan(0);
  });

  it("lets newer answers win, whatever order they arrive in", () => {
    const answers: Answer[] = [
      { a: "x", b: "y", result: "a", at: 1 },
      { a: "y", b: "x", result: "a", at: 2 },
    ];
    for (const list of [answers, [...answers].reverse()]) {
      const g = new GlobalRanking(list);
      expect(g.relation("y", "x")).toBe("above");
      expect(g.score("y")).toBeGreaterThan(g.score("x"));
      expect(g.ignored).toBe(1);
    }
  });

  it("never contradicts what it knows, even with inconsistent answers", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed);
      const list = ids(25);
      const answers: Answer[] = Array.from({ length: 80 }, (_, at) => {
        const a = list[Math.floor(rand() * 25)];
        const b = list[Math.floor(rand() * 25)];
        const x = rand();
        return { a, b, result: x < 0.45 ? ("a" as const) : x < 0.9 ? ("b" as const) : ("draw" as const), at };
      }).filter((c) => c.a !== c.b);
      const g = new GlobalRanking(answers);
      for (const a of list)
        for (const b of list) {
          const r = g.relation(a, b);
          if (r === "above") expect(g.score(a)).toBeGreaterThan(g.score(b));
          if (r === "equal") expect(g.score(a)).toBe(g.score(b));
        }
    }
  });

  it("shares ranks on ties", () => {
    const g = new GlobalRanking<string>([
      { a: "x", b: "y", result: "draw", at: 1 },
      { a: "x", b: "z", result: "a", at: 2 },
    ]);
    const sorted = g.sort(["z", "y", "x"], (x) => x);
    expect([...g.ranks(sorted).entries()]).toEqual([["y", 1], ["x", 1], ["z", 3]]);
  });

  it("stays fast on big lists", () => {
    const start = performance.now();
    new GlobalRanking(knockout(ids(500)));
    // Includes playing the knockout; generous, only catches blow-ups.
    expect(performance.now() - start).toBeLessThan(10000);
  }, 15000);
});

describe("placement", () => {
  it("finds the place in about log2(n) duels, between its neighbours", () => {
    const order = ids(100).filter((x) => x !== "i37");
    const base: Answer[] = order.slice(1).map((b, i) => ({ a: order[i], b, result: "a", at: i }));
    const answers = [...base];
    for (;;) {
      const g = new GlobalRanking(answers);
      const { opponent } = nextPlacement(order, (o) => g.relation("i37", o));
      if (opponent === null) break;
      answers.push({ a: "i37", b: opponent, result: better("i37", opponent), at: answers.length });
    }
    expect(answers.length - base.length).toBeLessThanOrEqual(7);
    const g = new GlobalRanking(answers);
    expect(g.sort(ids(100), (x) => x)).toEqual(ids(100));
  });

  it("also ends quickly when the order is only estimated", () => {
    const list = ids(64);
    const answers = knockout(list.filter((x) => x !== "i5"));
    const g0 = new GlobalRanking(answers);
    const order = g0.sort(list.filter((x) => x !== "i5"), (x) => x);
    let asked = 0;
    for (;;) {
      const g = new GlobalRanking(answers);
      const { opponent } = nextPlacement(order, (o) => g.relation("i5", o));
      if (opponent === null) break;
      answers.push({ a: "i5", b: opponent, result: better("i5", opponent), at: 1000 + asked++ });
    }
    expect(asked).toBeLessThanOrEqual(6);
    const pos = new GlobalRanking(answers).sort(list, (x) => x).indexOf("i5");
    expect(pos).toBeGreaterThanOrEqual(4);
    expect(pos).toBeLessThan(16);
  });

  it("stops on a draw", () => {
    expect(nextPlacement(["a", "b"], (o) => (o === "b" ? "equal" : "unknown")).opponent).toBeNull();
  });
});

describe("sharpening", () => {
  it("ends with an exact, fully confirmed top", () => {
    for (const start of [[], knockout(ids(40))]) {
      const list = [...ids(40)].reverse();
      const answers: Answer[] = [...start];
      for (;;) {
        const g = new GlobalRanking(answers);
        const sorted = g.sort(list, (x) => x);
        const pair = nextSharpening(g, sorted);
        if (!pair) {
          expect(sorted.slice(0, 10)).toEqual(ids(10));
          expect(confirmedTop(g, sorted)).toBe(10);
          break;
        }
        answers.push({ a: pair[0], b: pair[1], result: better(...pair), at: 1000 + answers.length });
        expect(answers.length).toBeLessThan(400);
      }
    }
  });
});
