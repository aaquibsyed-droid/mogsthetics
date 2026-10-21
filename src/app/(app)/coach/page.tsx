import type { Metadata } from "next";
import { CoachView } from "@/components/app/coach-view";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Coach" };

export default function CoachPage() {
  return <PageShell>{() => <CoachView />}</PageShell>;
}
