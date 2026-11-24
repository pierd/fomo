/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const signUp = async (email: string) => {
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { email });
      for (const name of ["books", "movies"]) await ctx.db.insert("tags", { userId: id, name });
      return id;
    });
    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }),
    );
    const as = t.withIdentity({ subject: `${userId}|${sessionId}` });
    const token = await as.action(api.apiTokens.create, { name: "Claude" });
    let nextId = 1;
    const rpc = async (method: string, params?: unknown, auth = token) => {
      const res = await t.fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      return { status: res.status, body: res.status === 202 ? null : await res.json() };
    };
    const call = async (name: string, args: unknown = {}) => {
      const { body } = await rpc("tools/call", { name, arguments: args });
      return body.result as {
        content: { text: string }[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape differs per tool
        structuredContent?: any;
        isError?: boolean;
      };
    };
    return { as, token, rpc, call };
  };
  return { t, signUp };
}

describe("mcp", () => {
  it("rejects requests without a valid token", async () => {
    const { t } = await setup();
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fomo_nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
  });

  it("speaks the protocol", async () => {
    const { signUp, t } = await setup();
    const { rpc, token } = await signUp("a@example.com");
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "fomo" } });
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    const list = await rpc("tools/list");
    const names = list.body.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_items", "add_items", "update_item", "delete_items", "list_tags"]),
    );
    const addItems = list.body.result.tools.find((x: { name: string }) => x.name === "add_items");
    expect(addItems.inputSchema).toMatchObject({ type: "object", required: ["items"] });
    expect((await rpc("nope")).body.error.code).toBe(-32601);
    expect((await t.fetch("/mcp", { method: "GET" })).status).toBe(405);
  });

  it("manages items as the token's owner only", async () => {
    const { signUp } = await setup();
    const alice = await signUp("alice@example.com");
    const bob = await signUp("bob@example.com");

    const added = await alice.call("add_items", {
      items: [
        { title: "Dune", creator: "Frank Herbert", tags: ["books", "Sci-Fi"], timeToFinish: "600 pages" },
        { title: "Arrival", tags: ["movies", "sci-fi"], timeToFinish: "1h 56m" },
      ],
    });
    expect(added.isError).toBeUndefined();
    const [dune, arrival] = added.structuredContent.added;

    let list = await alice.call("list_items", { tags: ["sci-fi"] });
    expect(list.structuredContent.total).toBe(2);
    list = await alice.call("list_items", { search: "herbert" });
    expect(list.structuredContent.items).toMatchObject([{ title: "Dune", pages: 600, timeToFinish: "600 pages" }]);

    const updated = await alice.call("update_item", {
      itemId: arrival.id,
      status: "done",
      addTags: ["favorites"],
      removeTags: ["sci-fi"],
      creator: "Denis Villeneuve",
    });
    expect(updated.structuredContent).toMatchObject({
      status: "done",
      creator: "Denis Villeneuve",
      tags: ["movies", "favorites"],
      timeToFinish: "1h 56m",
    });
    expect(updated.structuredContent.finishedAt).toBeTypeOf("string");

    // The web app sees the same data.
    const items = await alice.as.query(api.items.list, {});
    expect(items.find((i) => i._id === arrival.id)?.status).toBe("done");

    // Bob can't see or touch Alice's items.
    expect((await bob.call("list_items", { status: "all" })).structuredContent.total).toBe(0);
    const stolen = await bob.call("update_item", { itemId: dune.id, title: "Mine" });
    expect(stolen.isError).toBe(true);
    expect(stolen.content[0].text).toMatch(/Not found/);
    expect((await bob.call("get_item", { itemId: "garbage" })).isError).toBe(true);

    // Errors come back as tool errors the agent can read.
    const bad = await alice.call("update_item", { itemId: dune.id, timeToFinish: "a while" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/time to finish/);
    const locked = await alice.call("add_items", { items: [{ title: "x", cleanup: true }] });
    expect(locked.content[0].text).toMatch(/AI features are locked/);
    const invalid = await alice.call("add_items", { items: [] });
    expect(invalid.content[0].text).toMatch(/Invalid arguments/);

    await alice.call("rename_tag", { from: "favorites", to: "Faves" });
    const tags = await alice.call("list_tags");
    expect(tags.structuredContent.tags).toContainEqual(
      expect.objectContaining({ name: "faves", items: { active: 0, done: 1, discarded: 0 } }),
    );

    const deleted = await alice.call("delete_items", { itemIds: [dune.id] });
    expect(deleted.structuredContent.deleted).toEqual(["Dune"]);
    expect((await alice.call("get_account")).structuredContent.items).toEqual({ active: 0, done: 1, discarded: 0 });
  });

  it("leaves AI clean-up off unless asked, even with AI on", async () => {
    const { signUp, t } = await setup();
    const { call } = await signUp("a@example.com");
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      await ctx.db.patch("users", user!._id, { aiEnabled: true });
    });
    const added = await call("add_items", { items: [{ title: "Dune" }] });
    const item = await call("get_item", { itemId: added.structuredContent.added[0].id });
    expect(item.structuredContent.aiCleanup).toBeNull();
  });

  describe("covers", () => {
    afterEach(() => vi.unstubAllGlobals());
    const serve = (type: string, bytes = 2000) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { "content-type": type } })),
      );

    it("sets, replaces and removes a cover from a URL", async () => {
      const { signUp, t } = await setup();
      const alice = await signUp("alice@example.com");
      const bob = await signUp("bob@example.com");
      const added = await alice.call("add_items", { items: [{ title: "Dune" }] });
      const itemId = added.structuredContent.added[0].id;
      const covers = () => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);

      serve("image/jpeg");
      const set = await alice.call("set_cover", { itemId, imageUrl: "https://example.com/dune.jpg" });
      expect(set.isError).toBeUndefined();
      expect((await alice.call("get_item", { itemId })).structuredContent.coverUrl).toBeTypeOf("string");
      await alice.call("set_cover", { itemId, imageUrl: "https://example.com/dune2.jpg" });
      expect(await covers()).toBe(1); // the old one is deleted

      // Someone else's item: nothing is downloaded or kept.
      const stolen = await bob.call("set_cover", { itemId, imageUrl: "https://example.com/x.jpg" });
      expect(stolen.content[0].text).toMatch(/Not found/);
      expect(await covers()).toBe(1);

      serve("text/html");
      const page = await alice.call("set_cover", { itemId, imageUrl: "https://example.com/page" });
      expect(page.isError).toBe(true);
      expect((await alice.call("set_cover", { itemId, imageUrl: "file:///etc/passwd" })).isError).toBe(true);

      await alice.call("set_cover", { itemId, remove: true });
      expect((await alice.call("get_item", { itemId })).structuredContent.coverUrl).toBeNull();
      expect(await covers()).toBe(0);
    });
  });

  it("accepts the token in the URL for clients without headers", async () => {
    const { signUp, t } = await setup();
    const { token } = await signUp("a@example.com");
    const ping = (path: string) =>
      t.fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await ping(`/mcp/t/${token}`)).status).toBe(200);
    expect((await ping(`/mcp/t/${token}x`)).status).toBe(401);
    expect((await ping("/mcp")).status).toBe(401);
  });

  it("stops working once the token is revoked", async () => {
    const { signUp } = await setup();
    const { as, rpc } = await signUp("a@example.com");
    expect((await rpc("ping")).status).toBe(200);
    const [token] = await as.query(api.apiTokens.list, {});
    expect(token.lastUsedAt).toBeTypeOf("number");
    await as.mutation(api.apiTokens.revoke, { tokenId: token._id });
    expect((await rpc("ping")).status).toBe(401);
  });
});
