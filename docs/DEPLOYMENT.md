# Deployment (Vercel + Supabase)

## 1. Supabase

1. Create a project (choose a region close to your Vercel region).
2. Apply migrations:
   ```bash
   npx supabase login
   npx supabase init            # once, if supabase/config.toml doesn't exist yet
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   This creates all tables, RLS policies and the private `meal-images` bucket with per-user policies.
3. Auth → URL configuration: Site URL = your `APP_URL`; add `https://<your-domain>/auth/confirm` to Redirect URLs.
   (Optional) Auth → Email templates: point the confirmation link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`.
4. Collect: Project URL, publishable (anon) key, secret (service-role) key, and the **transaction pooler** connection
   string (Settings → Database → Connection pooling, port 6543).

## 2. Vercel

1. Import the repository; framework preset Next.js; Node 20+.
2. Environment variables (Production and Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `APP_URL`,
   `ANTHROPIC_API_KEY`, `USDA_FDC_API_KEY` (optional), `OFF_USER_AGENT`, `CRON_SECRET`, `SESSION_SECRET`.
   Do **not** set `NUTRILENS_BACKEND=local` (it is refused when `VERCEL_ENV=production`).
3. Deploy. `vercel.json` schedules `/api/cron/cleanup` daily; Vercel sends `Authorization: Bearer $CRON_SECRET`.
4. Verify: `GET https://<domain>/api/health` → `{"ok":true,"backend":"supabase","database":"ok","ai":"anthropic",…}`.
   Then sign up, complete onboarding, scan a meal.

Notes

- Photo analysis runs in `after()` within the analyses route (`maxDuration = 300`). Plans with shorter limits will mark
  long runs as failed; users can retry or log manually.
- Request bodies are capped (~4.5 MB on Vercel); the client downsizes photos before upload and the server enforces 4 MB.
- Rate limits and caches live in Postgres; no Redis is required.

## Self-hosting

`docker build -t nutrilens . && docker run -p 3000:3000 --env-file .env.production nutrilens` with the same Supabase
variables. Schedule `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/cleanup` daily.

## Rollback / migrations

Migrations are forward-only SQL files. Add new files with a later timestamp; never edit applied ones. Test locally with
`npm test` (applies every migration to a fresh embedded Postgres and runs the RLS suite) before `supabase db push`.
