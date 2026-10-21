import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUp() {
  return (
    <>
      <h1 className="label-num text-4xl">Create your account.</h1>
      <p className="mb-8 mt-2 text-ink-soft">Next, a few questions to estimate your energy needs. It takes about two minutes.</p>
      <AuthForm mode="sign-up" />
    </>
  );
}
