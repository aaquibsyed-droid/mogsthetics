# Next steps — from local to live

Run `npm run doctor` after each step; it checks every integration and tells you what's still missing.

## 0. Free AI (pick one — $0)

**A. Ollama — runs on your Mac, private, no account** (16 GB RAM is enough):

1. Install from ollama.com and open it.
2. `ollama pull qwen2.5vl:7b` (~6 GB download, once).
3. In `.env.local`: `AI_PROVIDER=ollama`
4. `npm run doctor` → "Ollama ✓", then `npm run analyze -- lunch.jpg`. Expect 20–90 s per photo on a laptop.

**B. Google Gemini free tier — faster, cloud** (free key, daily limits; on the free tier Google may use inputs to improve
its products, so prefer Ollama for private photos):

1. Get a key at aistudio.google.com/apikey.
2. In `.env.local`: `AI_PROVIDER=gemini` and `GEMINI_API_KEY=...`
3. `npm run doctor`, then `npm run analyze -- lunch.jpg`.

Both power photo scanning, the coach and AI meal ideas. Restart `npm run dev` after changing `.env.local`.

## 1. Paid alternative: Claude (≈10 minutes)

1. Create an API key at console.anthropic.com → **API keys** (add billing). Each analysis makes two vision calls; with
   `claude-opus-5-5` expect very roughly $0.05–0.20 per meal (estimate) — `npm run analyze` prints the exact token cost.
2. Add it to `.env.local` (never commit it):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   AI_PROVIDER=anthropic
   ```
3. `npm run doctor` → "AI (Claude) ✓ key valid; model … available" (this check uses no tokens).
4. Try real meals from the terminal:
   ```bash
   npm run analyze -- ~/Pictures/lunch.jpg
   npm run analyze -- plate-top.jpg plate-side.jpg --note "cooked in butter"
   ```
5. Run the live provider tests: `INTEGRATION_MEAL_PHOTO=~/Pictures/lunch.jpg npm run test:integration`.
6. Restart `npm run dev` — the "development mock" banners disappear and the Scan page uses Claude.

## 2. Supabase staging (≈20 minutes)

1. supabase.com → New project (pick the region nearest your users). Save the database password.
2. Push the schema:
   ```bash
   npx supabase login
   npx supabase init            # only if supabase/config.toml doesn't exist
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Create `.env.staging.local` (or edit `.env.local`) with:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `DATABASE_URL` (Database → Connection pooling → **transaction**, port 6543), `APP_URL=http://localhost:3000`,
   and remove `NUTRILENS_BACKEND=local`.
4. Auth → URL configuration: Site URL = `APP_URL`; Redirect URLs += `<APP_URL>/auth/confirm`.
5. `npm run doctor` should show Migrations ✓, Storage ✓ (private bucket), Connection pooling ✓.
6. `npm run dev`, sign up (confirm the email), onboard, scan a meal, check the meal and photo appear in Supabase.

## 3. Deploy to Vercel

Follow `docs/DEPLOYMENT.md`. Add `CRON_SECRET` (`openssl rand -hex 24`) and `SESSION_SECRET`
(`openssl rand -base64 48`). After deploying, open `/api/health`.

## 4. Measure accuracy before marketing it

1. Copy `eval/datasets/TEMPLATE.manifest.json` → `eval/datasets/weighed-v1.manifest.json`.
2. For 50–100 meals: weigh each component, photograph, record grams and the matching food (`usda_sr:<fdcId>` — find
   ids in `src/data/usda-reference-foods.json`), compute totals.
3. `npm run eval -- --manifest eval/datasets/weighed-v1.manifest.json` and commit the results file.
4. Compare models (`AI_VISION_MODEL=claude-sonnet-5-5 npm run eval -- …`) on the same set before changing the default.

## 5. Later

Email provider for reminders/weekly summary, billing (Stripe → `subscriptions` table), and analysing
`analysis_feedback` corrections to find systematic portion bias.

## Letting Claude Code do steps 2–3 for you

Authorise the **Supabase** and **Vercel** connectors (Claude Code `/mcp`, or claude.ai connector settings). With them
connected, Claude can create the project, push migrations, set environment variables and deploy; you'll still add the
Anthropic key yourself.
