import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { buildRanking, mergeImported, type Comparison } from "./lib/ranking";
import { resultValidator } from "./schema";
import { fail } from "./lib/errors";

const MAX_PARTICIPANTS = 1000;
const MAX_COMPARISONS = 20000;

async function requireOwnTournament(ctx: QueryCtx, tournamentId: Id<"tournaments">) {
  const userId = await requireUserId(ctx);
  const t = await ctx.db.get("tournaments", tournamentId);
  if (t === null || t.userId !== userId) fail("notFound");
  return t;
}

async function comparisonsOf(ctx: QueryCtx, tournamentId: Id<"tournaments">) {
  return await ctx.db
    .query("comparisons")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(MAX_COMPARISONS);
}

async function participantsFor(ctx: QueryCtx, userId: Id<"users">, tagIds: Id<"tags">[]) {
  const items = await ctx.db
    .query("items")
    .withIndex("by_userId_and_status_and_addedAt", (q) => q.eq("userId", userId).eq("status", "active"))
    .take(5000);
  return items.filter((i) => tagIds.every((t) => i.tagIds.includes(t)));
}

async function importedFrom(ctx: QueryCtx, userId: Id<"users">, ids: Id<"tournaments">[], participants: Id<"items">[]) {
  const all: Comparison<Id<"items">>[] = [];
  for (const id of ids) {
    const t = await ctx.db.get("tournaments", id);
    if (t === null || t.userId !== userId) fail("notFound");
    for (const c of await comparisonsOf(ctx, id)) all.push({ a: c.a, b: c.b, result: c.result });
  }
  return mergeImported(participants, all);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const ts = await ctx.db
      .query("tournaments")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);
    return await Promise.all(
      ts.map(async (t) => {
        const top = await Promise.all(
          (t.standings ?? []).slice(0, 4).map(async (s) => {
            const item = await ctx.db.get("items", s.itemId);
            return { itemId: s.itemId, rank: s.rank, title: item?.title ?? "(deleted)" };
          }),
        );
        return {
          _id: t._id,
          _creationTime: t._creationTime,
          name: t.name,
          status: t.status,
          completedAt: t.completedAt,
          participantCount: t.participantIds.length,
          tagIds: t.tagIds,
          top,
        };
      }),
    );
  },
});

export const get = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    const t = await requireOwnTournament(ctx, tournamentId);
    const comparisons = await comparisonsOf(ctx, tournamentId);
    const items = await Promise.all(
      t.participantIds.map(async (id) => {
        const item = await ctx.db.get("items", id);
        if (item === null) return null;
        return {
          _id: item._id,
          title: item.title,
          creator: item.creator,
          year: item.year,
          durationMinutes: item.durationMinutes,
          status: item.status,
          coverUrl: item.coverStorageId ? await ctx.storage.getUrl(item.coverStorageId) : null,
        };
      }),
    );
    return {
      tournament: t,
      items: items.filter((i) => i !== null),
      comparisons: comparisons.map((c) => ({ _id: c._id, a: c.a, b: c.b, result: c.result, imported: c.imported })),
    };
  },
});

// What starting a tournament with these settings would give, before doing it.
export const preview = query({
  args: { tagIds: v.array(v.id("tags")), importFrom: v.array(v.id("tournaments")) },
  handler: async (ctx, { tagIds, importFrom }) => {
    const userId = await requireUserId(ctx);
    const participants = await participantsFor(ctx, userId, tagIds);
    const ids = participants.map((p) => p._id);
    const { accepted, conflicts } = await importedFrom(ctx, userId, importFrom, ids);
    return { participantCount: ids.length, imported: accepted.length, conflicts };
  },
});

export const create = mutation({
  args: {
    name: v.optional(v.string()),
    tagIds: v.array(v.id("tags")),
    importFrom: v.array(v.id("tournaments")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const participants = await participantsFor(ctx, userId, args.tagIds);
    if (participants.length < 2) fail("needTwoItems");
    if (participants.length > MAX_PARTICIPANTS) {
      fail("tooManyItems", { count: participants.length, max: MAX_PARTICIPANTS });
    }
    const ids = participants.map((p) => p._id);
    const { accepted, conflicts } = await importedFrom(ctx, userId, args.importFrom, ids);
    const tagNames = await Promise.all(args.tagIds.map(async (id) => (await ctx.db.get("tags", id))?.name));
    const name =
      args.name?.trim() ||
      `${tagNames.filter(Boolean).join(" + ") || "Everything"} · ${new Date().toISOString().slice(0, 10)}`;
    const tournamentId = await ctx.db.insert("tournaments", {
      userId,
      name,
      tagIds: args.tagIds,
      participantIds: ids,
      importedFrom: args.importFrom,
      importedCount: accepted.length,
      conflictCount: conflicts,
      status: "active",
    });
    for (const c of accepted) {
      await ctx.db.insert("comparisons", { tournamentId, a: c.a, b: c.b, result: c.result, imported: true });
    }
    await finishIfDone(ctx, (await ctx.db.get("tournaments", tournamentId))!, ids, accepted);
    return tournamentId;
  },
});

// Participants that still exist (items can be hard-deleted mid-tournament).
async function liveParticipants(ctx: QueryCtx, t: Doc<"tournaments">) {
  const exists = await Promise.all(t.participantIds.map(async (id) => (await ctx.db.get("items", id)) !== null));
  return t.participantIds.filter((_, i) => exists[i]);
}

// Takes what the caller has already read: both lists can be long.
async function finishIfDone(
  ctx: MutationCtx,
  t: Doc<"tournaments">,
  participants: Id<"items">[],
  comparisons: Comparison<Id<"items">>[],
) {
  const ranking = buildRanking(participants, comparisons);
  const done = ranking.isFinished();
  if (done && t.status === "active") {
    await ctx.db.patch("tournaments", t._id, {
      status: "completed",
      completedAt: Date.now(),
      standings: ranking.standings(),
    });
  } else if (!done && t.status === "completed") {
    await ctx.db.patch("tournaments", t._id, { status: "active", completedAt: undefined, standings: undefined });
  }
  return ranking;
}

export const record = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    a: v.id("items"),
    b: v.id("items"),
    result: resultValidator,
  },
  handler: async (ctx, { tournamentId, a, b, result }) => {
    const t = await requireOwnTournament(ctx, tournamentId);
    if (t.status !== "active") fail("tournamentOver");
    const comparisons = await comparisonsOf(ctx, tournamentId);
    const participants = await liveParticipants(ctx, t);
    const ranking = buildRanking(participants, comparisons);
    if (!ranking.has(a) || !ranking.has(b) || a === b) fail("notFound");
    // Already decided (e.g. a double click): nothing to record.
    if (ranking.relation(a, b) !== "unknown") return null;
    await ctx.db.insert("comparisons", { tournamentId, a, b, result, imported: false });
    await finishIfDone(ctx, t, participants, [...comparisons, { a, b, result }]);
    return null;
  },
});

export const undo = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    const t = await requireOwnTournament(ctx, tournamentId);
    const last = await ctx.db
      .query("comparisons")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .order("desc")
      .first();
    if (last === null || last.imported) return null;
    await ctx.db.delete("comparisons", last._id);
    await finishIfDone(ctx, t, await liveParticipants(ctx, t), await comparisonsOf(ctx, tournamentId));
    return null;
  },
});

export const rename = mutation({
  args: { tournamentId: v.id("tournaments"), name: v.string() },
  handler: async (ctx, { tournamentId, name }) => {
    await requireOwnTournament(ctx, tournamentId);
    if (!name.trim()) fail("emptyName");
    await ctx.db.patch("tournaments", tournamentId, { name: name.trim() });
    return null;
  },
});

export const remove = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, { tournamentId }) => {
    await requireOwnTournament(ctx, tournamentId);
    for (const c of await comparisonsOf(ctx, tournamentId)) await ctx.db.delete("comparisons", c._id);
    await ctx.db.delete("tournaments", tournamentId);
    return null;
  },
});
