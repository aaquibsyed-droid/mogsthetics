import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { ProgressView } from "@/components/app/progress-view";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return <PageShell>{({ units, today }) => <ProgressView units={units} today={today} />}</PageShell>;
}
