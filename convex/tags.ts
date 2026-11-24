import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { defaultTags, normalizeTag } from "./lib/tags";
import { fail } from "./lib/errors";



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
    const user = await ctx.db.get("users", userId);
    await ensureTags(ctx, userId, defaultTags(user?.locale ?? "en"));
    return null;
  },
});

export const rename = mutation({
  args: { tagId: v.id("tags"), name: v.string() },
  handler: async (ctx, { tagId, name }) => {
    const userId = await requireUserId(ctx);
    await renameTag(ctx, userId, tagId, name);
    return null;
  },
});

export async function renameTag(ctx: MutationCtx, userId: Id<"users">, tagId: Id<"tags">, name: string) {
  const tag = await ctx.db.get("tags", tagId);
  if (tag === null || tag.userId !== userId) fail("notFound");
  const clean = normalizeTag(name);
  if (!clean) fail("emptyName");
  const clash = await ctx.db
    .query("tags")
    .withIndex("by_userId_and_name", (q) => q.eq("userId", userId).eq("name", clean))
    .unique();
  if (clash !== null && clash._id !== tagId) fail("tagExists", { name: clean });
  await ctx.db.patch("tags", tagId, { name: clean });
  return clean;
}
