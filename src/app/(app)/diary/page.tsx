import type { Metadata } from "next";
import { DiaryView } from "@/components/app/diary-view";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Diary" };

export default function DiaryPage() {
  return <PageShell>{({ today }) => <DiaryView today={today} />}</PageShell>;
}
