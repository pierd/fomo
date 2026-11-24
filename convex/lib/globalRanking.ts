// The global ranking: one order over everything ever compared, in tournaments
// and in ranking duels. Pure, like ranking.ts; runs in the frontend.
//
// Answers go into one Ranking newest first, so when they contradict each other
// the newer ones win. What that leaves unknown is filled in by strength scores
// (Bradley-Terry with a prior at 0) fitted to every known pair, implied ones
// included. Items never compared score 0: between the proven and the beaten.

import { Ranking, type Comparison, type Relation } from "./ranking";

export type Answer<Id extends string = string> = Comparison<Id> & { at: number };

// Pull of every score towards 0, so few results can't give an extreme score.
const PRIOR = 1;
const MAX_SWEEPS = 60;
const EPSILON = 1e-9;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export class GlobalRanking<Id extends string = string> {
  private ranking: Ranking<Id>;
  private scores: Map<Id, number>;
  // Answers outvoted by newer ones.
  readonly ignored: number;

  constructor(answers: Answer<Id>[]) {
    const newest = [...answers].sort((x, y) => y.at - x.at);
    this.ranking = new Ranking(newest.flatMap((c) => [c.a, c.b]));
    let ignored = 0;
    for (const c of newest) if (!this.ranking.add(c)) ignored++;
    this.ignored = ignored;
    this.scores = fitScores(this.ranking);
  }

  isRanked(id: Id) {
    return this.ranking.has(id);
  }

  score(id: Id) {
    return this.scores.get(id) ?? 0;
  }

  relation(a: Id, b: Id): Relation {
    return this.ranking.relation(a, b);
  }

  // Best first. Ties keep the order given.
  sort<T>(list: T[], idOf: (x: T) => Id): T[] {
    return [...list].sort((x, y) => this.score(idOf(y)) - this.score(idOf(x)));
  }

  // Ranks (ties share one) of a list already sorted best first.
  ranks(sorted: Id[]): Map<Id, number> {
    const out = new Map<Id, number>();
    let rank = 1;
    sorted.forEach((id, i) => {
      if (i > 0 && this.score(id) !== this.score(sorted[i - 1])) rank = i + 1;
      out.set(id, rank);
    });
    return out;
  }
}

function fitScores<Id extends string>(r: Ranking<Id>): Map<Id, number> {
  const n = r.ids.length;
  // Flat neighbour lists: much faster to sweep than Sets.
  const losers = r.below.map((s) => Int32Array.from(s));
  const winners = r.above.map((s) => Int32Array.from(s));
  const s = new Float64Array(n);
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let gradient = -PRIOR * s[i];
      let curvature = PRIOR;
      for (const j of losers[i]) {
        const p = sigmoid(s[j] - s[i]);
        gradient += p;
        curvature += p * (1 - p);
      }
      for (const j of winners[i]) {
        const p = sigmoid(s[i] - s[j]);
        gradient -= p;
        curvature += p * (1 - p);
      }
      const step = Math.max(-1, Math.min(1, gradient / curvature));
      s[i] += step;
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 1e-4) break;
  }
  // The exact optimum respects the known order; make sure the approximation
  // does too. Fewer items above always comes first, so one pass is enough.
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => r.above[i].size - r.above[j].size);
  const settled = new Uint8Array(n);
  for (const i of order) {
    if (settled[i]) continue;
    let score = s[i];
    for (const j of winners[i]) score = Math.min(score, s[j] - EPSILON);
    // Drawn items are equivalent: one score for all of them.
    for (const j of r.eq[i]) {
      s[j] = score;
      settled[j] = 1;
    }
  }
  return new Map(r.ids.map((id, i) => [id, s[i]]));
}

// --- Finding one item's place: binary search through a fixed order ---

// `order` is the other items, best first, and must stay the same during a
// search: scores move with each answer, and halving needs a fixed list.
// `relationTo(other)` is how the item being placed relates to `other`.
export function nextPlacement<Id extends string>(
  order: Id[],
  relationTo: (other: Id) => Relation,
): { opponent: Id | null; left: number } {
  let lo = 0;
  let hi = order.length;
  for (let i = 0; i < order.length; i++) {
    const r = relationTo(order[i]);
    if (r === "equal") return { opponent: null, left: 0 };
    if (r === "below") lo = i + 1;
    else if (r === "above") hi = Math.min(hi, i);
  }
  if (lo >= hi) return { opponent: null, left: 0 };
  return { opponent: order[(lo + hi) >> 1], left: Math.ceil(Math.log2(hi - lo + 1)) };
}

// --- Sharpening the top ---

export const SHARPEN_TOP = 10;

// The most useful question about the top: neighbours whose order is only
// estimated, from the top down, then the last of the top against the likeliest
// challenger. `sorted` is best first.
export function nextSharpening<Id extends string>(g: GlobalRanking<Id>, sorted: Id[], top = SHARPEN_TOP): [Id, Id] | null {
  const k = Math.min(top, sorted.length);
  for (let i = 0; i + 1 < k; i++) {
    if (g.relation(sorted[i], sorted[i + 1]) === "unknown") return [sorted[i], sorted[i + 1]];
  }
  for (let i = k; i < sorted.length; i++) {
    if (g.relation(sorted[k - 1], sorted[i]) === "unknown") return [sorted[k - 1], sorted[i]];
  }
  return null;
}

// How many places from the top are certain: nothing further down could still
// turn out better.
export function confirmedTop<Id extends string>(g: GlobalRanking<Id>, sorted: Id[], top = SHARPEN_TOP): number {
  const k = Math.min(top, sorted.length);
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (g.relation(sorted[i], sorted[j]) === "unknown") return i;
    }
  }
  return k;
}
