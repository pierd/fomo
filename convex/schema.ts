import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { localeValidator } from "./lib/locales";

export const statusValidator = v.union(v.literal("active"), v.literal("done"), v.literal("discarded"));

// How "time to finish" was given: minutes typed in, derived from pages, not
// applicable, or left for the AI to figure out.
export const durationModeValidator = v.union(
  v.literal("minutes"),
  v.literal("pages"),
  v.literal("na"),
  v.literal("auto"),
  v.literal("unset"),
);

export const aiStatusValidator = v.union(v.literal("pending"), v.literal("done"), v.literal("failed"));

export const resultValidator = v.union(v.literal("a"), v.literal("b"), v.literal("draw"));

export default defineSchema({
  ...authTables,

  // Convex Auth's `users` table plus `aiEnabled`, set by an admin.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    aiEnabled: v.optional(v.boolean()),
    // UI language; also the language of default tags and AI output.
    locale: v.optional(localeValidator),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  roles: defineTable({
    userId: v.id("users"),
    role: v.literal("admin"),
  }).index("by_userId", ["userId"]),

  tags: defineTable({
    userId: v.id("users"),
    name: v.string(),
  }).index("by_userId_and_name", ["userId", "name"]),

  items: defineTable({
    userId: v.id("users"),
    title: v.string(),
    // Author, director, studio... shown as "Title by Creator".
    creator: v.optional(v.string()),
    year: v.optional(v.number()),
    tagIds: v.array(v.id("tags")),
    description: v.optional(v.string()),
    durationMode: durationModeValidator,
    durationMinutes: v.optional(v.number()),
    pages: v.optional(v.number()),
    coverStorageId: v.optional(v.id("_storage")),
    status: statusValidator,
    // Defaults to creation time; imports keep the original "date added".
    addedAt: v.number(),
    finishedAt: v.optional(v.number()),
    source: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    aiStatus: v.optional(aiStatusValidator),
    aiError: v.optional(v.string()),
  })
    .index("by_userId_and_status_and_addedAt", ["userId", "status", "addedAt"])
    .index("by_userId_and_addedAt", ["userId", "addedAt"]),

  tournaments: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tagIds: v.array(v.id("tags")),
    participantIds: v.array(v.id("items")),
    importedFrom: v.array(v.id("tournaments")),
    importedCount: v.number(),
    conflictCount: v.number(),
    status: v.union(v.literal("active"), v.literal("completed")),
    completedAt: v.optional(v.number()),
    // Final standing, best first (ties share a rank).
    standings: v.optional(v.array(v.object({ itemId: v.id("items"), rank: v.number() }))),
  }).index("by_userId", ["userId"]),

  comparisons: defineTable({
    tournamentId: v.id("tournaments"),
    a: v.id("items"),
    b: v.id("items"),
    result: resultValidator,
    imported: v.boolean(),
  }).index("by_tournamentId", ["tournamentId"]),
});
