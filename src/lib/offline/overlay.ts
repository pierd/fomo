// What the cached server data looks like with the changes not sent yet. Same
// rules as convex/sync.ts.
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildRanking, mergeImported, type Comparison } from "../../../convex/lib/ranking";
import type { Item } from "../types";
import type { CreateOp, Op } from "./outbox";

export type TournamentData = FunctionReturnType<typeof api.tournaments.get>;
export type TournamentList = FunctionReturnType<typeof api.tournaments.list>;
export type Answers = FunctionReturnType<typeof api.duels.answers>;
type ItemId = Id<"items">;

export function playTournament(data: TournamentData, all: Op[], id: string = data.tournament._id): TournamentData {
  const ops = all.filter((op) => (op.kind === "answer" || op.kind === "undo") && op.tournament === id);
  if (ops.length === 0) return data;
  const ids = data.items.map((i) => i._id);
  let comparisons = [...data.comparisons];
  let ranking = buildRanking<ItemId>(ids, comparisons);
  let last = data.tournament.completedAt;
  for (const op of ops) {
    if (op.kind === "undo") {
      comparisons = comparisons.filter((c) => c.imported || (c.clientId !== op.target && c._id !== op.target));
      ranking = buildRanking<ItemId>(ids, comparisons);
    } else if (op.kind === "answer") {
      if (comparisons.some((c) => c.clientId === op.clientId)) continue;
      const a = op.a as ItemId;
      const b = op.b as ItemId;
      if (!ranking.has(a) || !ranking.has(b) || ranking.relation(a, b) !== "unknown" || ranking.isFinished()) continue;
      const c = { a, b, result: op.result };
      ranking.add(c);
      comparisons.push({ ...c, _id: op.clientId as Id<"comparisons">, imported: false, clientId: op.clientId });
      last = op.at;
    }
  }
  const done = ranking.isFinished();
  return {
    ...data,
    comparisons,
    tournament: {
      ...data.tournament,
      status: done ? "completed" : "active",
      completedAt: done ? last : undefined,
      standings: done ? ranking.standings() : undefined,
    },
  };
}

// A tournament made here that the server doesn't have yet.
export function localTournament(op: CreateOp, items: Item[]): TournamentData {
  const byId = new Map<string, Item>(items.map((i) => [i._id, i]));
  const taking = op.participantIds.flatMap((id) => byId.get(id) ?? []);
  return {
    tournament: {
      _id: op.clientId as Id<"tournaments">,
      _creationTime: op.at,
      userId: (taking[0]?.userId ?? "") as Id<"users">,
      name: op.name,
      tagIds: op.tagIds as Id<"tags">[],
      participantIds: op.participantIds as ItemId[],
      importedFrom: op.importFrom as Id<"tournaments">[],
      importedCount: op.imported.length,
      conflictCount: op.conflicts,
      status: buildRanking<ItemId>(taking.map((i) => i._id), op.imported).isFinished() ? "completed" : "active",
      clientId: op.clientId,
    },
    items: taking.map(({ _id, title, creator, year, durationMinutes, status, coverUrl }) => ({
      _id,
      title,
      creator,
      year,
      durationMinutes,
      status,
      coverUrl,
    })),
    comparisons: op.imported.map((c, i) => ({
      ...c,
      _id: `${op.clientId}-${i}` as Id<"comparisons">,
      imported: true,
      clientId: undefined,
    })),
  };
}

export function listWithLocal(list: TournamentList, ops: Op[]): TournamentList {
  const local = ops
    .filter((op) => op.kind === "create")
    .filter((op) => !list.some((x) => x.clientId === op.clientId))
    .map((op) => ({
      _id: op.clientId as Id<"tournaments">,
      _creationTime: op.at,
      name: op.name,
      status: "active" as const,
      completedAt: undefined,
      participantCount: op.participantIds.length,
      tagIds: op.tagIds as Id<"tags">[],
      top: [],
      clientId: op.clientId,
    }));
  return [...local.reverse(), ...list];
}

// The pool of answers behind the ranking.
export function answersWithLocal(answers: Answers, ops: Op[]): Answers {
  if (ops.length === 0) return answers;
  const undone = new Set(ops.flatMap((op) => (op.kind === "undo" || op.kind === "undoDuel" ? [op.target] : [])));
  const known = new Set(answers.flatMap((a) => a.clientId ?? []));
  const added = ops.flatMap((op) =>
    (op.kind === "answer" || op.kind === "duel") && !known.has(op.clientId) && !undone.has(op.clientId)
      ? [{ a: op.a as ItemId, b: op.b as ItemId, result: op.result, at: op.at, clientId: op.clientId }]
      : [],
  );
  return [...added.reverse(), ...answers.filter((a) => !a.clientId || !undone.has(a.clientId))];
}

// Who takes part, and what earlier results are worth, without the server.
export function participants(items: Item[], tagIds: Id<"tags">[]): ItemId[] {
  return items
    .filter((i) => i.status === "active" && tagIds.every((id) => i.tagIds.includes(id)))
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((i) => i._id);
}

export function previewLocal(ids: ItemId[], sources: TournamentData[]) {
  const all: Comparison<ItemId>[] = sources.flatMap((s) =>
    s.comparisons.map(({ a, b, result }) => ({ a, b, result })),
  );
  return mergeImported(ids, all);
}
