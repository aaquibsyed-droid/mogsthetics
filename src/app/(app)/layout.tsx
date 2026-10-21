import { Suspense } from "react";
import { BottomNav, SideNav } from "@/components/app/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-rule lg:block" />}>
        <SideNav />
      </Suspense>
      <main id="main" className="min-w-0 flex-1 px-4 pb-32 pt-[max(env(safe-area-inset-top),20px)] sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
