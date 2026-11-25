// Ranking duels ("find its place", "sharpen the top") and the pool of every
// answer the global ranking is made from.
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireOwnItem, requireUserId } from "./lib/auth";
import type { Answer } from "./lib/globalRanking";
import { resultValidator } from "./schema";
import { fail } from "./lib/errors";

// Convex returns arrays of at most 8192; beyond that the oldest are left out.
const MAX_ANSWERS = 8000;

// With the id the device gave it, to match it with changes not synced yet.
type PoolAnswer = Answer<Id<"items">> & { clientId?: string };

export const answers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const duels = await ctx.db
      .query("duels")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_ANSWERS);
    const out: PoolAnswer[] = duels.map((d) => ({
      a: d.a,
      b: d.b,
      result: d.result,
      at: d.answeredAt ?? d._creationTime,
      clientId: d.clientId,
    }));

    const tournaments = await ctx.db
      .query("tournaments")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    const copies: PoolAnswer[] = [];
    let budget = MAX_ANSWERS;
    for (const t of tournaments) {
      if (budget <= 0) break;
      const comparisons = await ctx.db
        .query("comparisons")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", t._id))
        .order("desc")
        .take(budget);
      budget -= comparisons.length;
      for (const c of comparisons) {
        // An imported result is a copy of an earlier answer: never newer than
        // an original, and only needed if its tournament has been deleted.
        if (c.imported) copies.push({ a: c.a, b: c.b, result: c.result, at: 0 });
        else
          out.push({ a: c.a, b: c.b, result: c.result, at: c.answeredAt ?? c._creationTime, clientId: c.clientId });
      }
    }
    const pairOf = (c: { a: string; b: string }) => (c.a < c.b ? `${c.a}|${c.b}` : `${c.b}|${c.a}`);
    const seen = new Set(out.map(pairOf));
    for (const c of copies) {
      if (seen.has(pairOf(c))) continue;
      seen.add(pairOf(c));
      out.push(c);
    }
    return out.sort((x, y) => y.at - x.at).slice(0, MAX_ANSWERS);
  },
});

export const record = mutation({
  args: { a: v.id("items"), b: v.id("items"), result: resultValidator },
  handler: async (ctx, { a, b, result }) => {
    const userId = await requireUserId(ctx);
    if (a === b) fail("notFound");
    await requireOwnItem(ctx, a);
    await requireOwnItem(ctx, b);
    return await ctx.db.insert("duels", { userId, a, b, result });
  },
});

// Undo.
export const remove = mutation({
  args: { duelId: v.id("duels") },
  handler: async (ctx, { duelId }) => {
    const userId = await requireUserId(ctx);
    const duel = await ctx.db.get("duels", duelId);
    if (duel === null || duel.userId !== userId) fail("notFound");
    await ctx.db.delete("duels", duelId);
    return null;
  },
});
