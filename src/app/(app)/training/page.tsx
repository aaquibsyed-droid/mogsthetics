import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { TrainingView } from "@/components/app/training-view";

export const metadata: Metadata = { title: "Training" };

export default function TrainingPage() {
  return <PageShell>{() => <TrainingView />}</PageShell>;
}
