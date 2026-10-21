import type { Metadata } from "next";
import { AnalysisReview } from "@/components/app/analysis-review";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Review analysis" };

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <h1 className="label-num mb-6 text-[32px]">Review your meal</h1>
      <PageShell>
        {async ({ profile }) => {
          const { id } = await params;
          return <AnalysisReview analysisId={id} timeZone={profile.timezone} />;
        }}
      </PageShell>
    </>
  );
}
