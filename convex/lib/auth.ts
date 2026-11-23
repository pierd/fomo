import { getAuthUserId } from "@convex-dev/auth/server";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export async function requireUserId(ctx: QueryCtx | ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in");
  return userId;
}

export async function isAdmin(ctx: QueryCtx, userId: Id<"users">) {
  const role = await ctx.db
    .query("roles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return role?.role === "admin";
}

export async function canUseAi(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  return user?.aiEnabled === true || (await isAdmin(ctx, userId));
}

export async function requireAdmin(ctx: QueryCtx) {
  const userId = await requireUserId(ctx);
  if (!(await isAdmin(ctx, userId))) throw new Error("Admins only");
  return userId;
}

// Actions can't read the database: checks AI access through a query.
export async function requireAiInAction(ctx: ActionCtx) {
  const userId = await requireUserId(ctx);
  const allowed: boolean = await ctx.runQuery(internal.admin.checkAi, { userId });
  if (!allowed) throw new Error("AI features are locked for this account");
  return userId;
}

export async function requireOwnItem(ctx: QueryCtx, itemId: Id<"items">) {
  const userId = await requireUserId(ctx);
  const item = await ctx.db.get("items", itemId);
  if (item === null || item.userId !== userId) throw new Error("Item not found");
  return item;
}
