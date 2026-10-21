/**
 * Readiness check for every integration. Prints what works, what's missing and
 * the next action. Never prints secret values; never spends AI tokens.
 *
 *   npm run doctor
 */
import "./load-env";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";

type Status = "ok" | "warn" | "fail" | "skip";
const rows: Array<{ area: string; status: Status; detail: string; next?: string }> = [];
const add = (area: string, status: Status, detail: string, next?: string) => rows.push({ area, status, detail, next });
const env = (k: string) => (process.env[k] ?? "").trim();

async function main() {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const backend = env("NUTRILENS_BACKEND") || (supabaseUrl ? "supabase" : "local");
  add("Backend", "ok", backend === "local" ? "local (embedded Postgres, dev only)" : "supabase");

  // ── Database ────────────────────────────────────────────────────────────
  if (backend === "supabase") {
    const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"].filter(
      (k) =>
        !env(k) &&
        !(k === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && env("NEXT_PUBLIC_SUPABASE_ANON_KEY")) &&
        !(k === "SUPABASE_SECRET_KEY" && env("SUPABASE_SERVICE_ROLE_KEY")),
    );
    if (missing.length)
      add(
        "Supabase config",
        "fail",
        `missing ${missing.join(", ")}`,
        "Copy them from Supabase → Project settings (API keys, Database → Connection pooling, port 6543).",
      );
    else add("Supabase config", "ok", "all variables present");

    if (env("DATABASE_URL")) {
      const sql = postgres(env("DATABASE_URL"), { prepare: false, max: 1, connect_timeout: 10 });
      try {
        await sql`select 1`;
        const tables = await sql<{ n: number; rls: number }[]>`
          select count(*)::int as n, count(*) filter (where rowsecurity)::int as rls
          from pg_tables where schemaname = 'public' and tablename in (
            'profiles','meals','meal_items','nutrition_snapshots','nutrition_goal_history','food_analyses','user_body_metrics')`;
        if (tables[0].n < 7)
          add(
            "Migrations",
            "fail",
            `core tables missing (${tables[0].n}/7)`,
            "Run: npx supabase link --project-ref <ref> && npx supabase db push",
          );
        else if (tables[0].rls < 7)
          add("Migrations", "fail", "Row Level Security not enabled on all core tables", "Re-run npx supabase db push");
        else add("Migrations", "ok", "core tables present with RLS");
        const pooled = /:6543\//.test(env("DATABASE_URL"));
        add(
          "Connection pooling",
          pooled ? "ok" : "warn",
          pooled ? "transaction pooler" : "not the transaction pooler (port 6543)",
          pooled ? undefined : "On Vercel use the Supavisor transaction pooler URL.",
        );
      } catch (e) {
        add("Database", "fail", `cannot connect: ${(e as Error).message}`, "Check DATABASE_URL (password, host, pooler port 6543).");
      } finally {
        await sql.end({ timeout: 2 });
      }
    }

    const secret = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && secret) {
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const admin = createClient(supabaseUrl, secret, { auth: { persistSession: false } });
        const { data, error } = await admin.storage.getBucket(env("SUPABASE_STORAGE_BUCKET") || "meal-images");
        if (error || !data)
          add(
            "Storage",
            "fail",
            "bucket 'meal-images' not found",
            "It is created by migration …300_storage.sql — run npx supabase db push.",
          );
        else add("Storage", data.public ? "fail" : "ok", data.public ? "bucket is PUBLIC — it must be private" : "private bucket present");
      } catch (e) {
        add("Storage", "fail", (e as Error).message);
      }
    }
    if (!env("APP_URL"))
      add("Auth redirects", "warn", "APP_URL not set", "Set APP_URL and add <APP_URL>/auth/confirm to Supabase Auth → Redirect URLs.");
  } else {
    add(
      "Database",
      "ok",
      `embedded Postgres at ${env("LOCAL_DATA_DIR") || ".data/local"}`,
      "For production: create a Supabase project (see docs/NEXT-STEPS.md step 2).",
    );
  }

  // ── AI ──────────────────────────────────────────────────────────────────
  const provider = env("AI_PROVIDER") || (env("GEMINI_API_KEY") ? "gemini" : env("ANTHROPIC_API_KEY") ? "anthropic" : "mock");
  add(
    "AI provider",
    provider === "mock" ? "warn" : "ok",
    provider,
    provider === "mock" ? "Free options: Ollama (local) or a Gemini key — see docs/NEXT-STEPS.md." : undefined,
  );
  if (provider === "ollama") {
    const base = (env("AI_BASE_URL") || "http://localhost:11434/v1").replace(/\/v1\/?$/, "");
    const model = env("AI_VISION_MODEL") || "qwen2.5vl:7b";
    try {
      const tags = (await (await fetch(`${base}/api/tags`)).json()) as { models?: Array<{ name: string }> };
      const has = tags.models?.some((m) => m.name === model || m.name === `${model}:latest`);
      add(
        "Ollama",
        has ? "ok" : "fail",
        has ? `running, ${model} installed ($0)` : `running, but ${model} not installed`,
        has ? undefined : `Run: ollama pull ${model}`,
      );
    } catch {
      add("Ollama", "fail", "not reachable on localhost:11434", "Install from ollama.com, open the app, then: ollama pull qwen2.5vl:7b");
    }
  }
  if (provider === "gemini") {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env("GEMINI_API_KEY"))}`);
      add(
        "Gemini",
        r.ok ? "ok" : "fail",
        r.ok ? "key valid (free tier)" : `HTTP ${r.status}`,
        r.ok ? undefined : "Get a free key at aistudio.google.com/apikey",
      );
    } catch (e) {
      add("Gemini", "fail", (e as Error).message);
    }
  }
  const key = env("ANTHROPIC_API_KEY");
  const model = env("AI_VISION_MODEL") || "claude-opus-5-5";
  if (!key && provider !== "anthropic") {
    // Claude is optional when another provider is configured.
  } else if (!key) {
    add(
      "AI (Claude)",
      "warn",
      "ANTHROPIC_API_KEY not set — photo analysis uses the labelled mock in dev and is disabled in production",
      "Create a key at console.anthropic.com → API keys, add it to .env.local, re-run npm run doctor.",
    );
  } else {
    try {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15000 });
      const info = await client.models.retrieve(model);
      add(
        "AI (Claude)",
        "ok",
        `key valid; model ${info.id} available (no tokens used)`,
        "Try a real photo: npm run analyze -- path/to/meal.jpg",
      );
      const coach = env("AI_COACH_MODEL");
      if (coach && coach !== model) {
        await client.models.retrieve(coach);
        add("AI coach model", "ok", `${coach} available`);
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      add(
        "AI (Claude)",
        "fail",
        status === 401 ? "key rejected (401)" : status === 404 ? `model ${model} not available to this key` : (e as Error).message,
        "Check the key and AI_VISION_MODEL.",
      );
    }
  }

  // ── Nutrition data ──────────────────────────────────────────────────────
  const usda = env("USDA_FDC_API_KEY");
  if (!usda)
    add("USDA FoodData Central", "warn", "no key — bundled 153 USDA foods only", "Free key: https://fdc.nal.usda.gov/api-key-signup");
  else {
    try {
      const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usda)}&query=apple&pageSize=1`);
      add(
        "USDA FoodData Central",
        res.ok ? (usda === "DEMO_KEY" ? "warn" : "ok") : "fail",
        res.ok ? (usda === "DEMO_KEY" ? "DEMO_KEY works but is heavily rate-limited" : "key valid") : `HTTP ${res.status}`,
      );
    } catch (e) {
      add("USDA FoodData Central", "fail", (e as Error).message);
    }
  }
  const ua = env("OFF_USER_AGENT");
  add(
    "Open Food Facts",
    ua && !ua.includes("set OFF_USER_AGENT") && !ua.includes("you@example.com") ? "ok" : "warn",
    ua ? "user agent set" : "using default user agent",
    "Set OFF_USER_AGENT to 'YourApp/1.0 (your@email)'.",
  );

  // ── Ops ─────────────────────────────────────────────────────────────────
  add(
    "SESSION_SECRET",
    env("SESSION_SECRET").length >= 32 ? "ok" : backend === "local" ? "warn" : "warn",
    env("SESSION_SECRET").length >= 32 ? "set" : "not set (dev default used locally)",
    "Generate: openssl rand -base64 48",
  );
  add(
    "CRON_SECRET",
    env("CRON_SECRET").length >= 16 ? "ok" : "warn",
    env("CRON_SECRET") ? "set" : "not set — photo-retention cleanup won't run",
    "Generate: openssl rand -hex 24, add to Vercel env.",
  );

  const icon: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗", skip: "-" };
  console.log("\nAscend readiness\n");
  for (const r of rows) {
    console.log(`  ${icon[r.status]}  ${r.area.padEnd(24)} ${r.detail}`);
    if (r.next && r.status !== "ok") console.log(`     ${"".padEnd(24)} → ${r.next}`);
  }
  const fails = rows.filter((r) => r.status === "fail").length;
  console.log(`\n${fails ? `${fails} problem(s) to fix.` : "No blocking problems."}\n`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
