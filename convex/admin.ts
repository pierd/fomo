import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { canUseAi, isAdmin, requireAdmin, requireUserId } from "./lib/auth";
import { localeValidator } from "./lib/locales";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    return {
      email: user?.email ?? null,
      locale: user?.locale ?? null,
      isAdmin: await isAdmin(ctx, userId),
      aiEnabled: await canUseAi(ctx, userId),
    };
  },
});

export const setLocale = mutation({
  args: { locale: localeValidator },
  handler: async (ctx, { locale }) => {
    const userId = await requireUserId(ctx);
    await ctx.db.patch("users", userId, { locale });
    return null;
  },
});

export const checkAi = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => await canUseAi(ctx, userId),
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return await Promise.all(
      users.map(async (u) => ({
        _id: u._id,
        email: u.email ?? null,
        createdAt: u._creationTime,
        aiEnabled: u.aiEnabled === true,
        isAdmin: await isAdmin(ctx, u._id),
      })),
    );
  },
});

export const setAiEnabled = mutation({
  args: { userId: v.id("users"), enabled: v.boolean() },
  handler: async (ctx, { userId, enabled }) => {
    await requireAdmin(ctx);
    await ctx.db.patch("users", userId, { aiEnabled: enabled });
    return null;
  },
});

async function userByEmail(ctx: MutationCtx, email: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email.trim()))
    .unique();
  if (user === null) throw new Error(`No account with email ${email}; sign up first`);
  return user;
}

// Run from the CLI: npx convex run admin:grant '{"email":"..."}' (add --prod).
// Only for an existing account: sign-up has no email verification, so granting
// by email in advance would let anyone claim it.
export const grant = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await userByEmail(ctx, email);
    if (!(await isAdmin(ctx, user._id))) {
      await ctx.db.insert("roles", { userId: user._id, role: "admin" });
    }
    return null;
  },
});

export const revoke = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await userByEmail(ctx, email);
    const roles = await ctx.db
      .query("roles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(10);
    for (const role of roles) await ctx.db.delete("roles", role._id);
    return null;
  },
});
