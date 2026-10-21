import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { RecoveryView } from "@/components/app/recovery-view";

export const metadata: Metadata = { title: "Recovery" };

export default function RecoveryPage() {
  return <PageShell>{() => <RecoveryView />}</PageShell>;
}
