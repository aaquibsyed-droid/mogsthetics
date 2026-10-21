import type { Metadata } from "next";
import { MealDetail } from "@/components/app/meal-detail";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Meal" };

export default function MealPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell>
      {async ({ today }) => {
        const { id } = await params;
        return <MealDetail mealId={id} today={today} />;
      }}
    </PageShell>
  );
}
