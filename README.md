# FOMO

Everything you want to read, watch and play, and a tournament to pick what's
next. Live at https://fomo.lessismore.studio.

- Frontend: React + TypeScript + Vite + Tailwind (`src/`), hash routes.
- Backend: Convex (`convex/`), Convex Auth with email + password.
- AI (title clean-up, time estimates, reading rough notes) goes through the
  Convex AI Gateway (`convex/ai.ts`, `convex/imports.ts`). Locked per account;
  an admin unlocks it on the Admin page.
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

## Develop

```sh
npm install
npx convex dev   # backend, writes .env.local
npm run dev      # frontend on http://localhost:5173
npm test
```

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
