"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { useHydrated } from "@/lib/client/use-hydrated";
import { signInAction, signUpAction, type AuthFormState } from "./actions";

export function AuthForm({ mode, notice }: { mode: "sign-in" | "sign-up"; notice?: string }) {
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(mode === "sign-in" ? signInAction : signUpAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {notice ? <Notice tone="warn">{notice}</Notice> : null}
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.info ? <Notice tone="good">{state.info}</Notice> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "sign-up" ? "At least 8 characters." : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
          minLength={8}
        />
      </Field>
      {mode === "sign-up" ? (
        <label className="flex items-start gap-3 text-sm text-ink-soft">
          <input type="checkbox" name="consent" className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            I understand Ascend stores my profile, logs and (temporarily) meal photos to provide estimates, and that it isn&apos;t
            medical advice. I can export or delete my data at any time.
          </span>
        </label>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || !hydrated}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-ink-soft">
        {mode === "sign-in" ? (
          <>
            New here?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/sign-up">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/sign-in">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
