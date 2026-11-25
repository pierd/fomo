// Reading a public Steam library. No sign-in: the user tells us their profile.

export type SteamProfile = { steamId: string } | { vanity: string };

export type SteamGame = {
  appId: number;
  title: string;
  playedMinutes: number;
  // Usually missing: Steam left it out for every other account tried, perhaps
  // sending it only for the API key owner's own.
  lastPlayedAt?: number;
};

// Accepts a profile link, a 17-digit SteamID or a custom URL name.
export function parseProfile(raw: string): SteamProfile | null {
  const s = raw.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  const name = link ? link[2] : s;
  if (link?.[1].toLowerCase() !== "id" && /^7656119\d{10}$/.test(name)) return { steamId: name };
  if (link?.[1].toLowerCase() === "profiles") return null;
  return /^[\w-]{2,64}$/.test(name) ? { vanity: name } : null;
}

export function cleanTitle(name: string) {
  return name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

// null when Steam won't say: "Game details" aren't public.
export function parseOwnedGames(data: unknown): SteamGame[] | null {
  const response = (data as { response?: { game_count?: unknown; games?: unknown } } | null)?.response;
  if (!response || (response.game_count === undefined && response.games === undefined)) return null;
  const games = Array.isArray(response.games) ? (response.games as Record<string, unknown>[]) : [];
  return games
    .flatMap((g) => {
      const title = typeof g.name === "string" ? cleanTitle(g.name) : "";
      if (typeof g.appid !== "number" || !title) return [];
      const last = g.rtime_last_played;
      return [
        {
          appId: g.appid,
          title,
          playedMinutes: typeof g.playtime_forever === "number" ? g.playtime_forever : 0,
          // Very old sessions come back as a date in 1970.
          lastPlayedAt: typeof last === "number" && last > 1_000_000_000 ? last * 1000 : undefined,
        },
      ];
    })
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.playedMinutes - a.playedMinutes || a.title.localeCompare(b.title));
}

export type WishlistEntry = { appId: number; priority: number; addedAt?: number };

export type WishlistGame = {
  appId: number;
  title: string;
  creator?: string;
  year?: number;
  addedAt?: number;
  coverUrl?: string;
};

// In the user's order; unranked ones (priority 0) last, newest first. Steam
// answers the same for an empty wishlist and a private one.
export function parseWishlist(data: unknown): WishlistEntry[] {
  const items = (data as { response?: { items?: unknown } } | null)?.response?.items;
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[])
    .flatMap((i) =>
      typeof i.appid === "number"
        ? [
            {
              appId: i.appid,
              priority: typeof i.priority === "number" ? i.priority : 0,
              addedAt: typeof i.date_added === "number" && i.date_added > 0 ? i.date_added * 1000 : undefined,
            },
          ]
        : [],
    )
    // Two unranked: Infinity - Infinity is NaN, which falls through to the date.
    .sort(
      (a, b) => (a.priority || Infinity) - (b.priority || Infinity) || (b.addedAt ?? 0) - (a.addedAt ?? 0),
    );
}

type StoreItem = {
  appid?: number;
  success?: number;
  name?: string;
  basic_info?: { developers?: { name?: string }[] };
  release?: { is_coming_soon?: boolean; steam_release_date?: number; original_release_date?: number };
  assets?: { asset_url_format?: string; library_capsule_2x?: string; library_capsule?: string };
};

// Wishlists only have app ids; this reads the store's details about them.
// Apps the store no longer knows are left out.
export function parseStoreItems(data: unknown): Map<number, Omit<WishlistGame, "appId" | "addedAt">> {
  const items = (data as { response?: { store_items?: StoreItem[] } } | null)?.response?.store_items ?? [];
  const out = new Map<number, Omit<WishlistGame, "appId" | "addedAt">>();
  for (const i of items) {
    const title = cleanTitle(i.name ?? "");
    if (!i.appid || i.success !== 1 || !title) continue;
    const released = i.release?.original_release_date || i.release?.steam_release_date;
    const file = i.assets?.library_capsule_2x ?? i.assets?.library_capsule;
    const path = file && i.assets?.asset_url_format?.replace("${FILENAME}", file);
    out.set(i.appid, {
      title,
      creator: i.basic_info?.developers?.[0]?.name,
      // Dates of unreleased games are often placeholders.
      year: released && !i.release?.is_coming_soon ? new Date(released * 1000).getUTCFullYear() : undefined,
      coverUrl: path ? `https://shared.fastly.steamstatic.com/store_item_assets/${path}` : undefined,
    });
  }
  return out;
}
