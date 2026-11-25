// Tournament logic, shared by the backend (validation, completion) and the
// frontend (picking the next pair, drawing the bracket). Pure: no Convex APIs.
//
// Results form a partial order. "A beats B" is an edge, and edges are closed
// transitively (A > B and B > C imply A > C), so a pair whose order is already
// known is never asked about. A draw makes two items equivalent: whatever is
// above or below one of them is above or below the other too. Because only
// unknown pairs are asked, answers can never create a cycle.

export type Result = "a" | "b" | "draw";
export type Comparison<Id extends string = string> = { a: Id; b: Id; result: Result };
export type Relation = "above" | "below" | "equal" | "unknown";

// How many items the final standing fully orders.
export const TOP_K = 4;

export const MAX_PARTICIPANTS = 1000;

export class Ranking<Id extends string = string> {
  readonly ids: Id[];
  private index = new Map<Id, number>();
  readonly above: Set<number>[];
  readonly below: Set<number>[];
  readonly eq: Set<number>[];
  // Direct comparisons per item (asked or imported), to spread questions.
  readonly direct: number[];

  constructor(ids: Id[]) {
    this.ids = [...new Set(ids)];
    this.ids.forEach((id, i) => this.index.set(id, i));
    const n = this.ids.length;
    this.above = Array.from({ length: n }, () => new Set<number>());
    this.below = Array.from({ length: n }, () => new Set<number>());
    this.eq = Array.from({ length: n }, (_, i) => new Set([i]));
    this.direct = new Array<number>(n).fill(0);
  }

  has(id: Id) {
    return this.index.has(id);
  }

  relation(a: Id, b: Id): Relation {
    const i = this.index.get(a);
    const j = this.index.get(b);
    if (i === undefined || j === undefined) return "unknown";
    return this.rel(i, j);
  }

  private rel(i: number, j: number): Relation {
    if (this.eq[i].has(j)) return "equal";
    if (this.below[i].has(j)) return "above";
    if (this.above[i].has(j)) return "below";
    return "unknown";
  }

  // Whether a result agrees with everything known so far.
  consistent(c: Comparison<Id>): boolean {
    const r = this.relation(c.a, c.b);
    if (r === "unknown") return true;
    if (c.result === "draw") return r === "equal";
    return c.result === "a" ? r === "above" : r === "below";
  }

  // Adds a result; returns false (and changes nothing) if it contradicts what
  // is already known or mentions an item that isn't taking part.
  add(c: Comparison<Id>): boolean {
    const i = this.index.get(c.a);
    const j = this.index.get(c.b);
    if (i === undefined || j === undefined || i === j) return false;
    if (!this.consistent(c)) return false;
    this.direct[i]++;
    this.direct[j]++;
    if (this.rel(i, j) !== "unknown") return true;
    if (c.result === "draw") this.merge(i, j);
    else if (c.result === "a") this.win(i, j);
    else this.win(j, i);
    return true;
  }

  private win(w: number, l: number) {
    const up = [...this.eq[w], ...this.above[w]];
    const down = [...this.eq[l], ...this.below[l]];
    for (const u of up) for (const d of down) this.below[u].add(d);
    for (const d of down) for (const u of up) this.above[d].add(u);
  }

  private merge(i: number, j: number) {
    const members = new Set([...this.eq[i], ...this.eq[j]]);
    const up = new Set([...this.above[i], ...this.above[j]]);
    const down = new Set([...this.below[i], ...this.below[j]]);
    for (const m of members) {
      this.eq[m] = members;
      this.above[m] = new Set(up);
      this.below[m] = new Set(down);
    }
    for (const u of up) for (const x of [...members, ...down]) this.below[u].add(x);
    for (const d of down) for (const x of [...members, ...up]) this.above[d].add(x);
  }

  // Number of items known to be strictly better.
  beatenBy(id: Id) {
    const i = this.index.get(id);
    return i === undefined ? 0 : this.above[i].size;
  }

  // Items that can still make the top K.
  candidates(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.ids.length; i++) if (this.above[i].size < TOP_K) out.push(i);
    return out;
  }

  // Pairs of candidates whose order is still unknown.
  openPairs(): [number, number][] {
    const c = this.candidates();
    const pairs: [number, number][] = [];
    for (let x = 0; x < c.length; x++) {
      for (let y = x + 1; y < c.length; y++) {
        if (this.rel(c[x], c[y]) === "unknown") pairs.push([c[x], c[y]]);
      }
    }
    return pairs;
  }

  isFinished() {
    return this.openPairs().length === 0;
  }

  // Somewhat random, but as few rounds as possible: always pair the strongest
  // contenders (fewest known betters). That plays out as a knockout for the
  // winner, then playoffs among those who only lost to it, and so on; anyone
  // who loses to an item already 4th or worse drops out without more questions.
  // Ties prefer evenly matched items that have been compared the least.
  nextPair(seed: number): [Id, Id] | null {
    const pairs = this.openPairs();
    if (pairs.length === 0) return null;
    const rand = mulberry32(seed);
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (const [i, j] of pairs) {
      const ai = this.above[i].size;
      const aj = this.above[j].size;
      const score = (ai + aj) * 100 + Math.abs(ai - aj) * 10 + this.direct[i] + this.direct[j] + rand() * 3;
      if (score < bestScore) {
        bestScore = score;
        best = [i, j];
      }
    }
    if (best === null) return null;
    const [i, j] = rand() < 0.5 ? best : [best[1], best[0]];
    return [this.ids[i], this.ids[j]];
  }

  // Top K (more when tied), best first. Rank = 1 + number of items above.
  standings(): { itemId: Id; rank: number }[] {
    return this.candidates()
      .map((i) => ({ itemId: this.ids[i], rank: this.above[i].size + 1 }))
      .sort((x, y) => x.rank - y.rank);
  }

  // Roughly how many more answers are needed: every undefeated item but one
  // still has to lose (the knockout), then a few rounds of playoffs settle
  // each of the remaining top places.
  estimateLeft() {
    const open = this.openPairs().length;
    if (open === 0) return 0;
    const c = this.candidates();
    const undefeated = c.filter((i) => this.above[i].size === 0).length;
    const playoffs = (TOP_K - 1) * Math.ceil(Math.log2(Math.max(2, c.length)));
    return Math.max(1, Math.min(open, Math.max(0, undefeated - 1) + playoffs));
  }

  progress() {
    const n = this.ids.length;
    return { total: n, ruledOut: n - this.candidates().length, left: this.estimateLeft() };
  }

}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildRanking<Id extends string>(ids: Id[], comparisons: Comparison<Id>[]) {
  const r = new Ranking(ids);
  for (const c of comparisons) r.add(c);
  return r;
}

// Results imported from past tournaments. A pair answered differently in
// different tournaments is a conflict and dropped; so is any result that
// contradicts what the accepted ones already imply (e.g. closing a cycle).
export function mergeImported<Id extends string>(ids: Id[], comparisons: Comparison<Id>[]) {
  const ranking = new Ranking(ids);
  const byPair = new Map<string, { c: Comparison<Id>; key: string; conflict: boolean }>();
  for (const c of comparisons) {
    if (!ranking.has(c.a) || !ranking.has(c.b) || c.a === c.b) continue;
    // Normalize so the pair is (smaller id, larger id).
    const n: Comparison<Id> =
      c.a < c.b ? c : { a: c.b, b: c.a, result: c.result === "draw" ? "draw" : c.result === "a" ? "b" : "a" };
    const key = `${n.a}|${n.b}`;
    const seen = byPair.get(key);
    if (seen === undefined) byPair.set(key, { c: n, key, conflict: false });
    else if (seen.c.result !== n.result) seen.conflict = true;
  }
  const accepted: Comparison<Id>[] = [];
  let conflicts = 0;
  for (const { c, conflict } of byPair.values()) {
    if (conflict) conflicts++;
    else if (ranking.add(c)) accepted.push(c);
    else conflicts++;
  }
  return { accepted, conflicts };
}

// Knockout-style tree of how the winner got there, rebuilt from direct results
// in the order they happened: when two items still "in" meet, the loser is out
// and the winner carries the match up.
export type Bracket<Id extends string = string> =
  | { kind: "leaf"; itemId: Id }
  | { kind: "match"; itemId: Id; left: Bracket<Id>; right: Bracket<Id> };

export function buildBracket<Id extends string>(comparisons: Comparison<Id>[], winner: Id): Bracket<Id> {
  const alive = new Map<Id, Bracket<Id>>();
  const out = new Set<Id>();
  const node = (id: Id): Bracket<Id> => alive.get(id) ?? { kind: "leaf", itemId: id };
  for (const c of comparisons) {
    if (c.result === "draw" || out.has(c.a) || out.has(c.b)) continue;
    const [w, l] = c.result === "a" ? [c.a, c.b] : [c.b, c.a];
    alive.set(w, { kind: "match", itemId: w, left: node(w), right: node(l) });
    alive.delete(l);
    out.add(l);
  }
  return node(winner);
}
