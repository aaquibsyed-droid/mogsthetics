import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { PlanView } from "@/components/app/plan-view";

export const metadata: Metadata = { title: "Meal ideas" };

export default function PlanPage() {
  return <PageShell>{({ today }) => <PlanView today={today} />}</PageShell>;
}
