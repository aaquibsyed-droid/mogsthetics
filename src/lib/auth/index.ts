import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { LOCAL_SESSION_COOKIE, LOCAL_SESSION_TTL_S, localSignIn, localSignUp, localUserEmail, signSession, verifySession } from "./local";

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function createSupabaseServerClient() {
  const env = getEnv();
  const { createServerClient } = await import("@supabase/ssr");
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.supabasePublicKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}

/** Verified identity of the current request (memoised per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  await connection(); // identity is always request-time data
  const env = getEnv();
  if (env.backend === "supabase") {
    const supabase = await createSupabaseServerClient();
    // getClaims() verifies the JWT signature (JWKS for asymmetric keys, Auth server otherwise).
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
  }
  const store = await cookies();
  const userId = verifySession(store.get(LOCAL_SESSION_COOKIE)?.value, env.sessionSecret);
  if (!userId) return null;
  const email = await localUserEmail(await getDb(), userId);
  return email ? { id: userId, email } : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

async function setLocalSession(userId: string) {
  const store = await cookies();
  store.set(LOCAL_SESSION_COOKIE, signSession(userId, getEnv().sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.E2E_INSECURE_COOKIES,
    path: "/",
    maxAge: LOCAL_SESSION_TTL_S,
  });
}

export type AuthResult = { ok: true; needsConfirmation?: boolean } | { ok: false; error: string };

export async function signUpWithPassword(email: string, password: string, origin: string): Promise<AuthResult> {
  const env = getEnv();
  if (env.backend === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${env.APP_URL ?? origin}/auth/confirm?next=/onboarding` },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, needsConfirmation: !data.session };
  }
  const res = await localSignUp(await getDb(), email, password);
  if ("error" in res) return { ok: false, error: res.error };
  await setLocalSession(res.id);
  return { ok: true };
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const env = getEnv();
  if (env.backend === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, error: "Email or password is incorrect, or the email isn't confirmed yet." } : { ok: true };
  }
  const res = await localSignIn(await getDb(), email, password);
  if ("error" in res) return { ok: false, error: res.error };
  await setLocalSession(res.id);
  return { ok: true };
}

export async function signOutCurrent(): Promise<void> {
  const env = getEnv();
  if (env.backend === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return;
  }
  (await cookies()).delete(LOCAL_SESSION_COOKIE);
}

/** Permanently deletes the auth user (all user rows cascade). */
export async function deleteAuthAccount(userId: string): Promise<void> {
  const env = getEnv();
  if (env.backend === "supabase") {
    if (!env.supabaseSecretKey) throw new Error("SUPABASE_SECRET_KEY is required to delete accounts.");
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Account deletion failed: ${error.message}`);
    return;
  }
  const db = await getDb();
  await db.withSystem((q) => q.query(`delete from auth.users where id = $1::uuid`, [userId]));
  (await cookies()).delete(LOCAL_SESSION_COOKIE);
}
