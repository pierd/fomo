// Changes made on a device, maybe offline, sent in batches. A batch may arrive
// more than once (its answer can get lost), so every change is idempotent, and
// one that no longer makes sense is skipped: it must never block the rest.
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { buildRanking, MAX_PARTICIPANTS, type Ranking } from "./lib/ranking";
import { resultValidator } from "./schema";
import { comparisonsOf, finishIfDone, insertTournament, liveParticipants } from "./tournaments";

const MAX_OPS = 100;

// Ids are plain strings: they may be from the device (`clientId`s), or of
// things deleted since.
const opValidator = v.union(
  v.object({
    kind: v.literal("create"),
    clientId: v.string(),
    name: v.string(),
    tagIds: v.array(v.string()),
    importFrom: v.array(v.string()),
    participantIds: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("answer"),
    clientId: v.string(),
    tournament: v.string(),
    a: v.string(),
    b: v.string(),
    result: resultValidator,
    at: v.number(),
  }),
  // `target`: the answer's clientId, or the id of one that has none.
  v.object({ kind: v.literal("undo"), clientId: v.string(), tournament: v.string(), target: v.string() }),
  v.object({
    kind: v.literal("duel"),
    clientId: v.string(),
    a: v.string(),
    b: v.string(),
    result: resultValidator,
    at: v.number(),
  }),
  v.object({ kind: v.literal("undoDuel"), clientId: v.string(), target: v.string() }),
);
type Op = Infer<typeof opValidator>;

// A tournament while its changes are applied; read once per batch.
type Play = {
  doc: Doc<"tournaments">;
  participants: Id<"items">[];
  comparisons: Pick<Doc<"comparisons">, "_id" | "a" | "b" | "result" | "imported" | "clientId">[];
  ranking: Ranking<Id<"items">>;
};

export const push = mutation({
  args: { ops: v.array(opValidator) },
  handler: async (ctx, { ops }) => {
    const userId = await requireUserId(ctx);
    if (ops.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} changes per batch`);
    const created: { clientId: string; tournamentId: Id<"tournaments"> }[] = [];
    let skipped = 0;
    const plays = new Map<Id<"tournaments">, Play>();
    const playOf = async (raw: string) => {
      const doc = await findTournament(ctx, userId, raw);
      if (doc === null) return null;
      const open = plays.get(doc._id);
      if (open) return open;
      const participants = await liveParticipants(ctx, doc);
      const comparisons = await comparisonsOf(ctx, doc._id);
      const play: Play = { doc, participants, comparisons, ranking: buildRanking(participants, comparisons) };
      plays.set(doc._id, play);
      return play;
    };

    for (const op of ops) {
      switch (op.kind) {
        case "create": {
          const tournamentId = await create(ctx, userId, op);
          if (tournamentId === null) skipped++;
          else created.push({ clientId: op.clientId, tournamentId });
          break;
        }
        case "answer": {
          const play = await playOf(op.tournament);
          if (play === null) skipped++;
          else if (!(await answer(ctx, play, op))) skipped++;
          break;
        }
        case "undo": {
          const play = await playOf(op.tournament);
          const found = play?.comparisons.find((c) => c.clientId === op.target || c._id === op.target);
          if (!play || !found || found.imported) break;
          await ctx.db.delete("comparisons", found._id);
          play.comparisons = play.comparisons.filter((c) => c !== found);
          play.ranking = buildRanking(play.participants, play.comparisons);
          break;
        }
        case "duel": {
          if ((await findDuel(ctx, userId, op.clientId)) !== null) break;
          const a = await ownItem(ctx, userId, op.a);
          const b = await ownItem(ctx, userId, op.b);
          if (a === null || b === null || a === b) {
            skipped++;
            break;
          }
          await ctx.db.insert("duels", {
            userId,
            a,
            b,
            result: op.result,
            clientId: op.clientId,
            answeredAt: pastTime(op.at),
          });
          break;
        }
        case "undoDuel": {
          const duel = await findDuel(ctx, userId, op.target);
          if (duel !== null) await ctx.db.delete("duels", duel._id);
          break;
        }
      }
    }
    for (const p of plays.values()) await finishIfDone(ctx, p.doc, p.participants, p.comparisons);
    return { created, skipped };
  },
});

// A device's clock may be ahead; nothing may outrank later answers forever.
const pastTime = (at: number) => (Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now());

async function findTournament(ctx: MutationCtx, userId: Id<"users">, raw: string) {
  const id = ctx.db.normalizeId("tournaments", raw);
  const doc = id
    ? await ctx.db.get("tournaments", id)
    : await ctx.db
        .query("tournaments")
        .withIndex("by_userId_and_clientId", (q) => q.eq("userId", userId).eq("clientId", raw))
        .first();
  return doc?.userId === userId ? doc : null;
}

async function findDuel(ctx: MutationCtx, userId: Id<"users">, clientId: string) {
  return await ctx.db
    .query("duels")
    .withIndex("by_userId_and_clientId", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .first();
}

async function ownItem(ctx: MutationCtx, userId: Id<"users">, raw: string) {
  const id = ctx.db.normalizeId("items", raw);
  const item = id ? await ctx.db.get("items", id) : null;
  return item?.userId === userId ? item._id : null;
}

async function create(ctx: MutationCtx, userId: Id<"users">, op: Extract<Op, { kind: "create" }>) {
  const existing = await findTournament(ctx, userId, op.clientId);
  if (existing !== null) return existing._id;
  if (op.participantIds.length > MAX_PARTICIPANTS) return null;
  const items = await Promise.all([...new Set(op.participantIds)].map((id) => ownItem(ctx, userId, id)));
  const participantIds = items.filter((id) => id !== null);
  if (participantIds.length < 2) return null;
  const sources = await Promise.all(op.importFrom.map((id) => findTournament(ctx, userId, id)));
  const tagIds = op.tagIds.map((id) => ctx.db.normalizeId("tags", id));
  return await insertTournament(ctx, userId, {
    name: op.name.trim() || "FOMO",
    tagIds: tagIds.filter((id) => id !== null),
    importFrom: sources.flatMap((t) => (t ? [t._id] : [])),
    participantIds,
    clientId: op.clientId,
  });
}

// False if it can't count: contradicts an answer given elsewhere meanwhile, or
// its items are gone. Agreeing with what's already known is fine.
async function answer(ctx: MutationCtx, play: Play, op: Extract<Op, { kind: "answer" }>) {
  if (play.comparisons.some((c) => c.clientId === op.clientId)) return true;
  const a = ctx.db.normalizeId("items", op.a);
  const b = ctx.db.normalizeId("items", op.b);
  if (a === null || b === null || a === b || !play.ranking.has(a) || !play.ranking.has(b)) return false;
  const c = { a, b, result: op.result };
  if (play.ranking.relation(a, b) !== "unknown") return play.ranking.consistent(c);
  if (play.ranking.isFinished()) return true;
  const row = { ...c, imported: false, clientId: op.clientId };
  const _id = await ctx.db.insert("comparisons", {
    ...row,
    tournamentId: play.doc._id,
    answeredAt: pastTime(op.at),
  });
  play.comparisons.push({ ...row, _id });
  play.ranking.add(c);
  return true;
}
