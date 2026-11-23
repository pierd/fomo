import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { canUseAi, requireOwnItem, requireUserId } from "./lib/auth";
import { parseDuration } from "./lib/duration";
import { ensureTags } from "./tags";
import { statusValidator } from "./schema";
import { fail } from "./lib/errors";

const MAX_ITEMS = 5000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("items")
      .withIndex("by_userId_and_addedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_ITEMS);
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        coverUrl: item.coverStorageId ? await ctx.storage.getUrl(item.coverStorageId) : null,
      })),
    );
  },
});

const durationFields = (raw: string | undefined) => {
  if (raw === undefined) return {};
  const d = parseDuration(raw);
  if (d === null) fail("badDuration", { value: raw });
  switch (d.mode) {
    case "minutes":
      return { durationMode: d.mode, durationMinutes: d.minutes, pages: undefined };
    case "pages":
      return { durationMode: d.mode, durationMinutes: d.minutes, pages: d.pages };
    default:
      return { durationMode: d.mode, durationMinutes: undefined, pages: undefined };
  }
};

export const create = mutation({
  args: {
    title: v.string(),
    creator: v.optional(v.string()),
    tagNames: v.array(v.string()),
    description: v.optional(v.string()),
    duration: v.optional(v.string()),
    cleanup: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const title = args.title.trim();
    if (!title) fail("emptyName");
    const ai = await canUseAi(ctx, userId);
    if (args.cleanup && !ai) fail("aiLocked");
    const duration = durationFields(args.duration);
    const itemId = await ctx.db.insert("items", {
      userId,
      title,
      creator: args.creator?.trim() || undefined,
      tagIds: await ensureTags(ctx, userId, args.tagNames),
      description: args.description?.trim() || undefined,
      durationMode: "unset",
      ...duration,
      status: "active",
      addedAt: Date.now(),
    });
    if (args.cleanup || (ai && duration.durationMode === "auto")) {
      await startCleanup(ctx, itemId, args.cleanup);
    }
    return itemId;
  },
});

async function startCleanup(ctx: MutationCtx, itemId: Id<"items">, full: boolean) {
  await ctx.db.patch("items", itemId, { aiStatus: "pending", aiError: undefined });
  await ctx.scheduler.runAfter(0, internal.ai.cleanupItem, { itemId, full });
}

export const update = mutation({
  args: {
    itemId: v.id("items"),
    title: v.string(),
    creator: v.optional(v.string()),
    tagNames: v.array(v.string()),
    description: v.optional(v.string()),
    duration: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await requireOwnItem(ctx, args.itemId);
    const title = args.title.trim();
    if (!title) fail("emptyName");
    const duration = durationFields(args.duration);
    await ctx.db.patch("items", item._id, {
      title,
      creator: args.creator?.trim() || undefined,
      tagIds: await ensureTags(ctx, item.userId, args.tagNames),
      description: args.description?.trim() || undefined,
      sourceUrl: args.sourceUrl?.trim() || undefined,
      ...duration,
    });
    if (duration.durationMode === "auto" && (await canUseAi(ctx, item.userId))) {
      await startCleanup(ctx, item._id, false);
    }
    return null;
  },
});

export const cleanup = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await requireOwnItem(ctx, itemId);
    if (!(await canUseAi(ctx, item.userId))) fail("aiLocked");
    await startCleanup(ctx, itemId, true);
    return null;
  },
});

export const setStatus = mutation({
  args: { itemId: v.id("items"), status: statusValidator },
  handler: async (ctx, { itemId, status }) => {
    await requireOwnItem(ctx, itemId);
    await ctx.db.patch("items", itemId, {
      status,
      finishedAt: status === "active" ? undefined : Date.now(),
    });
    return null;
  },
});

export const setCover = mutation({
  args: { itemId: v.id("items"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { itemId, storageId }) => {
    const item = await requireOwnItem(ctx, itemId);
    await replaceCover(ctx, item, storageId ?? undefined);
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

async function replaceCover(ctx: MutationCtx, item: Doc<"items">, storageId: Id<"_storage"> | undefined) {
  if (item.coverStorageId && item.coverStorageId !== storageId) {
    await ctx.storage.delete(item.coverStorageId);
  }
  await ctx.db.patch("items", item._id, { coverStorageId: storageId });
}

export const remove = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await requireOwnItem(ctx, itemId);
    if (item.coverStorageId) await ctx.storage.delete(item.coverStorageId);
    await ctx.db.delete("items", itemId);
    return null;
  },
});

// --- Internal: used by AI cleanup and cover fetching ---

export const getInternal = internalQuery({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get("items", itemId);
    if (item === null) return null;
    const tags = await Promise.all(item.tagIds.map((id) => ctx.db.get("tags", id)));
    const user = await ctx.db.get("users", item.userId);
    return { ...item, tagNames: tags.flatMap((t) => (t ? [t.name] : [])), locale: user?.locale ?? "en" };
  },
});

export const applyCleanup = internalMutation({
  args: {
    itemId: v.id("items"),
    title: v.optional(v.string()),
    creator: v.optional(v.string()),
    year: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    pages: v.optional(v.number()),
    addTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("items", args.itemId);
    if (item === null) return null;
    const patch: Partial<Doc<"items">> = { aiStatus: "done", aiError: undefined };
    if (args.title) patch.title = args.title;
    if (args.creator) patch.creator = args.creator;
    if (args.year) patch.year = args.year;
    // Only fill time to finish when the user didn't give one.
    if (
      args.durationMinutes &&
      (item.durationMode === "auto" || item.durationMode === "unset" || item.durationMinutes === undefined) &&
      item.durationMode !== "na"
    ) {
      patch.durationMinutes = Math.round(args.durationMinutes);
      patch.durationMode = "minutes";
      if (args.pages) patch.pages = args.pages;
    }
    if (args.addTags.length) {
      const ids = await ensureTags(ctx, item.userId, args.addTags);
      patch.tagIds = [...new Set([...item.tagIds, ...ids])];
    }
    await ctx.db.patch("items", item._id, patch);
    return null;
  },
});

export const markAiFailed = internalMutation({
  args: { itemId: v.id("items"), error: v.string() },
  handler: async (ctx, { itemId, error }) => {
    const item = await ctx.db.get("items", itemId);
    if (item === null) return null;
    await ctx.db.patch("items", itemId, { aiStatus: "failed", aiError: error.slice(0, 500) });
    return null;
  },
});

export const storeCover = internalMutation({
  args: { itemId: v.id("items"), storageId: v.id("_storage") },
  handler: async (ctx, { itemId, storageId }) => {
    const item = await ctx.db.get("items", itemId);
    if (item === null) {
      await ctx.storage.delete(storageId);
      return null;
    }
    await replaceCover(ctx, item, storageId);
    return null;
  },
});
