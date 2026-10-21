import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <>
      <h1 className="label-num text-4xl">Welcome back.</h1>
      <p className="mb-8 mt-2 text-ink-soft">Sign in to see today&apos;s log.</p>
      <Suspense fallback={<AuthForm mode="sign-in" />}>
        <SignInForm searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SignInForm({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthForm
      mode="sign-in"
      notice={error === "confirm" ? "That confirmation link is invalid or expired. Sign in or request a new link." : undefined}
    />
  );
}
