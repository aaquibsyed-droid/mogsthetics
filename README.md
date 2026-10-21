# Mogsthetics

Photo-based calorie and macro estimates you can check and correct, personalised energy targets, food diary, weight trends,
adaptive target suggestions, meal ideas and a coach grounded in your own logs.

- **Core rule:** AI identifies foods and estimates portions. **Every number** (nutrients, BMR/TDEE, targets, totals, trends)
  is calculated by deterministic, unit-tested application code from database records.
- Estimates are always labelled as estimates. Unknown nutrient values stay unknown (never silently zero).

Highlights beyond typical trackers: type-what-you-ate logging ("2 eggs, toast with butter" → USDA-matched foods with
grams, no AI needed), recent foods in every search, one-tap "repeat yesterday's breakfast", water tracking, a gentle weekly
check-in, free barcode scanning, no ads, and verified data only. Visual design: "milk & glaze" — milky neutrals, warm
taupe type, one blush accent (tokens in `src/app/globals.css`).

**Going live:** follow [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md); `npm run doctor` checks each integration and
`npm run analyze -- photo.jpg` runs a real photo through the pipeline from the terminal.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/NUTRITION-METHODS.md`](docs/NUTRITION-METHODS.md),
[`docs/PRIVACY-SECURITY.md`](docs/PRIVACY-SECURITY.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`eval/README.md`](eval/README.md).

## Quick start (local, no accounts needed)

Requirements: Node.js ≥ 20.9 (developed on 24), npm.

```bash
npm install
cp .env.example .env.local        # defaults: local backend + labelled mock AI
npm run dev                       # http://localhost:3000
```

The **local backend** runs the real Supabase migrations in an embedded Postgres (PGlite) with Row Level Security enforced,
plus a local email/password auth and filesystem image storage. It is for development and testing only and is refused on
production deployments.

Optional demo data (stop `npm run dev` first — the embedded database is single-process):

```bash
npm run seed:dev                  # demo@nutrilens.test / nutrilens-demo-pass, 3 weeks of meals + weigh-ins
```

Without `ANTHROPIC_API_KEY`, photo analysis uses a **development mock** that does not look at the photo and returns a fixed
example meal. The UI labels every mock result. Set `ANTHROPIC_API_KEY` for real analysis.

## Scripts

| Command                        | What it does                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Next.js dev server                                                                              |
| `npm run build` / `start`      | Production build / server                                                                       |
| `npm run typecheck`            | `tsc --noEmit` (strict)                                                                         |
| `npm run lint`                 | ESLint (Next.js + React Compiler rules)                                                         |
| `npm run format:check`         | Prettier                                                                                        |
| `npm test`                     | Vitest: engines, pipeline, adapters, **migrations + RLS + services on embedded Postgres**       |
| `npm run test:e2e`             | Playwright: production build, local backend, mock AI (desktop + mobile projects)                |
| `npm run test:integration`     | Live provider checks (USDA, Open Food Facts, Claude) — each skipped unless its env vars are set |
| `npm run eval`                 | Food-photo evaluation harness (see `eval/README.md`)                                            |
| `npm run seed:dev`             | Demo account for the local backend                                                              |
| `npm run data:reference-foods` | Rebuild bundled USDA reference foods from the SR Legacy bulk download                           |

## Environment variables

All variables are documented in [`.env.example`](.env.example). Summary:

| Variable                               | Required for                 | Notes                                                                           |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `NUTRILENS_BACKEND`                    | —                            | `supabase` or `local` (auto: supabase when `NEXT_PUBLIC_SUPABASE_URL` is set)   |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase                     | Project URL                                                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase                     | Publishable/anon key (browser-safe; RLS protects data)                          |
| `SUPABASE_SECRET_KEY`                  | Supabase                     | **Server only.** Image storage + account deletion                               |
| `DATABASE_URL`                         | Supabase                     | Supavisor transaction pooler (port 6543) on serverless                          |
| `SESSION_SECRET`                       | local backend                | 32+ chars; signs local session cookies / image URLs                             |
| `APP_URL`                              | auth emails                  | Public base URL                                                                 |
| `ANTHROPIC_API_KEY`                    | AI analysis, coach, AI ideas | Without it: mock in dev, AI disabled in production (manual logging still works) |
| `AI_VISION_MODEL` / `AI_COACH_MODEL`   | —                            | Default `claude-opus-5-5`                                                       |
| `USDA_FDC_API_KEY`                     | wider food search            | Optional; 153 bundled USDA foods work offline                                   |
| `OFF_USER_AGENT`                       | barcode lookups              | Identify your app per Open Food Facts guidelines                                |
| `CRON_SECRET`                          | scheduled cleanup            | Vercel Cron bearer token for `/api/cron/cleanup`                                |
| `QUOTA_*`                              | —                            | Per-user daily limits (analyses, coach messages, AI ideas)                      |

## Database (Supabase)

Migrations live in `supabase/migrations/` and are applied unchanged to both Supabase and the local embedded Postgres:

1. `…100_core_schema.sql` — 20 tables, constraints, indexes, immutable nutrition snapshots, goal-history periods
2. `…200_row_level_security.sql` — RLS on every table, owner policies, parent-ownership checks, no `anon` access
3. `…300_storage.sql` — private `meal-images` bucket with per-user folder policies

```bash
npx supabase login
npx supabase init                 # once; keeps the existing supabase/migrations
npx supabase link --project-ref <your-project-ref>
npx supabase db push              # applies the migrations
```

Then in the Supabase dashboard: **Auth → URL configuration**: set Site URL to `APP_URL` and add `${APP_URL}/auth/confirm` to
redirect URLs. The migrations are covered by `tests/db/*` (fresh-database apply, RLS isolation, postgres.js driver).

## External accounts

| Service                      | Needed for                      | Cost / limits                                              |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------- |
| Supabase                     | Postgres, Auth, Storage         | Free tier works for development                            |
| Anthropic                    | Photo analysis, coach, AI ideas | Usage-based; per-call cost is tracked in `ai_usage_events` |
| USDA FoodData Central (opt.) | Broader food search             | Free api.data.gov key, 1,000 req/h; results cached         |
| Open Food Facts              | Barcode lookups                 | No key; set a descriptive User-Agent; data is ODbL         |
| Vercel                       | Hosting + daily cleanup cron    | Any plan with cron support                                 |

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short: create the Supabase project and push migrations, set the env vars
in Vercel (Production + Preview), deploy, and confirm `GET /api/health` returns `backend: "supabase"`, `database: "ok"`,
`ai: "anthropic"`.

## Licences & attribution

Nutrition data: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central (public domain, CC0) and
Open Food Facts contributors (ODbL). Mogsthetics provides general information, not medical advice.
