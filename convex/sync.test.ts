/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { Item } from "../src/lib/types";
import { nextBatch, Outbox, toServer, type CreateOp, type Op } from "../src/lib/offline/outbox";
import { answersWithLocal, localTournament, participants, playTournament, previewLocal } from "../src/lib/offline/overlay";
import { buildRanking } from "./lib/ranking";

const modules = import.meta.glob("./**/*.ts");

async function setup(count: number) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const as = t.withIdentity({ subject: `${userId}|x` });
  const ids: Id<"items">[] = [];
  for (let i = 0; i < count; i++) ids.push(await as.mutation(api.items.create, { title: `Item ${i}`, tagNames: [], cleanup: false }));
  const start = () => as.mutation(api.tournaments.create, { tagIds: [], importFrom: [] });
  const push = (ops: Op[]) => as.mutation(api.sync.push, { ops: ops.map(toServer) });
  return { t, as, ids, start, push };
}

let n = 0;
const answer = (tournament: string, a: string, b: string, result: "a" | "b" | "draw" = "a"): Op => ({
  kind: "answer", clientId: `c${n++}`, tournament, a, b, result, at: 1000 + n,
});
const undo = (tournament: string, target: string): Op => ({ kind: "undo", clientId: `c${n++}`, tournament, target });
const duel = (a: string, b: string, at = 1000): Op => ({ kind: "duel", clientId: `c${n++}`, a, b, result: "a", at });

// Plays on the device until done, lower index first; every change it made.
function playOffline(base: Parameters<typeof playTournament>[0], id: string, order: string[]) {
  const ops: Op[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const data = playTournament(base, ops, id);
    const pair = buildRanking(data.items.map((i) => i._id), data.comparisons).nextPair(guard);
    if (!pair) return ops;
    ops.push(answer(id, pair[0], pair[1], order.indexOf(pair[0]) < order.indexOf(pair[1]) ? "a" : "b"));
  }
  throw new Error("never finished");
}

describe("sync", () => {
  it("applies a batch once, however often it's sent", async () => {
    const { as, ids, start, push } = await setup(5);
    const tid = await start();
    const ops = [answer(tid, ids[0], ids[1]), answer(tid, ids[2], ids[3]), duel(ids[0], ids[4])];
    expect(await push(ops)).toEqual({ created: [], skipped: 0 });
    expect(await push(ops)).toEqual({ created: [], skipped: 0 });
    expect((await as.query(api.tournaments.get, { tournamentId: tid })).comparisons).toHaveLength(2);
    expect(await as.query(api.duels.answers, {})).toHaveLength(3);
  });

  it("finishes and reopens a tournament as the device predicted", async () => {
    const { as, ids, start, push } = await setup(7);
    const tid = await start();
    const base = await as.query(api.tournaments.get, { tournamentId: tid });
    const ops = playOffline(base, tid, ids);
    const local = playTournament(base, ops);
    for (let rest = ops; rest.length; rest = rest.slice(nextBatch(rest, 3).length)) {
      expect((await push(nextBatch(rest, 3))).skipped).toBe(0);
    }
    let server = await as.query(api.tournaments.get, { tournamentId: tid });
    expect(server.tournament.status).toBe("completed");
    expect(local.tournament.status).toBe("completed");
    expect(server.tournament.standings).toEqual(local.tournament.standings);
    expect(server.tournament.standings!.map((s) => s.itemId)).toEqual(ids.slice(0, 4));

    const back = undo(tid, ops.at(-1)!.clientId);
    await push([back]);
    server = await as.query(api.tournaments.get, { tournamentId: tid });
    expect(server.tournament.status).toBe("active");
    expect(playTournament(local, [back]).tournament.status).toBe("active");
    // Undo, then another answer, all in one batch with the end of the game.
    await push([ops.at(-1)!, undo(tid, ops.at(-1)!.clientId)]);
    expect((await as.query(api.tournaments.get, { tournamentId: tid })).tournament.status).toBe("active");
  });

  it("undoes answers from before answers had client ids", async () => {
    const { as, ids, start, push } = await setup(5);
    const tid = await start();
    await as.mutation(api.tournaments.record, { tournamentId: tid, a: ids[0], b: ids[1], result: "a" });
    const { comparisons } = await as.query(api.tournaments.get, { tournamentId: tid });
    await push([undo(tid, comparisons[0]._id)]);
    expect((await as.query(api.tournaments.get, { tournamentId: tid })).comparisons).toEqual([]);
  });

  it("skips what no longer makes sense and applies the rest", async () => {
    const { as, ids, start, push } = await setup(6);
    const tid = await start();
    const gone = await start();
    await as.mutation(api.tournaments.remove, { tournamentId: gone });
    // Answered the other way round on another device.
    await as.mutation(api.tournaments.record, { tournamentId: tid, a: ids[1], b: ids[0], result: "a" });
    await as.mutation(api.items.remove, { itemId: ids[5] });
    const good = answer(tid, ids[2], ids[3]);
    const result = await push([
      answer(tid, ids[0], ids[1]),
      answer(tid, ids[1], ids[0]),
      answer(gone, ids[0], ids[1]),
      answer(tid, ids[2], ids[5]),
      duel(ids[0], ids[5]),
      duel("nonsense", ids[0]),
      undo(tid, "nothing"),
      { kind: "undoDuel", clientId: "u", target: "nothing" },
      { kind: "create", clientId: "local-x", name: "x", tagIds: [], importFrom: [], participantIds: [ids[5]], at: 0, imported: [], conflicts: 0 },
      good,
    ]);
    expect(result).toEqual({ created: [], skipped: 6 });
    const { comparisons } = await as.query(api.tournaments.get, { tournamentId: tid });
    expect(comparisons.map((c) => c.clientId)).toEqual([undefined, good.clientId]);
  });

  it("creates a tournament made and played offline, once", async () => {
    const { as, ids, start, push } = await setup(6);
    const source = await start();
    await push([answer(source, ids[0], ids[1])]);
    const items = (await as.query(api.items.list, {})) as Item[];
    const sourceData = await as.query(api.tournaments.get, { tournamentId: source });
    const taking = participants(items, []);
    const { accepted, conflicts } = previewLocal(taking, [sourceData]);
    expect(accepted).toHaveLength(1);
    const create: CreateOp = {
      kind: "create", clientId: "local-1", name: "Offline", tagIds: [], importFrom: [source],
      participantIds: taking, at: 5, imported: accepted, conflicts,
    };
    const local = localTournament(create, items);
    const ops = [create, ...playOffline(local, "local-1", ids)];
    const first = await push([create]);
    expect(await push([create])).toEqual(first);
    expect((await push(ops.slice(1))).skipped).toBe(0);
    const tid = first.created[0].tournamentId;
    const server = await as.query(api.tournaments.get, { tournamentId: tid });
    expect(server.tournament).toMatchObject({ name: "Offline", status: "completed", importedCount: 1 });
    expect(server.tournament.standings).toEqual(playTournament(local, ops, "local-1").tournament.standings);
    expect(await as.query(api.tournaments.list, {})).toHaveLength(2);
  });

  it("dates answers by when they were given, never in the future", async () => {
    const { as, ids, push } = await setup(2);
    await push([duel(ids[0], ids[1], 1000), duel(ids[1], ids[0], Date.now() + 1e9)]);
    const pool = await as.query(api.duels.answers, {});
    expect(pool[1].at).toBe(1000);
    expect(pool[0].at).toBeLessThan(Date.now() + 10_000);
  });

  it("never touches other accounts", async () => {
    const { t, as, ids, start, push } = await setup(4);
    const tid = await start();
    const played = answer(tid, ids[0], ids[1]);
    const dueled = duel(ids[0], ids[1]);
    await push([played, dueled]);
    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "b@example.com" }));
    const other = t.withIdentity({ subject: `${otherId}|x` });
    const result = await other.mutation(api.sync.push, {
      ops: ([
        answer(tid, ids[2], ids[3]),
        undo(tid, played.clientId),
        duel(ids[0], ids[1]),
        { kind: "undoDuel", clientId: "z", target: dueled.clientId },
        { kind: "create", clientId: "local-y", name: "x", tagIds: [], importFrom: [tid], participantIds: ids, at: 0, imported: [], conflicts: 0 },
      ] as Op[]).map(toServer),
    });
    expect(result).toEqual({ created: [], skipped: 3 });
    expect(await as.query(api.duels.answers, {})).toHaveLength(2);
    await expect(t.mutation(api.sync.push, { ops: [] })).rejects.toThrow(/notSignedIn/);
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("outbox", () => {
  it("survives a restart, is shared by tabs and is kept per account", () => {
    const storage = memoryStorage();
    const one = new Outbox("u", storage);
    const two = new Outbox("u", storage);
    one.add(duel("a", "b"));
    two.add(duel("c", "d"));
    expect(new Outbox("u", storage).get().ops).toHaveLength(2);
    expect(new Outbox("v", storage).get().ops).toEqual([]);
    const sent = two.get().ops.slice(0, 1);
    two.done(sent, []);
    one.refresh();
    expect(one.get().ops).toHaveLength(1);
  });

  it("keeps working when storage is full", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("full");
    };
    const box = new Outbox("u", storage);
    box.add(duel("a", "b"));
    box.add(duel("c", "d"));
    expect(box.get().ops).toHaveLength(2);
  });

  it("moves waiting answers to the tournament's real id", () => {
    const box = new Outbox("u", memoryStorage());
    const create: Op = {
      kind: "create", clientId: "local-1", name: "x", tagIds: [], importFrom: [], participantIds: [], at: 0, imported: [], conflicts: 0,
    };
    box.add(create);
    box.add(answer("local-1", "a", "b"));
    expect(nextBatch(box.get().ops)).toEqual([create]);
    box.done([create], [{ clientId: "local-1", tournamentId: "real" as Id<"tournaments"> }]);
    box.add(answer("local-1", "c", "d"));
    expect(box.get().ops.map((op) => op.kind === "answer" && op.tournament)).toEqual(["real", "real"]);
  });

  it("shows waiting answers in the ranking pool once, and undone ones not at all", () => {
    const [x, y] = [duel("a", "b"), duel("c", "d")];
    const gone: Op = { kind: "undoDuel", clientId: "u", target: y.clientId };
    const pool = answersWithLocal([], [x, y, gone]);
    expect(pool.map((p) => p.clientId)).toEqual([x.clientId]);
    expect(answersWithLocal(pool, [x])).toHaveLength(1);
    expect(answersWithLocal(pool, [{ kind: "undoDuel", clientId: "v", target: x.clientId }])).toEqual([]);
  });
});
