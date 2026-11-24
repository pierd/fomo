/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email: "a@example.com" });
    for (const name of ["books", "movies", "fiction"]) await ctx.db.insert("tags", { userId: id, name });
    return id;
  });
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }),
  );
  return { t, as: t.withIdentity({ subject: `${userId}|${sessionId}` }), userId };
}

describe("flows", () => {
  it("adds, filters and finishes items", async () => {
    const { as } = await setup();
    const id = await as.mutation(api.items.create, {
      title: "Crime and Punishment",
      tagNames: ["books", "Russian Classics"],
      duration: "540 pages",
      cleanup: false,
    });
    const tags = await as.query(api.tags.list, {});
    expect(tags.map((t) => t.name)).toContain("russian classics");
    let items = await as.query(api.items.list, {});
    expect(items[0]).toMatchObject({ durationMode: "pages", pages: 540, status: "active" });
    await expect(
      as.mutation(api.items.create, { title: "x", tagNames: [], cleanup: true }),
    ).rejects.toThrow(/aiLocked/);
    await as.mutation(api.items.setStatus, { itemId: id, status: "done" });
    items = await as.query(api.items.list, {});
    expect(items[0].finishedAt).toBeTypeOf("number");
  });

  it("runs a tournament to completion and imports results", async () => {
    const { as } = await setup();
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await as.mutation(api.items.create, { title: `Item ${i}`, tagNames: ["movies"], cleanup: false }));
    }
    const tags = await as.query(api.tags.list, {});
    const movies = tags.find((t) => t.name === "movies")!._id;
    const tid = await as.mutation(api.tournaments.create, { tagIds: [movies], importFrom: [] });
    const { buildRanking, hashString } = await import("./lib/ranking");
    // Lower index wins.
    for (let guard = 0; guard < 100; guard++) {
      const data = (await as.query(api.tournaments.get, { tournamentId: tid }))!;
      if (data.tournament.status === "completed") break;
      const r = buildRanking(data.items.map((i) => i._id), data.comparisons);
      const pair = r.nextPair(hashString(tid) + data.comparisons.length)!;
      const [a, b] = pair;
      await as.mutation(api.tournaments.record, {
        tournamentId: tid,
        a,
        b,
        result: ids.indexOf(a) < ids.indexOf(b) ? "a" : "b",
      });
    }
    const done = (await as.query(api.tournaments.get, { tournamentId: tid }))!;
    expect(done.tournament.status).toBe("completed");
    expect(done.tournament.standings!.map((s) => s.itemId)).toEqual(ids.slice(0, 4));

    const preview = await as.query(api.tournaments.preview, { tagIds: [movies], importFrom: [tid] });
    expect(preview.imported).toBe(done.comparisons.length);
    const t2 = await as.mutation(api.tournaments.create, { tagIds: [movies], importFrom: [tid] });
    const second = (await as.query(api.tournaments.get, { tournamentId: t2 }))!;
    expect(second.tournament.status).toBe("completed");
  });

  it("pools answers from tournaments and duels, without imported copies", async () => {
    const { t, as } = await setup();
    const add = (title: string) => as.mutation(api.items.create, { title, tagNames: [], cleanup: false });
    const [a, b] = [await add("A"), await add("B")];
    const t1 = await as.mutation(api.tournaments.create, { tagIds: [], importFrom: [] });
    await as.mutation(api.tournaments.record, { tournamentId: t1, a, b, result: "a" });
    await as.mutation(api.tournaments.create, { tagIds: [], importFrom: [t1] });
    expect(await as.query(api.duels.answers, {})).toHaveLength(1);

    const duelId = await as.mutation(api.duels.record, { a: b, b: a, result: "a" });
    const pool = await as.query(api.duels.answers, {});
    expect(pool).toHaveLength(2);
    expect(pool[0]).toMatchObject({ a: b, b: a, result: "a" });
    await as.mutation(api.duels.remove, { duelId });

    // With the original gone, the imported copy still counts, as the oldest.
    await as.mutation(api.tournaments.remove, { tournamentId: t1 });
    expect(await as.query(api.duels.answers, {})).toMatchObject([{ at: 0 }]);

    // Other users can't see, add to or undo someone's duels.
    const mine = await as.mutation(api.duels.record, { a, b, result: "draw" });
    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "b@example.com" }));
    const other = t.withIdentity({ subject: `${otherId}|x` });
    expect(await other.query(api.duels.answers, {})).toEqual([]);
    await expect(other.mutation(api.duels.record, { a, b, result: "a" })).rejects.toThrow(/notFound/);
    await expect(other.mutation(api.duels.remove, { duelId: mine })).rejects.toThrow(/notFound/);
  });

  it("commits imports", async () => {
    const { as } = await setup();
    await as.mutation(api.imports.commit, {
      items: [
        { title: "Dune", creator: "Frank Herbert", tagNames: ["books", "sci-fi"], status: "active", pages: 600, durationMinutes: 1080, addedAt: 1600000000000 },
        { title: "Heat", tagNames: ["movies"], status: "done", addedAt: 1600000000000, finishedAt: 1610000000000 },
      ],
      fetchCovers: false,
      estimateWithAi: true,
    });
    const items = await as.query(api.items.list, {});
    expect(items).toHaveLength(2);
    const heat = items.find((i) => i.title === "Heat")!;
    // AI is locked for this user: no estimate scheduled.
    expect(heat.durationMode).toBe("unset");
    expect(heat.finishedAt).toBe(1610000000000);
  });
});
