# Games

How games fit into FOMO, and ideas not built yet.

## Decisions

- **No extra status.** `done` means "I got what I wanted from it". Endless and
  multiplayer games use `durationMode: "na"`, so they don't count towards time
  left or pace. Tried and didn't stick: `discarded`.
- **Opt-in import.** Libraries are full of bundle leftovers, so nothing is
  picked to start with.
- **Playtime never implies `done`.** It's shown in the review to help choose,
  and isn't stored.
- **No invented finish dates.** An import without a finish or added date leaves
  `finishedAt` empty; otherwise old games would inflate the current pace.
  Steam's last-played date is used when a game is marked done in the review, if
  Steam sends it. It didn't for any public profile tried (November 2026), so
  expect it for the API key owner's account at most.
- **One generic CSV importer, not one integration per store.** We don't hold
  store logins.

## Built

- Steam library through the official Web API (`convex/steam.ts`). "Game
  details" must be public. Steam doesn't give purchase dates.
- Steam wishlist, on by default in the Steam import, skipping games already
  owned. `IWishlistService/GetWishlist` has app ids and dates added;
  `IStoreBrowseService/GetItems` (undocumented, no key) adds title, studio, year
  and cover. Apps the store no longer knows are left out. An empty wishlist and
  a private one look the same.
- Any CSV with a column mapping (`src/lib/csvMapping.ts`).

## Ideas

| Idea | Notes |
|---|---|
| Store `playedMinutes` | "6h of about 20h left". Needs a schema field and a decision on whether remaining time subtracts it. |
| Re-sync Steam | Refresh playtime, offer newly bought games. Needs the Steam app ID on items; today it's only in `sourceUrl`. |
| IGDB | Real time to beat (`game_time_to_beats`: hastily / normally / completely) and Steam ID mapping, instead of AI estimates. 4 requests/s; free for non-commercial use only. HowLongToBeat: no official API found. |
| "Ongoing" status | Only if `na` turns out not to be enough for endless games. |
| Detect endless games | Steam store categories, or the AI estimate, could suggest "no time to finish". |

## Other stores

| Store | Route | Verdict |
|---|---|---|
| GOG, Epic | No suitable public library API known; launchers use unofficial logins | CSV through Playnite (Windows). Heroic (Mac): export not checked |
| PlayStation | [psn-api](https://www.npmjs.com/package/psn-api), but its NPSSO token is equivalent to a password | CSV; don't hold the token |
| Xbox | [Title history](https://devdocs.xbox.com/reference/live/rest/uri/titlehistory/atoc-reference-titlehistoryv2): played games, not the full library. OpenXBL (third party) not checked | If needed |
| Nintendo | Play history in the Store app; no official export found | Paste text, or screenshots through an AI agent (MCP) |
| App Store | [Apple's data export](https://support.apple.com/en-us/102208): purchases and downloads, games mixed with every other app | By hand. With the export, the CSV importer in opt-in mode may do; file format not checked |
