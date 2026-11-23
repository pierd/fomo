import { action, mutation } from "./_generated/server";
import { v } from "convex/values";
import { generateText, Output } from "ai";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { z } from "zod";
import { internal } from "./_generated/api";
import { requireAiInAction, requireUserId } from "./lib/auth";
import { ensureTags } from "./tags";
import { CLEANUP_MODEL } from "./ai";
import { statusValidator } from "./schema";
import { canUseAi } from "./lib/auth";

export const MAX_BATCH = 200;

const importItemValidator = v.object({
  title: v.string(),
  creator: v.optional(v.string()),
  year: v.optional(v.number()),
  tagNames: v.array(v.string()),
  description: v.optional(v.string()),
  durationMinutes: v.optional(v.number()),
  pages: v.optional(v.number()),
  status: statusValidator,
  addedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  source: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  // Cover lookup hints.
  kind: v.optional(v.string()),
  isbn: v.optional(v.string()),
  coverUrl: v.optional(v.string()),
});

// Adds one batch of reviewed import rows. The client sends big imports in
// several batches.
export const commit = mutation({
  args: {
    items: v.array(importItemValidator),
    fetchCovers: v.boolean(),
    estimateWithAi: v.boolean(),
    // Where this batch's background work starts, so batches queue up rather than overlap.
    startDelayMs: v.optional(v.number()),
  },
  handler: async (ctx, { items, fetchCovers, estimateWithAi, startDelayMs }) => {
    const userId = await requireUserId(ctx);
    const ai = estimateWithAi && (await canUseAi(ctx, userId));
    if (items.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} items per batch`);
    const now = Date.now();
    let delay = startDelayMs ?? 0;
    for (const it of items) {
      const title = it.title.trim();
      if (!title) continue;
      const pages = it.pages && it.pages > 0 ? it.pages : undefined;
      const minutes = it.durationMinutes && it.durationMinutes > 0 ? Math.round(it.durationMinutes) : undefined;
      const itemId = await ctx.db.insert("items", {
        userId,
        title,
        creator: it.creator?.trim() || undefined,
        year: it.year,
        tagIds: await ensureTags(ctx, userId, it.tagNames),
        description: it.description?.trim() || undefined,
        durationMode: minutes !== undefined ? (pages !== undefined ? "pages" : "minutes") : ai ? "auto" : "unset",
        durationMinutes: minutes,
        pages,
        status: it.status,
        addedAt: it.addedAt ?? now,
        finishedAt: it.status !== "active" ? (it.finishedAt ?? it.addedAt ?? now) : undefined,
        source: it.source,
        sourceUrl: it.sourceUrl,
        aiStatus: ai && minutes === undefined ? "pending" : undefined,
      });
      if (ai && minutes === undefined) {
        await ctx.scheduler.runAfter(delay, internal.ai.cleanupItem, { itemId, full: false });
      }
      if (fetchCovers) {
        // Spread out so source sites aren't hammered.
        await ctx.scheduler.runAfter(delay, internal.covers.fetchCover, {
          itemId,
          hints: {
            title,
            creator: it.creator,
            year: it.year,
            kind: it.kind,
            isbn: it.isbn,
            sourceUrl: it.coverUrl ?? it.sourceUrl,
          },
        });
      }
      delay += 1500;
    }
    return null;
  },
});

const notesSchema = z.object({
  items: z.array(
    z.object({
      title: z.string().describe("Canonical, properly capitalized title, without the creator."),
      creator: z.string().optional().describe("Author / director / creator, if known."),
      year: z.number().int().optional(),
      kind: z.enum(["book", "movie", "series", "game", "podcast", "course", "other"]),
      durationMinutes: z
        .number()
        .optional()
        .describe("Audiobook length for books, runtime for movies, all seasons for series, main story for games."),
      pages: z.number().int().optional(),
      note: z.string().optional().describe("Anything else the notes said about this item (who recommended it, why)."),
    }),
  ),
});

const KIND_TAG: Record<string, string> = {
  book: "books",
  movie: "movies",
  series: "series",
  game: "games",
  podcast: "podcasts",
};

// Turns free-form notes into import rows (still reviewed before adding).
export const parseNotes = action({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    await requireAiInAction(ctx);
    if (text.length > 30000) throw new Error("Notes are too long; split them up (30k characters max)");
    const { output } = await generateText({
      model: convexGateway(CLEANUP_MODEL),
      output: Output.object({ schema: notesSchema }),
      system: `You extract a reading/watching/playing list from someone's rough notes.
Each thing they want to read, watch, play or listen to becomes one item. Identify the real work meant and clean up its title. Skip lines that aren't such works. Keep the order of the notes.`,
      prompt: text,
    });
    return output.items.map((i) => ({
      title: i.title,
      creator: i.creator,
      year: i.year,
      kind: i.kind,
      durationMinutes: i.durationMinutes,
      pages: i.pages,
      description: i.note,
      tagNames: KIND_TAG[i.kind] ? [KIND_TAG[i.kind]] : [],
    }));
  },
});
