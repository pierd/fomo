import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
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

export const fetchCover = internalAction({
  args: { itemId: v.id("items"), hints: hintsValidator },
  handler: async (ctx, { itemId, hints }) => {
    const { coverUrl, ...rest } = hints;
    let blob = coverUrl ? await downloadImage(coverUrl) : null;
    if (blob === null) {
      const url = await findCoverUrl(rest);
      if (url === null) return null;
      blob = await downloadImage(url);
    }
    if (blob === null) return null;
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.items.storeCover, { itemId, storageId });
    return null;
  },
});
