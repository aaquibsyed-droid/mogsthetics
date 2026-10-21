import type { Metadata } from "next";
import { HomeDashboard } from "@/components/app/home-dashboard";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return <PageShell>{({ profile, today, units }) => <HomeDashboard name={profile.displayName} units={units} today={today} />}</PageShell>;
}
