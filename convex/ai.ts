import { generateText, Output } from "ai";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { z } from "zod";
import { internalAction, internalQuery } from "./_generated/server";
import { downloadImage, findCoverUrl } from "./lib/covers";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Called through the Convex AI Gateway (provider/model).
// See https://docs.convex.dev/ai-gateway/models.md for what's available.
export const CLEANUP_MODEL = "anthropic/claude-sonnet-5.5";

const cleanupSchema = z.object({
  recognized: z.boolean().describe("Whether you confidently know which real work the user means."),
  kind: z.enum(["book", "movie", "series", "game", "podcast", "course", "other"]),
  title: z
    .string()
    .describe("Canonical title, properly capitalized, as commonly published in English. Without the creator."),
  creator: z
    .string()
    .optional()
    .describe("Author (books), director (movies), creator (series), studio (games). Omit if unknown."),
  year: z.number().int().optional().describe("Year of first publication / release."),
  durationMinutes: z
    .number()
    .optional()
    .describe(
      "Time to finish in minutes: unabridged English audiobook length for books, runtime for movies, total runtime of all seasons for series, main story length for games.",
    ),
  pages: z.number().int().optional().describe("Typical page count, for books."),
  isbn: z.string().optional().describe("An ISBN-13 of a common English edition, only if confident."),
  wikipediaTitle: z.string().optional().describe("Title of the English Wikipedia article about the work, if one exists."),
  tags: z.array(z.string()).describe("Tags that fit, chosen ONLY from the provided list of existing tags."),
});

export const cleanupItem = internalAction({
  args: { itemId: v.id("items"), full: v.boolean() },
  handler: async (ctx, { itemId, full }) => {
    const item = await ctx.runQuery(internal.items.getInternal, { itemId });
    if (item === null) return null;
    const allTags: { name: string }[] = await ctx.runQuery(internal.ai.userTags, { userId: item.userId });
    try {
      const { output } = await generateText({
        model: convexGateway(CLEANUP_MODEL),
        output: Output.object({ schema: cleanupSchema }),
        system: `You tidy up entries in a personal list of things to read, watch, play or listen to.
The user typed a rough name (maybe lowercase, misspelled, partial, or with the author/year mixed in). Identify the work they most likely mean and return clean metadata.
If you can't tell what the work is, set recognized=false and return the title as given, just with tidy capitalization.
Estimates are fine for durations; prefer well-known figures.`,
        prompt: `Entry: ${JSON.stringify(item.title)}${item.creator ? `\nCreator given: ${JSON.stringify(item.creator)}` : ""}
Tags already on it: ${item.tagNames.join(", ") || "(none)"}${item.description ? `\nNotes: ${JSON.stringify(item.description.slice(0, 500))}` : ""}
Existing tags to choose from: ${allTags.map((t) => t.name).join(", ")}`,
      });
      const tags = new Set(allTags.map((t) => t.name));
      await ctx.runMutation(internal.items.applyCleanup, {
        itemId,
        ...(full && output.recognized
          ? { title: output.title, creator: output.creator, year: output.year }
          : {}),
        durationMinutes: output.durationMinutes,
        pages: output.pages,
        addTags: full ? output.tags.filter((t) => tags.has(t)) : [],
      });
      if (full && output.recognized && !item.coverStorageId) {
        const url = await findCoverUrl({
          title: output.title,
          creator: output.creator,
          year: output.year,
          kind: output.kind,
          isbn: output.isbn,
          wikipediaTitle: output.wikipediaTitle,
          sourceUrl: item.sourceUrl,
        });
        const blob = url ? await downloadImage(url) : null;
        if (blob) {
          const storageId = await ctx.storage.store(blob);
          await ctx.runMutation(internal.items.storeCover, { itemId, storageId });
        }
      }
    } catch (e) {
      await ctx.runMutation(internal.items.markAiFailed, {
        itemId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  },
});

export const userTags = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_userId_and_name", (q) => q.eq("userId", userId))
      .take(1000);
    return tags.map((t) => ({ name: t.name }));
  },
});
