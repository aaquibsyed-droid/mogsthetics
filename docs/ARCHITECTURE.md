# Architecture

```
Browser (Next.js App Router, React 19, Tailwind 4, Radix, Recharts)
   │  fetch JSON  (envelope: { ok, data } | { ok:false, error:{code,message} })
   ▼
Route handlers  src/app/api/**        auth → per-user rate limit → Zod validation → service
   │
Services        src/lib/services/*    orchestration, transactions, idempotency, safety rules
   │      ├── Engines      src/lib/nutrition/*   deterministic math (energy, macros, nutrients, trend, adaptive)
   │      ├── AI           src/lib/ai/*          provider interface · Claude adapter · labelled mock · versioned prompts
   │      ├── Analysis     src/lib/analysis/*    image ingestion + staged pipeline
   │      ├── Food data    src/lib/food-data/*   bundled USDA · USDA API · Open Food Facts · matcher · cache
   │      └── Suggestions  src/lib/suggestions/* template engine, allergen exclusion
   │
Repositories    src/lib/repos/*       plain parameterised SQL
   │
Database        src/lib/db/*          withUser(userId) → transaction, SET LOCAL ROLE authenticated, JWT claims ⇒ RLS
                                      withSystem()     → privileged (cache, rate limits, usage, account deletion)
   ├── Supabase Postgres via postgres.js (Supavisor transaction pooler)
   └── PGlite (embedded Postgres) for local dev & tests — same migrations, same RLS
```

## Key decisions

- **One SQL layer, RLS everywhere.** Server code doesn't use the service role for user data: each request runs in a
  transaction as `authenticated` with `request.jwt.claims.sub = userId`, so Postgres RLS is enforced even if application
  code had a bug. Child rows (items, snapshots, ingredients, feedback) must reference a parent owned by the same user.
  Transactions also make multi-step writes (meal + items + snapshots + feedback) atomic — not possible with PostgREST alone.
- **Two backends, one schema.** Supabase in production; PGlite locally and in CI. This makes migrations and RLS testable
  without Docker (`tests/db/*`), and the production postgres.js driver is exercised over the Postgres wire protocol
  (`tests/db/postgres-adapter.test.ts`).
- **Auth**: Supabase Auth (`@supabase/ssr`, JWT verified with `getClaims()`, cookies refreshed in `src/proxy.ts`) or local
  scrypt + HMAC cookie in dev. Pages call `requireUser()` inside `<Suspense>` (Cache Components); route handlers use
  `authed()`.
- **AI is replaceable.** `VisionProvider` / `TextProvider` interfaces; `anthropic.ts` uses structured outputs
  (`output_config.format` with a Zod schema), adaptive thinking defaults, `effort`, server-side refusal fallbacks
  (`fallbacks: "default"`), SDK retries for 429/5xx plus one retry for invalid output, and typed errors. Every output is
  re-validated. Prompts are versioned and stored with each analysis together with model, usage, latency and cost.
- **Model choice.** Default `claude-opus-5-5` for vision and coaching, configurable per role via env. Do not assume a newer
  or larger model estimates portions better — run `npm run eval` on your own weighed meals to compare models before
  switching.
- **Background analysis.** `POST /api/analyses` validates, uploads and returns 202; the pipeline runs in `after()` with
  `maxDuration = 300`; the client polls. Stale runs are failed after 6 minutes; failed runs can be retried from the stored
  image.
- **Deduplication & idempotency.** Analyses are keyed by client idempotency key and deduplicated by SHA-256 of the processed
  image + model + prompt version (30 days). Meals are idempotent on `(user_id, idempotency_key)` with a unique constraint as
  the race-proof backstop.
- **Manual logging never depends on AI**: 153 USDA SR Legacy foods are bundled (real values, fdcIds, CC0), so search and
  logging work with no external service.
- **Rate limits / quotas** are Postgres fixed-window counters (no extra infrastructure), per user per route class, plus
  daily quotas for AI features; plan entitlements come from the `subscriptions` table (billing not integrated yet).
- **Branding / providers** are isolated (`src/lib/brand.ts`, provider factories, food-data adapters).

## Data model (summary)

`profiles` · `nutrition_goal_history` (periods; days use the period in effect) · `energy_estimates` · `user_body_metrics` ·
`meals` (local_date stored at write time in the user's timezone) · `meal_items` · `nutrition_snapshots` (immutable;
one current per item) · `food_analyses` · `analysis_feedback` · `food_database_cache` · `user_foods` · `recipes` /
`recipe_ingredients` · `meal_planning_preferences` · `adaptive_suggestions` · `coach_messages` · `ai_usage_events` ·
`subscriptions` · `idempotency_keys` · `rate_limit_counters`. All user tables cascade from `auth.users`.

## API surface

| Purpose                         | Route                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload session (key, limits)    | `POST /api/analyses/session`                                                                                                                   |
| Upload images + start analysis  | `POST /api/analyses` (multipart)                                                                                                               |
| Analysis status / result        | `GET /api/analyses/:id` · retry `POST /api/analyses/:id/retry`                                                                                 |
| Food search / details / barcode | `GET /api/foods/search` · `/api/foods/detail` · `/api/foods/barcode/:code`                                                                     |
| Your foods / frequent foods     | `GET,POST /api/foods/mine` · `DELETE /api/foods/mine/:id` · `GET /api/foods/frequent`                                                          |
| Recalculate (deterministic)     | `POST /api/meals/recalculate`                                                                                                                  |
| Meals                           | `GET,POST /api/meals` · `GET,PATCH,DELETE /api/meals/:id` · `POST /api/meals/:id/copy`                                                         |
| Summaries                       | `GET /api/summary/day` · `GET /api/summary/range`                                                                                              |
| Profile & targets               | `GET,PUT /api/profile` · `PATCH /api/profile/preferences` · `POST /api/targets/preview` · `PUT /api/targets/manual` · `GET /api/goals/history` |
| Weight                          | `GET,POST /api/metrics` · `DELETE /api/metrics/:id`                                                                                            |
| Adaptive targets                | `GET /api/adaptive` · `POST /api/adaptive/:id`                                                                                                 |
| Meal ideas / recipes            | `POST /api/suggestions` · `GET,POST /api/recipes` · `DELETE /api/recipes/:id`                                                                  |
| Coach                           | `GET,POST,DELETE /api/coach` (GET includes the grounded context)                                                                               |
| Export / delete account         | `GET /api/account/export` · `DELETE /api/account`                                                                                              |
| Ops                             | `GET /api/health` · `GET /api/cron/cleanup` (bearer)                                                                                           |
