import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { ProfileWizard } from "@/components/app/profile-wizard";

export const metadata: Metadata = { title: "Edit profile" };

export default function EditProfilePage() {
  return <PageShell>{({ profile, weightKg }) => <ProfileWizard initial={profile} initialWeightKg={weightKg} mode="edit" />}</PageShell>;
}
