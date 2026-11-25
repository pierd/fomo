/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup(count: number) {
  // Scheduled jobs stay queued: the tests run them by hand.
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com", aiEnabled: true }));
  const as = t.withIdentity({ subject: `${userId}|x` });
  await as.mutation(api.imports.commit, {
    items: Array.from({ length: count }, (_, i) => ({ title: `Item ${i}`, tagNames: [], status: "active" as const })),
    fetchCovers: true,
    estimateWithAi: true,
    startDelayMs: 1000,
  });
  const items = await as.query(api.items.list, {});
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return { t, as, items, jobs };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("import batches", () => {
  it("schedules one job per batch, covering every item once", async () => {
    const { items, jobs } = await setup(60);
    const covers = jobs.filter((j) => j.name.includes("fetchCovers"));
    const estimates = jobs.filter((j) => j.name.includes("estimateItems"));
    expect(covers.map((j) => j.args[0].jobs.length)).toEqual([25, 25, 10]);
    expect(estimates.map((j) => j.args[0].itemIds.length)).toEqual([25, 25, 10]);
    expect(jobs).toHaveLength(6);
    const ids = items.map((i) => i._id).sort();
    expect(covers.flatMap((j) => j.args[0].jobs.map((x: { itemId: string }) => x.itemId)).sort()).toEqual(ids);
    expect(estimates.flatMap((j) => j.args[0].itemIds).sort()).toEqual(ids);
    expect(covers[1].scheduledTime - covers[0].scheduledTime).toBe(25 * 1500);
  });

  it("saves the covers it finds when one download fails", async () => {
    const { t, as, items } = await setup(2);
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("good")
        ? new Response(new Uint8Array(2000), { headers: { "content-type": "image/png" } })
        : Promise.reject(new Error("down")),
    );
    vi.useRealTimers();
    await t.action(internal.covers.fetchCovers, {
      jobs: items.map((item, i) => ({
        itemId: item._id,
        hints: { title: item.title, coverUrl: i === 0 ? "https://x.test/bad" : "https://x.test/good" },
      })),
    });
    const after = await as.query(api.items.list, {});
    const covered = after.filter((i) => i.coverStorageId).map((i) => i._id);
    expect(covered).toEqual([items[1]._id]);
  });

  it("keeps a cover chosen meanwhile, and drops files of deleted items", async () => {
    const { t, as, items } = await setup(2);
    const store = () => t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    const mine = await store();
    await as.mutation(api.items.setCover, { itemId: items[0]._id, storageId: mine });
    await as.mutation(api.items.remove, { itemId: items[1]._id });
    await t.mutation(internal.items.storeCovers, {
      covers: [
        { itemId: items[0]._id, storageId: await store() },
        { itemId: items[1]._id, storageId: await store() },
      ],
    });
    const [left] = await as.query(api.items.list, {});
    expect(left.coverStorageId).toBe(mine);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
  });

  it("saves estimates and failures, without overwriting a time given meanwhile", async () => {
    const { t, as, items } = await setup(4);
    const [a, b, c, d] = items.map((i) => i._id);
    await as.mutation(api.items.update, { itemId: b, title: "B", tagNames: [], duration: "10 min" });
    await as.mutation(api.items.remove, { itemId: d });
    await t.mutation(internal.items.saveEstimates, {
      results: [
        { itemId: a, durationMinutes: 99.6, pages: 100 },
        { itemId: b, durationMinutes: 99 },
        { itemId: c, error: "nope" },
        { itemId: d, durationMinutes: 99 },
      ],
    });
    const after = new Map((await as.query(api.items.list, {})).map((i) => [i._id, i]));
    expect(after.get(a)).toMatchObject({ aiStatus: "done", durationMinutes: 100, durationMode: "minutes", pages: 100 });
    expect(after.get(b)).toMatchObject({ aiStatus: "done", durationMinutes: 10 });
    expect(after.get(c)).toMatchObject({ aiStatus: "failed", aiError: "nope" });
  });
});
