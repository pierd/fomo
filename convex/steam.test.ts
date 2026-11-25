/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseOwnedGames, parseProfile } from "./lib/steam";

const modules = import.meta.glob("./**/*.ts");
const ID = "76561197960287930";

async function signedIn() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  return { t, as: t.withIdentity({ subject: `${userId}|x` }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Steam", () => {
  it("understands profiles", () => {
    expect(parseProfile(` https://steamcommunity.com/profiles/${ID}/games?tab=all `)).toEqual({ steamId: ID });
    expect(parseProfile("steamcommunity.com/id/gabelogannewell/")).toEqual({ vanity: "gabelogannewell" });
    expect(parseProfile(ID)).toEqual({ steamId: ID });
    expect(parseProfile("gabe")).toEqual({ vanity: "gabe" });
    expect(parseProfile("https://example.com/id/gabe")).toBeNull();
    expect(parseProfile("https://steamcommunity.com/profiles/123")).toBeNull();
  });

  it("tells a private library from an empty one", () => {
    expect(parseOwnedGames({ response: {} })).toBeNull();
    expect(parseOwnedGames({ response: { game_count: 0 } })).toEqual([]);
  });

  it("loads a library by custom URL", async () => {
    vi.stubEnv("STEAM_API_KEY", "k");
    const fetched = vi.fn(async (url: string) =>
      Response.json(
        url.includes("ResolveVanityURL")
          ? { response: { success: 1, steamid: ID } }
          : {
              response: {
                game_count: 2,
                games: [
                  { appid: 1, name: "Unplayed", playtime_forever: 0, rtime_last_played: 0 },
                  { appid: 2, name: "DARK SOULS™ III", playtime_forever: 90, rtime_last_played: 1_600_000_000 },
                ],
              },
            },
      ),
    );
    vi.stubGlobal("fetch", fetched);
    const { t, as } = await signedIn();
    expect(await as.action(api.steam.library, { profile: "gabe", wishlist: false })).toEqual({ wishlist: [], games: [
      { appId: 2, title: "DARK SOULS III", playedMinutes: 90, lastPlayedAt: 1_600_000_000_000 },
      { appId: 1, title: "Unplayed", playedMinutes: 0 },
    ] });
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(fetched.mock.calls[1][0]).toContain(`steamid=${ID}`);
    await expect(t.action(api.steam.library, { profile: "gabe", wishlist: false })).rejects.toThrow(/notSignedIn/);
  });

  it("adds the wishlist, in order, without owned or unknown games", async () => {
    vi.stubEnv("STEAM_API_KEY", "k");
    let storeUp = true;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("GetOwnedGames")) {
        return Response.json({ response: { game_count: 1, games: [{ appid: 5, name: "Owned", playtime_forever: 1 }] } });
      }
      // Only the library needs the key.
      expect(url).not.toContain("key=");
      if (url.includes("GetWishlist")) {
        const item = (appid: number, priority: number, date_added: number) => ({ appid, priority, date_added });
        return Response.json({ response: { items: [item(1, 0, 10), item(2, 0, 20), item(3, 1, 5), item(4, 2, 5), item(5, 3, 5)] } });
      }
      if (!storeUp) return new Response("", { status: 503 });
      const ok = (appid: number, more = {}) => ({ appid, success: 1, name: `Game ${appid}`, ...more });
      return Response.json({
        response: {
          store_items: [
            ok(1),
            ok(2, { release: { is_coming_soon: true, steam_release_date: 1_900_000_000 } }),
            ok(3, {
              basic_info: { developers: [{ name: "Studio" }] },
              release: { steam_release_date: 1_600_000_000 },
              assets: { asset_url_format: "steam/apps/3/${FILENAME}?t=1", library_capsule_2x: "c.jpg" },
            }),
            { appid: 4, success: 0 },
            ok(5),
          ],
        },
      });
    });
    const { as } = await signedIn();
    const { wishlist } = await as.action(api.steam.library, { profile: ID, wishlist: true });
    expect(wishlist.map((g) => g.appId)).toEqual([3, 2, 1]);
    expect(wishlist[0]).toEqual({
      appId: 3,
      title: "Game 3",
      creator: "Studio",
      year: 2020,
      addedAt: 5000,
      coverUrl: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3/c.jpg?t=1",
    });
    expect(wishlist[1].year).toBeUndefined();
    storeUp = false;
    await expect(as.action(api.steam.library, { profile: ID, wishlist: true })).rejects.toThrow(/steamWishlistUnavailable/);
  });

  it("explains what went wrong", async () => {
    const { as } = await signedIn();
    vi.stubEnv("STEAM_API_KEY", "");
    await expect(as.action(api.steam.library, { profile: ID, wishlist: false })).rejects.toThrow(/steamNotConfigured/);
    vi.stubEnv("STEAM_API_KEY", "k");
    vi.stubGlobal("fetch", async () => Response.json({ response: {} }));
    await expect(as.action(api.steam.library, { profile: ID, wishlist: false })).rejects.toThrow(/steamPrivate/);
    await expect(as.action(api.steam.library, { profile: "nobody", wishlist: false })).rejects.toThrow(/steamNoProfile/);
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(as.action(api.steam.library, { profile: ID, wishlist: false })).rejects.toThrow(/steamUnavailable/);
  });

  it("imports endless games without a time, and doesn't invent finish dates", async () => {
    const { as } = await signedIn();
    await as.mutation(api.imports.commit, {
      items: [{ title: "Factorio", tagNames: ["games"], status: "done", noDuration: true }],
      fetchCovers: false,
      estimateWithAi: true,
    });
    const [item] = await as.query(api.items.list, {});
    expect(item.durationMode).toBe("na");
    expect(item.finishedAt).toBeUndefined();
  });
});
