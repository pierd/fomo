import { action, env } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  parseOwnedGames,
  parseProfile,
  parseStoreItems,
  parseWishlist,
  type SteamGame,
  type WishlistGame,
} from "./lib/steam";

const STORE_BATCH = 100;
// Convex arrays hold at most 8192 values; the list itself fewer.
const MAX_GAMES = 5000;

async function callSteam(
  method: string,
  params: Record<string, string>,
  error: "steamUnavailable" | "steamWishlistUnavailable" = "steamUnavailable",
): Promise<unknown> {
  const query = new URLSearchParams(params);
  try {
    const res = await fetch(`https://api.steampowered.com/${method}/v1/?${query}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return await res.json();
    console.error(`Steam ${method} answered ${res.status}`);
  } catch {
    // Not logging the error itself: its message may contain the URL, with the key.
    console.error(`Steam ${method} failed`);
  }
  return fail(error);
}

// Neither of these calls needs the API key.
async function loadWishlist(steamId: string): Promise<WishlistGame[]> {
  const entries = parseWishlist(
    await callSteam("IWishlistService/GetWishlist", { steamid: steamId }, "steamWishlistUnavailable"),
  ).slice(0, MAX_GAMES);
  const games: WishlistGame[] = [];
  for (let i = 0; i < entries.length; i += STORE_BATCH) {
    const batch = entries.slice(i, i + STORE_BATCH);
    const details = parseStoreItems(
      await callSteam(
        "IStoreBrowseService/GetItems",
        {
          input_json: JSON.stringify({
            ids: batch.map((e) => ({ appid: e.appId })),
            context: { language: "english", country_code: "US" },
            data_request: { include_release: true, include_basic_info: true, include_assets: true },
          }),
        },
        "steamWishlistUnavailable",
      ),
    );
    for (const { appId, addedAt } of batch) {
      const found = details.get(appId);
      if (found) games.push({ appId, addedAt, ...found });
    }
  }
  return games;
}

// The games of a public profile, to review before importing. Saves nothing.
export const library = action({
  args: { profile: v.string(), wishlist: v.boolean() },
  handler: async (ctx, { profile, wishlist }): Promise<{ games: SteamGame[]; wishlist: WishlistGame[] }> => {
    await requireUserId(ctx);
    const key = env.STEAM_API_KEY;
    if (!key) fail("steamNotConfigured");
    const parsed = parseProfile(profile);
    if (parsed === null) fail("steamBadProfile");

    let steamId: string;
    if ("steamId" in parsed) {
      steamId = parsed.steamId;
    } else {
      const found = (await callSteam("ISteamUser/ResolveVanityURL", { key, vanityurl: parsed.vanity })) as {
        response?: { steamid?: string };
      } | null;
      if (!found?.response?.steamid) fail("steamNoProfile");
      steamId = found.response.steamid;
    }

    const games = parseOwnedGames(
      await callSteam("IPlayerService/GetOwnedGames", {
        key,
        steamid: steamId,
        include_appinfo: "true",
        include_played_free_games: "true",
        // Undocumented: otherwise games with limited profile features are missing.
        skip_unvetted_apps: "false",
      }),
    );
    if (games === null) fail("steamPrivate");
    const owned = new Set(games.map((g) => g.appId));
    return {
      games: games.slice(0, MAX_GAMES),
      wishlist: wishlist ? (await loadWishlist(steamId)).filter((g) => !owned.has(g.appId)) : [],
    };
  },
});
