import "server-only";
import path from "node:path";
import { z } from "zod";

/**
 * Server environment, validated once. Secrets in here must never be imported
 * from client components (`server-only` enforces this at build time).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL_ENV: z.string().optional(),
  APP_URL: z.string().url().optional(),

  /** "supabase" for real deployments; "local" = embedded Postgres + local auth (dev/test only). */
  NUTRILENS_BACKEND: z.enum(["supabase", "local"]).optional(),
  LOCAL_DATA_DIR: z.string().default(".data/local"),
  SESSION_SECRET: z.string().min(32).optional(),

  // Keep only the origin so a pasted ".../rest/v1/" or trailing slash still works.
  NEXT_PUBLIC_SUPABASE_URL: z.string().trim().url().transform((u) => new URL(u).origin).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_SECRET_KEY: z.string().min(10).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  DATABASE_URL: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("meal-images"),

  AI_PROVIDER: z.enum(["anthropic", "ollama", "gemini", "mock", "none"]).optional(),
  AI_BASE_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ALLOW_MOCK_AI: z.enum(["true", "false"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_VISION_MODEL: z.string().optional(),
  AI_COACH_MODEL: z.string().optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(120000),

  USDA_FDC_API_KEY: z.string().optional(),
  OFF_USER_AGENT: z.string().default("Ascend/0.1 (self-hosted; contact: set OFF_USER_AGENT)"),
  ENABLE_EXTERNAL_FOOD_APIS: z.enum(["true", "false"]).default("true"),

  CRON_SECRET: z.string().min(16).optional(),

  // Wearables (optional; each lights up its "Connect" button when set)
  WHOOP_CLIENT_ID: z.string().optional(),
  WHOOP_CLIENT_SECRET: z.string().optional(),
  OURA_CLIENT_ID: z.string().optional(),
  OURA_CLIENT_SECRET: z.string().optional(),

  QUOTA_ANALYSES_PER_DAY: z.coerce.number().int().min(1).default(40),
  QUOTA_COACH_MESSAGES_PER_DAY: z.coerce.number().int().min(1).default(80),
  QUOTA_SUGGESTIONS_PER_DAY: z.coerce.number().int().min(1).default(40),
});

export type ServerEnv = z.infer<typeof schema> & {
  backend: "supabase" | "local";
  aiProvider: "anthropic" | "ollama" | "gemini" | "mock" | "none";
  supabasePublicKey: string | undefined;
  supabaseSecretKey: string | undefined;
  localDataDir: string;
  sessionSecret: string;
};

let cached: ServerEnv | null = null;

const DEV_SESSION_SECRET = "nutrilens-local-development-secret-do-not-use-in-production";

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  const supabasePublicKey = e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseSecretKey = e.SUPABASE_SECRET_KEY ?? e.SUPABASE_SERVICE_ROLE_KEY;
  const backend = e.NUTRILENS_BACKEND ?? (e.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local");

  if (backend === "local" && e.VERCEL_ENV === "production") {
    throw new Error("NUTRILENS_BACKEND=local is a development mode and is refused on production deployments.");
  }
  if (backend === "supabase") {
    const missing = [
      ["NEXT_PUBLIC_SUPABASE_URL", e.NEXT_PUBLIC_SUPABASE_URL],
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", supabasePublicKey],
      ["DATABASE_URL", e.DATABASE_URL],
    ].filter(([, v]) => !v);
    if (missing.length) throw new Error(`Supabase backend requires: ${missing.map(([k]) => k).join(", ")}`);
  }

  let aiProvider = e.AI_PROVIDER ?? (e.GEMINI_API_KEY ? "gemini" : e.ANTHROPIC_API_KEY ? "anthropic" : "mock");
  if (aiProvider === "anthropic" && !e.ANTHROPIC_API_KEY) aiProvider = "none";
  if (aiProvider === "gemini" && !e.GEMINI_API_KEY) aiProvider = "none";
  const mockAllowed = e.ALLOW_MOCK_AI === "true" || (e.ALLOW_MOCK_AI !== "false" && e.VERCEL_ENV !== "production");
  if (aiProvider === "mock" && !mockAllowed) aiProvider = "none";

  let sessionSecret = e.SESSION_SECRET;
  if (!sessionSecret) {
    if (backend === "local" && e.VERCEL_ENV !== "production") sessionSecret = DEV_SESSION_SECRET;
    else sessionSecret = supabaseSecretKey ?? DEV_SESSION_SECRET;
  }

  cached = {
    ...e,
    backend,
    aiProvider,
    supabasePublicKey,
    supabaseSecretKey,
    localDataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), e.LOCAL_DATA_DIR),
    sessionSecret,
  };
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}
