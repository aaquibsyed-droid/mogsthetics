# Privacy, security & responsible design

## Data collected and why

| Data                                   | Why                                 | Notes                                      |
| -------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Age (not birth date), height, weight   | Energy equation                     | Age stored with the date it was given      |
| Sex parameter (or "prefer not to say") | Equation variant                    | Unspecified → averaged, uncertainty shown  |
| Activity, goal, optional evidence      | Activity factor and target          | Optional fields can be skipped             |
| Health situations (optional)           | To _withhold_ inappropriate targets | Changes handling only; never inferred      |
| Meals, weights, preferences            | The product                         | Exportable, deletable                      |
| Meal photos                            | Analysis, meal thumbnail            | Private; retention user-controlled (below) |

Nothing is inferred about the person from photos (prompts forbid it; outputs have no such fields).

## Images

- Re-encoded server-side: EXIF orientation applied, **all metadata (incl. GPS) stripped**, resized ≤ 1568 px.
- Stored in a private bucket at `<userId>/<random>.jpg`; served only via short-lived signed URLs (1 h); local mode uses
  HMAC-signed URLs plus an owner check.
- Retention (Profile → Privacy): delete right after analysis, 30 days (default), or until the meal is deleted. The daily
  cron deletes expired photos and photos from analyses that were never saved (> 1 day). Deleting a meal deletes its photo.
- Only the first photo of a multi-photo capture is stored; others are processed in memory and discarded.
- Photos are sent to the configured AI provider for analysis only. Review the provider's data-retention terms
  (Anthropic API inputs are not used for model training by default) before production use.

## Controls implemented

- Server-side authorisation on every route (`authed()`), plus Postgres RLS on every table (tested). `anon` has no grants.
  System tables are inaccessible to users. Nutrition snapshots are immutable (trigger + column grants).
- Secrets are server-only (`server-only` imports; only `NEXT_PUBLIC_*` reaches the browser).
- Input validation with strict Zod schemas; JSON body limits; multipart size limits; image content validated by decoding.
- Rate limits per user and route class; daily AI quotas; auth endpoints rate-limited per IP.
- Idempotency keys for analyses and meals.
- Security headers: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera self only).
- Errors: typed envelopes, no stack traces or SQL to clients; logs avoid request bodies and personal data.
- Prompt-injection posture: image text and user notes are wrapped and declared as data; model output is schema-validated
  and only ever used as data — it cannot run SQL, call tools or affect authorisation. The coach receives only the user's
  own pre-computed facts.
- Account deletion removes storage objects first, then the auth user (all rows cascade). Data export returns every
  user-owned table as JSON.
- `npm audit --omit=dev --audit-level=high` runs in CI.

## Responsible nutrition guidance

- No targets for minors, pregnancy, breastfeeding, disordered-eating history, or on request (tracking-only mode).
- Safety floors and caps on deficits/surpluses; manual targets below the floor are rejected with an explanation.
- Coach: deterministic crisis/eating-disorder guard returns supportive resources without calling the model; system prompt
  forbids shaming, moralising foods, compensatory fasting or exercise, and clinical prescriptions.
- Meal ideas never suggest skipping meals; when the day's estimate is reached, they say eating to hunger is fine.
- Projections are explicitly uncertain; no body-fat estimation from photos.
