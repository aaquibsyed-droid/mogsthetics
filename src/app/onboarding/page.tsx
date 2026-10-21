import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ProfileWizard } from "@/components/app/profile-wizard";
import { Skeleton } from "@/components/ui/misc";
import { loadProfileForEdit } from "@/lib/server/profile-loader";

export const metadata: Metadata = { title: "Set up your profile" };

export default function OnboardingPage() {
  return (
    <div className="min-h-dvh px-5 pb-16 pt-6">
      <div className="mx-auto mb-8 max-w-xl">
        <Logo />
      </div>
      <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-xl" />}>
        <Wizard />
      </Suspense>
    </div>
  );
}

async function Wizard() {
  const { profile, weightKg } = await loadProfileForEdit();
  if (profile?.onboardingCompletedAt) redirect("/home");
  return <ProfileWizard initial={profile} initialWeightKg={weightKg} mode="onboarding" />;
}
