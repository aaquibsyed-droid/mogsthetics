import type { Metadata } from "next";
import { MealComposer } from "@/components/app/meal-composer";
import { QuickLogRedirect } from "@/components/app/quick-log-redirect";
import { PageShell } from "@/components/app/page-shell";

export const metadata: Metadata = { title: "Log a meal" };

export default function NewMealPage({ searchParams }: { searchParams: Promise<{ date?: string; type?: string }> }) {
  return (
    <>
      <h1 className="label-num mb-6 text-[32px]">Log a meal</h1>
      <PageShell>
        {async ({ today }) => {
          const sp = await searchParams;
          const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
          return (
            <div className="flex flex-col gap-8">
              <QuickLogRedirect date={date} />
              <div>
                <p className="eyebrow mb-3">or build it food by food</p>
                <MealComposer mode="create" defaultDate={date} today={today} defaultMealType={sp.type} />
              </div>
            </div>
          );
        }}
      </PageShell>
    </>
  );
}
