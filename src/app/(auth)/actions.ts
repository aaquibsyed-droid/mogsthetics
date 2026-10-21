"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signInWithPassword, signOutCurrent, signUpWithPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/server/api";
import { isAppError } from "@/lib/errors";

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

export type AuthFormState = { error?: string; info?: string; email?: string };

async function limit(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  try {
    await enforceRateLimit(ip, { bucket: "auth", limit: Number(process.env.AUTH_RATE_LIMIT_PER_5MIN) || 10, windowSeconds: 300 });
    return null;
  } catch (e) {
    if (isAppError(e)) return e.message;
    console.error("[auth] rate limit check failed:", e instanceof Error ? e.message : e);
    return "Please try again later.";
  }
}

export async function signUpAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };
  const limited = await limit();
  if (limited) return { error: limited };
  if (form.get("consent") !== "on") return { error: "Please confirm you've read how your data is used.", email: parsed.data.email };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const res = await signUpWithPassword(parsed.data.email, parsed.data.password, origin);
  if (!res.ok) return { error: res.error, email: parsed.data.email };
  if (res.needsConfirmation) return { info: "Check your inbox to confirm your email, then sign in.", email: parsed.data.email };
  redirect("/onboarding");
}

export async function signInAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Email or password is incorrect.", email: String(form.get("email") ?? "") };
  const limited = await limit();
  if (limited) return { error: limited };
  const res = await signInWithPassword(parsed.data.email, parsed.data.password);
  if (!res.ok) return { error: res.error, email: parsed.data.email };
  redirect("/home");
}

export async function signOutAction(): Promise<void> {
  await signOutCurrent();
}
