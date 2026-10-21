import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth";
import { getEnv } from "@/lib/config/env";

/** Email confirmation / magic-link landing for Supabase Auth (token_hash or PKCE code). */
export async function GET(req: NextRequest) {
  const env = getEnv();
  const next = req.nextUrl.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  if (env.backend !== "supabase") return NextResponse.redirect(new URL(safeNext, req.url));
  const supabase = await createSupabaseServerClient();
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const code = req.nextUrl.searchParams.get("code");
  let error: unknown = null;
  if (tokenHash && type) ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  else if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
  else error = new Error("missing token");
  return NextResponse.redirect(new URL(error ? "/sign-in?error=confirm" : safeNext, req.url));
}
