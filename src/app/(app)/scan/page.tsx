import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { ScanCapture } from "@/components/app/scan-capture";

export const metadata: Metadata = { title: "Scan meal" };

export default function ScanPage() {
  return (
    <>
      <h1 className="label-num mb-1 text-[32px]">Scan a meal</h1>
      <p className="mb-6 text-ink-soft">One photo works. Two angles help with portion size.</p>
      <PageShell>{() => <ScanCapture />}</PageShell>
    </>
  );
}
