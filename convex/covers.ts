import { internalAction } from "./_generated/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { runPaced } from "./lib/batch";
import { downloadImage, findCoverUrl } from "./lib/covers";

export const hintsValidator = v.object({
  title: v.string(),
  creator: v.optional(v.string()),
  year: v.optional(v.number()),
  kind: v.optional(v.string()),
  isbn: v.optional(v.string()),
  wikipediaTitle: v.optional(v.string()),
  coverUrl: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

async function findCover({ coverUrl, ...hints }: Infer<typeof hintsValidator>): Promise<Blob | null> {
  const direct = coverUrl ? await downloadImage(coverUrl) : null;
  if (direct) return direct;
  const url = await findCoverUrl(hints);
  return url ? await downloadImage(url) : null;
}

// Covers for a batch of imported items, saved together.
export const fetchCovers = internalAction({
  args: { jobs: v.array(v.object({ itemId: v.id("items"), hints: hintsValidator })) },
  handler: async (ctx, { jobs }) => {
    const covers: { itemId: Id<"items">; storageId: Id<"_storage"> }[] = [];
    const rest = await runPaced(jobs, async ({ itemId, hints }) => {
      try {
        const blob = await findCover(hints);
        if (blob) covers.push({ itemId, storageId: await ctx.storage.store(blob) });
      } catch (e) {
        console.error(`Cover for ${itemId} failed`, e);
      }
    });
    if (rest.length) await ctx.scheduler.runAfter(0, internal.covers.fetchCovers, { jobs: rest });
    if (covers.length) await ctx.runMutation(internal.items.storeCovers, { covers });
    return null;
  },
});

// Imports no longer schedule this; kept for jobs queued by earlier versions.
export const fetchCover = internalAction({
  args: { itemId: v.id("items"), hints: hintsValidator },
  handler: async (ctx, { itemId, hints }) => {
    const blob = await findCover(hints);
    if (blob === null) return null;
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.items.storeCover, { itemId, storageId });
    return null;
  },
});
