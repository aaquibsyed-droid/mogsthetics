import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getAiProviders } from "@/lib/ai";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db";

/** Liveness + configuration summary (no secrets). */
export async function GET() {
  await connection();
  const env = getEnv();
  let database = "ok";
  try {
    const db = await getDb();
    await db.withSystem((q) => q.query("select 1"));
  } catch {
    database = "error";
  }
  const ai = await getAiProviders();
  return NextResponse.json(
    {
      ok: database === "ok",
      backend: env.backend,
      database,
      ai: ai.status,
      usdaApi: env.USDA_FDC_API_KEY ? "configured" : "bundled_reference_only",
    },
    { status: database === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
