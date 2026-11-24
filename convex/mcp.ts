import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { statusValidator } from "./schema";
import { canUseAi } from "./lib/auth";
import { durationToInput } from "./lib/duration";
import { fail } from "./lib/errors";
import { normalizeTag } from "./lib/tags";
import { deleteItem, insertItem, patchItem, replaceCover, setItemStatus } from "./items";
import { downloadImage } from "./lib/covers";
import { ensureTags, renameTag } from "./tags";
import { hashToken } from "./apiTokens";
import { defineTool, handleBody, type ServerInfo, type Tool } from "./lib/mcpProtocol";

// MCP server at <CONVEX_SITE_URL>/mcp, so agents can manage someone's list.
// Requests carry a personal token (`Authorization: Bearer fomo_...`, made on
// the Agents page). Everything below runs as the token's owner: the user id
// always comes from the token, never from the agent.

const MAX_ITEMS = 5000;
const MAX_TAGS = 1000;

// --- Data access, scoped to the token's user ---

async function tagNamesById(ctx: QueryCtx, userId: Id<"users">) {
  const tags = await ctx.db
    .query("tags")
    .withIndex("by_userId_and_name", (q) => q.eq("userId", userId))
    .take(MAX_TAGS);
  return new Map(tags.map((t) => [t._id, t.name]));
}

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

function present(item: Doc<"items">, tags: Map<Id<"tags">, string>) {
  return {
    id: item._id,
    title: item.title,
    creator: item.creator ?? null,
    year: item.year ?? null,
    tags: item.tagIds.flatMap((id) => {
      const name = tags.get(id);
      return name ? [name] : [];
    }),
    status: item.status,
    timeToFinish: durationToInput(item) || null,
    durationMinutes: item.durationMinutes ?? null,
    pages: item.pages ?? null,
    description: item.description ?? null,
    sourceUrl: item.sourceUrl ?? null,
    addedAt: iso(item.addedAt),
    finishedAt: iso(item.finishedAt),
    aiCleanup: item.aiStatus ?? null,
  };
}

async function ownItem(ctx: QueryCtx, userId: Id<"users">, rawId: string) {
  const itemId = ctx.db.normalizeId("items", rawId);
  const item = itemId ? await ctx.db.get("items", itemId) : null;
  if (item === null || item.userId !== userId) fail("notFound", { what: `item ${rawId}` });
  return item;
}

const statusFilter = v.union(statusValidator, v.literal("all"));

export const listItems = internalQuery({
  args: {
    userId: v.id("users"),
    status: statusFilter,
    tags: v.array(v.string()),
    search: v.optional(v.string()),
    limit: v.number(),
    offset: v.number(),
  },
  handler: async (ctx, { userId, status, tags, search, limit, offset }) => {
    const tagNames = await tagNamesById(ctx, userId);
    const items =
      status === "all"
        ? await ctx.db
            .query("items")
            .withIndex("by_userId_and_addedAt", (q) => q.eq("userId", userId))
            .order("desc")
            .take(MAX_ITEMS)
        : await ctx.db
            .query("items")
            .withIndex("by_userId_and_status_and_addedAt", (q) => q.eq("userId", userId).eq("status", status))
            .order("desc")
            .take(MAX_ITEMS);
    const wanted = tags.map(normalizeTag).filter(Boolean);
    const needle = search?.trim().toLowerCase();
    const matches = items
      .map((item) => present(item, tagNames))
      .filter(
        (item) =>
          wanted.every((t) => item.tags.includes(t)) &&
          (!needle ||
            item.title.toLowerCase().includes(needle) ||
            (item.creator?.toLowerCase().includes(needle) ?? false) ||
            (item.description?.toLowerCase().includes(needle) ?? false)),
      );
    return { total: matches.length, offset, items: matches.slice(offset, offset + limit) };
  },
});

export const getItem = internalQuery({
  args: { userId: v.id("users"), itemId: v.string() },
  handler: async (ctx, { userId, itemId }) => {
    const item = await ownItem(ctx, userId, itemId);
    return {
      ...present(item, await tagNamesById(ctx, userId)),
      coverUrl: item.coverStorageId ? await ctx.storage.getUrl(item.coverStorageId) : null,
    };
  },
});

const newItemValidator = v.object({
  title: v.string(),
  creator: v.optional(v.string()),
  tags: v.array(v.string()),
  description: v.optional(v.string()),
  timeToFinish: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  status: v.optional(statusValidator),
  cleanup: v.optional(v.boolean()),
});

export const addItems = internalMutation({
  args: { userId: v.id("users"), items: v.array(newItemValidator) },
  handler: async (ctx, { userId, items }) => {
    const ids: Id<"items">[] = [];
    for (const item of items) {
      const id = await insertItem(ctx, userId, {
        title: item.title,
        creator: item.creator,
        tagNames: item.tags,
        description: item.description,
        duration: item.timeToFinish,
        sourceUrl: item.sourceUrl,
        // Agents usually send tidy data already; clean-up is opt-in.
        cleanup: item.cleanup ?? false,
      });
      if (item.status && item.status !== "active") await setItemStatus(ctx, id, item.status);
      ids.push(id);
    }
    return ids;
  },
});

async function tagIdsByName(ctx: MutationCtx, userId: Id<"users">, names: string[]) {
  const ids = new Set<Id<"tags">>();
  for (const raw of names) {
    const name = normalizeTag(raw);
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (tag) ids.add(tag._id);
  }
  return ids;
}

export const updateItem = internalMutation({
  args: {
    userId: v.id("users"),
    itemId: v.string(),
    title: v.optional(v.string()),
    creator: v.optional(v.string()),
    description: v.optional(v.string()),
    timeToFinish: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    addTags: v.optional(v.array(v.string())),
    removeTags: v.optional(v.array(v.string())),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const item = await ownItem(ctx, args.userId, args.itemId);
    let tagIds: Id<"tags">[] | undefined;
    if (args.tags || args.addTags || args.removeTags) {
      const base = args.tags ? await ensureTags(ctx, item.userId, args.tags) : item.tagIds;
      const added = args.addTags ? await ensureTags(ctx, item.userId, args.addTags) : [];
      const removed = await tagIdsByName(ctx, item.userId, args.removeTags ?? []);
      tagIds = [...new Set([...base, ...added])].filter((id) => !removed.has(id));
    }
    await patchItem(ctx, item, {
      title: args.title,
      creator: args.creator,
      description: args.description,
      duration: args.timeToFinish,
      sourceUrl: args.sourceUrl,
      tagIds,
    });
    if (args.status && args.status !== item.status) await setItemStatus(ctx, item._id, args.status);
    const updated = await ctx.db.get("items", item._id);
    return present(updated!, await tagNamesById(ctx, args.userId));
  },
});

// storageId null removes the cover. A new file is deleted again if the item
// isn't the user's.
export const setCover = internalMutation({
  args: { userId: v.id("users"), itemId: v.string(), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { userId, itemId, storageId }) => {
    const id = ctx.db.normalizeId("items", itemId);
    const item = id ? await ctx.db.get("items", id) : null;
    if (item === null || item.userId !== userId) {
      if (storageId) await ctx.storage.delete(storageId);
      fail("notFound", { what: `item ${itemId}` });
    }
    await replaceCover(ctx, item, storageId ?? undefined);
    return storageId ? await ctx.storage.getUrl(storageId) : null;
  },
});

export const deleteItems = internalMutation({
  args: { userId: v.id("users"), itemIds: v.array(v.string()) },
  handler: async (ctx, { userId, itemIds }) => {
    const deleted: string[] = [];
    for (const rawId of itemIds) {
      const item = await ownItem(ctx, userId, rawId);
      await deleteItem(ctx, item);
      deleted.push(item.title);
    }
    return deleted;
  },
});

export const listTags = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tags = await tagNamesById(ctx, userId);
    const counts = new Map<Id<"tags">, { active: number; done: number; discarded: number }>();
    const items = await ctx.db
      .query("items")
      .withIndex("by_userId_and_addedAt", (q) => q.eq("userId", userId))
      .take(MAX_ITEMS);
    for (const item of items) {
      for (const id of item.tagIds) {
        const c = counts.get(id) ?? { active: 0, done: 0, discarded: 0 };
        c[item.status]++;
        counts.set(id, c);
      }
    }
    return [...tags].map(([id, name]) => ({
      id,
      name,
      items: counts.get(id) ?? { active: 0, done: 0, discarded: 0 },
    }));
  },
});

export const renameTagByName = internalMutation({
  args: { userId: v.id("users"), from: v.string(), to: v.string() },
  handler: async (ctx, { userId, from, to }) => {
    const name = normalizeTag(from);
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (tag === null) fail("notFound", { what: `tag "${name}"` });
    return await renameTag(ctx, userId, tag._id, to);
  },
});

export const account = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    const counts = { active: 0, done: 0, discarded: 0 };
    const items = await ctx.db
      .query("items")
      .withIndex("by_userId_and_addedAt", (q) => q.eq("userId", userId))
      .take(MAX_ITEMS);
    for (const item of items) counts[item.status]++;
    return {
      email: user?.email ?? null,
      language: user?.locale ?? "en",
      aiEnabled: await canUseAi(ctx, userId),
      items: counts,
    };
  },
});

// --- Tools ---

type ToolCtx = { ctx: ActionCtx; userId: Id<"users"> };

const json = (data: unknown) => JSON.stringify(data, null, 2);

const status = z.enum(["active", "done", "discarded"]);
const itemId = z.string().min(1).describe("Item id, as returned by list_items.");
const timeToFinish = z
  .string()
  .describe(
    'Time to finish: "2h 30m", "142 min", "2:30", "320 pages", "n/a" (not applicable), "?" (let AI estimate it, if enabled) or "" (unknown).',
  );

const tools: Tool<ToolCtx>[] = [
  defineTool({
    name: "get_account",
    title: "Account overview",
    description: "Who the list belongs to, its language, whether AI features are on, and item counts by status.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: async ({ ctx, userId }: ToolCtx) => {
      const data = await ctx.runQuery(internal.mcp.account, { userId });
      return { text: json(data), data };
    },
  }),
  defineTool({
    name: "list_items",
    title: "List items",
    description:
      'List items on the FOMO list (books, movies, series, games, podcasts...), newest first. Status "active" means still to do. Filter by status, tags (all must match) and a text search over title, creator and notes.',
    input: z.object({
      status: z.enum(["active", "done", "discarded", "all"]).default("active"),
      tags: z.array(z.string()).default([]).describe("Only items that have all of these tags."),
      search: z.string().optional().describe("Case-insensitive text to look for in title, creator and notes."),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    annotations: { readOnlyHint: true },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const data = await ctx.runQuery(internal.mcp.listItems, { userId, ...args });
      const more = data.offset + data.items.length < data.total;
      return {
        text: json(data) + (more ? `\n\n${data.total - data.offset - data.items.length} more: raise offset.` : ""),
        data,
      };
    },
  }),
  defineTool({
    name: "get_item",
    title: "Get item",
    description: "Full details of one item, including its cover image URL.",
    input: z.object({ itemId }),
    annotations: { readOnlyHint: true },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const data = await ctx.runQuery(internal.mcp.getItem, { userId, ...args });
      return { text: json(data), data };
    },
  }),
  defineTool({
    name: "add_items",
    title: "Add items",
    description:
      "Add one or more items to the list. Check with list_items first to avoid duplicates. Tags are free-form (lowercased) and created if missing; prefer the existing ones from list_tags. Send clean data (canonical title, creator, time to finish). Set cleanup: true only if you couldn't: FOMO then tidies the title and fills creator, year, time to finish, tags and a cover in the background (needs AI on the account, see get_account).",
    input: z.object({
      items: z
        .array(
          z.object({
            title: z.string().min(1).describe("Title of the work, without the creator."),
            creator: z.string().optional().describe("Author, director, studio..."),
            tags: z.array(z.string()).default([]),
            description: z.string().optional().describe("Notes, e.g. who recommended it."),
            timeToFinish: timeToFinish.optional(),
            sourceUrl: z.string().optional().describe("A page about it (Goodreads, Letterboxd...), used for the cover."),
            status: status.optional().describe('Defaults to "active" (to do).'),
            cleanup: z.boolean().optional().describe("AI clean-up and cover lookup; off by default."),
          }),
        )
        .min(1)
        .max(100),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const ids = await ctx.runMutation(internal.mcp.addItems, { userId, items: args.items });
      const data = { added: ids.map((id, i) => ({ id, title: args.items[i].title })) };
      return { text: json(data), data };
    },
  }),
  defineTool({
    name: "update_item",
    title: "Update item",
    description:
      'Change an item: only the fields given change; pass "" to clear a text field. Set status to "done" when finished, "discarded" when no longer wanted, "active" to put it back on the list. Use tags to replace all tags, or addTags/removeTags.',
    input: z.object({
      itemId,
      title: z.string().min(1).optional(),
      creator: z.string().optional(),
      description: z.string().optional(),
      timeToFinish: timeToFinish.optional(),
      sourceUrl: z.string().optional(),
      status: status.optional(),
      tags: z.array(z.string()).optional(),
      addTags: z.array(z.string()).optional(),
      removeTags: z.array(z.string()).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const data = await ctx.runMutation(internal.mcp.updateItem, { userId, ...args });
      return { text: json(data), data };
    },
  }),
  defineTool({
    name: "set_cover",
    title: "Set cover image",
    description:
      "Replace an item's cover with the image at imageUrl (a direct link to a JPEG, PNG or WebP, up to 5 MB; FOMO downloads and keeps a copy), or remove the cover with remove: true. Prefer official covers or posters, e.g. from Open Library, Wikipedia or the publisher.",
    input: z.object({
      itemId,
      imageUrl: z.url({ protocol: /^https?$/ }).optional().describe("Direct http(s) link to the image."),
      remove: z.boolean().optional().describe("Remove the current cover instead."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      if (args.remove) {
        if (args.imageUrl) return { text: "Give either imageUrl or remove, not both.", isError: true };
        await ctx.runMutation(internal.mcp.setCover, { userId, itemId: args.itemId, storageId: null });
        return { text: "Cover removed.", data: { coverUrl: null } };
      }
      if (!args.imageUrl) return { text: "Give imageUrl, or remove: true.", isError: true };
      // Check ownership before downloading anything.
      await ctx.runQuery(internal.mcp.getItem, { userId, itemId: args.itemId });
      const blob = await downloadImage(args.imageUrl);
      if (!blob) {
        return {
          text: "Couldn't get an image from that URL. It must answer with an image (not a web page), between 1 KB and 5 MB.",
          isError: true,
        };
      }
      const storageId = await ctx.storage.store(blob);
      const coverUrl = await ctx.runMutation(internal.mcp.setCover, { userId, itemId: args.itemId, storageId });
      return { text: `Cover set: ${coverUrl}`, data: { coverUrl } };
    },
  }),
  defineTool({
    name: "delete_items",
    title: "Delete items",
    description:
      'Permanently delete items. To keep history, prefer update_item with status "done" or "discarded". Confirm with the user first.',
    input: z.object({ itemIds: z.array(itemId).min(1).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const deleted = await ctx.runMutation(internal.mcp.deleteItems, { userId, ...args });
      return { text: `Deleted ${deleted.length}: ${deleted.join(", ")}`, data: { deleted } };
    },
  }),
  defineTool({
    name: "list_tags",
    title: "List tags",
    description: "All tags with how many active, done and discarded items have each.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: async ({ ctx, userId }: ToolCtx) => {
      const tags = await ctx.runQuery(internal.mcp.listTags, { userId });
      return { text: json(tags), data: { tags } };
    },
  }),
  defineTool({
    name: "rename_tag",
    title: "Rename tag",
    description: "Rename a tag on every item that has it.",
    input: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async ({ ctx, userId }: ToolCtx, args) => {
      const name = await ctx.runMutation(internal.mcp.renameTagByName, { userId, ...args });
      return { text: `Renamed to "${name}".`, data: { name } };
    },
  }),
];

const SERVER: ServerInfo = {
  name: "fomo",
  title: "FOMO",
  version: "1.0.0",
  instructions:
    "FOMO is a personal list of things to read, watch, play and listen to. Items have a status: active (to do), done or discarded. Use list_tags to learn the user's tags before tagging, and search with list_items before adding to avoid duplicates. Prefer marking items done/discarded over deleting them.",
};

const ERROR_TEXT: Record<string, string> = {
  notFound: "Not found",
  aiLocked: "AI features are locked for this account; an admin can unlock them. Retry with cleanup: false.",
  emptyName: "The name can't be empty.",
  badDuration: "Can't read that time to finish. Use e.g. \"2h 30m\", \"320 pages\", \"n/a\" or \"?\".",
  tagExists: "A tag with that name already exists.",
};

function describeError(e: unknown) {
  if (e instanceof ConvexError && typeof e.data === "object" && e.data !== null) {
    const data = e.data as Record<string, unknown>;
    const code = String(data.code);
    const text = ERROR_TEXT[code] ?? code;
    const detail = Object.entries(data)
      .filter(([k]) => k !== "code")
      .map(([k, val]) => `${k}: ${String(val)}`)
      .join(", ");
    return detail ? `${text} (${detail})` : text;
  }
  console.error(e);
  return "Internal error";
}

// --- HTTP ---

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  });
}

// Touching lastUsedAt on every call would mean a write per request.
const TOUCH_EVERY_MS = 60 * 60 * 1000;

// The token comes in the Authorization header or, for clients that can't send
// headers (ChatGPT, claude.ai connectors), in the URL: /mcp/t/<token>.
function presentedToken(req: Request) {
  const header = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (header) return header[1];
  const path = new URL(req.url).pathname.match(/^\/mcp\/t\/([A-Za-z0-9_-]+)\/?$/);
  return path?.[1] ?? null;
}

async function authenticate(ctx: ActionCtx, req: Request) {
  const presented = presentedToken(req);
  if (!presented) return null;
  const token = await ctx.runQuery(internal.apiTokens.byHash, { tokenHash: await hashToken(presented) });
  if (token === null) return null;
  if (token.lastUsedAt === null || Date.now() - token.lastUsedAt > TOUCH_EVERY_MS) {
    await ctx.runMutation(internal.apiTokens.touch, { tokenId: token.tokenId });
  }
  return token.userId;
}

export const post = httpAction(async (ctx, req) => {
  const userId = await authenticate(ctx, req);
  if (userId === null) {
    return respond(
      401,
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or invalid token. Create one on the FOMO Agents page." } },
      { "WWW-Authenticate": 'Bearer realm="fomo"' },
    );
  }
  const { status, json: body } = await handleBody(await req.text(), { ctx, userId }, SERVER, tools, describeError);
  return respond(status, body);
});

// No server-initiated stream and no sessions: GET and DELETE aren't offered.
export const notAllowed = httpAction(async () => respond(405, undefined, { Allow: "POST, OPTIONS" }));

export const preflight = httpAction(async () => respond(204));
