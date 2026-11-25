# FOMO

Everything you want to read, watch and play, and a tournament to pick what's
next. Live at https://fomo.lessismore.studio.

- Frontend: React + TypeScript + Vite + Tailwind (`src/`), hash routes.
- Backend: Convex (`convex/`), Convex Auth with email + password.
- AI (title clean-up, time estimates, reading rough notes) goes through the
  Convex AI Gateway (`convex/ai.ts`, `convex/imports.ts`). Locked per account;
  an admin unlocks it on the Admin page.
- Imports (`src/lib/importers.ts`): known CSV exports, any CSV with a column
  mapping (`src/lib/csvMapping.ts`), text, and a public Steam library
  (`convex/steam.ts`, needs `STEAM_API_KEY`). How games fit in and what could
  come next: `docs/games.md`.
- Covers: source page `og:image` (Goodreads, Letterboxd), Open Library for
  books, Wikipedia otherwise; downloaded into Convex storage (`convex/lib/covers.ts`).
- Localized in English, Spanish and Polish (i18next). **Every UI string goes
  through `t()` and must exist in all of `src/i18n/locales/{en,es,pl}.json`**
  (a test checks keys and plural forms). Server errors are `ConvexError`s with
  a `code` (`convex/lib/errors.ts`) that the app translates under `errors.*`.
  The account's `locale` also picks the language of default tags
  (`convex/lib/tags.ts`) and of AI output.
- Tournament logic (`convex/lib/ranking.ts`) is shared by backend and
  frontend: results are a partial order closed under transitivity, draws merge
  items, only undecided pairs are asked, and it ends when the top 4 are fully
  ordered.
- Global ranking (`convex/lib/globalRanking.ts`): every original answer from
  tournaments and from `duels` goes into one partial order, newest first (newer
  answers win contradictions); strength scores fitted to it (Bradley-Terry)
  order the rest. Computed in the frontend, never stored. The rank page
  (`#/rank`, `#/rank/<itemId>`) sharpens the top or places one item by binary
  search, among the items with the list's selected tags.
- Agents: an MCP server at `<deployment>.convex.site/mcp` (`convex/mcp.ts`,
  protocol in `convex/lib/mcpProtocol.ts`): stateless Streamable HTTP, tools
  to list/add/update/delete items, set covers from a URL and list/rename tags. Agents authenticate
  with personal tokens made on the AI agents page (`#/agents`, linked from the
  header and a dismissible hint under the list), sent as a bearer header or,
  for clients that can't send headers (ChatGPT, claude.ai), in the URL as
  `/mcp/t/<token>`. Only SHA-256 hashes are stored (`convex/apiTokens.ts`);
  every call runs as the token's owner.

- Offline (`src/lib/offline/`): an installable PWA (`vite-plugin-pwa`, app
  shell precached, covers cached as they're seen). The last query results are
  kept per account in IndexedDB; tournament and ranking answers (and starting
  a tournament) go through an outbox in localStorage, online too, and are sent
  in batches to `sync.push`, which is idempotent and skips what no longer
  applies. `overlay.ts` shows waiting changes with the same rules as
  `convex/sync.ts`: **change both together**. Everything else needs a
  connection (`useOnlineMutation`). Raise `VERSION` in `cache.ts` when the
  shape of a cached query changes. The service worker is off in `npm run dev`;
  use `npm run build && npm run preview`.

## Develop

```sh
npm install
npx convex dev   # backend, writes .env.local
npm run dev      # frontend on http://localhost:5173
npm test
```

For Steam imports, get a key at https://steamcommunity.com/dev/apikey and run
`npx convex env set STEAM_API_KEY` (add `--prod` for production).

Make yourself admin (after signing up): `npx convex run admin:grant '{"email":"you@example.com"}'`
(add `--prod` for production).

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`: lint, tests,
`npx convex deploy` (functions to prod, prod URL baked into the build) and
GitHub Pages. `public/CNAME` sets the custom domain.

One-time setup:

1. Create the prod deployment (Convex dashboard → project → Production) and
   a prod deploy key (Settings → Deploy keys). Add it as the
   `CONVEX_DEPLOY_KEY` repository secret.
2. Prod env for Convex Auth: `JWT_PRIVATE_KEY`, `JWKS` (own keys, not dev's;
   `npx @convex-dev/auth --prod` generates them) and
   `SITE_URL=https://fomo.lessismore.studio`.
3. GitHub → Settings → Pages → Source: GitHub Actions; custom domain
   `fomo.lessismore.studio` (DNS: CNAME `fomo` → `pierd.github.io`).
