import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { normalizeTag } from "./lib/tags";

export const DEFAULT_TAGS = [
  "books",
  "movies",
  "series",
  "games",
  "podcasts",
  "fiction",
  "non-fiction",
  "documentary",
];


export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId))
      .take(1000);
    return tags.map((t) => ({ _id: t._id, name: t.name }));
  },
});

// Looks up tags by name, creating the missing ones.
export async function ensureTags(ctx: MutationCtx, userId: Id<"users">, names: string[]) {
  const ids: Id<"tags">[] = [];
  for (const raw of names) {
    const name = normalizeTag(raw);
    if (!name) continue;
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    const id = existing?._id ?? (await ctx.db.insert("tags", { userId, name }));
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export const seedDefaults = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ensureTags(ctx, userId, DEFAULT_TAGS);
    return null;
  },
});

export const rename = mutation({
  args: { tagId: v.id("tags"), name: v.string() },
  handler: async (ctx, { tagId, name }) => {
    const userId = await requireUserId(ctx);
    const tag = await ctx.db.get("tags", tagId);
    if (tag === null || tag.userId !== userId) throw new Error("Tag not found");
    const clean = normalizeTag(name);
    if (!clean) throw new Error("Tag name can't be empty");
    const clash = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId).eq("name", clean))
      .unique();
    if (clash !== null && clash._id !== tagId) throw new Error(`Tag "${clean}" already exists`);
    await ctx.db.patch("tags", tagId, { name: clean });
    return null;
  },
});
