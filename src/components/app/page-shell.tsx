import { Suspense } from "react";
import { AppGate } from "./gate";
import { Skeleton } from "@/components/ui/misc";
import { loadProfileForEdit } from "@/lib/server/profile-loader";
import { toLocalDate } from "@/lib/nutrition/dates";
import type { Profile } from "@/lib/repos/profiles";

export interface PageCtx {
  userId: string;
  email: string | null;
  profile: Profile;
  today: string;
  units: "metric" | "imperial";
  weightKg: number | null;
}

/** Streams a signed-in page: static shell first, then the gated, user-specific content. */
export function PageShell({
  children,
  fallback,
}: {
  children: (ctx: PageCtx) => React.ReactNode | Promise<React.ReactNode>;
  fallback?: React.ReactNode;
}) {
  return (
    <Suspense fallback={fallback ?? <PageSkeleton />}>
      <Gated>{children}</Gated>
    </Suspense>
  );
}

async function Gated({ children }: { children: (ctx: PageCtx) => React.ReactNode | Promise<React.ReactNode> }) {
  const { user, profile, weightKg } = await loadProfileForEdit();
  return (
    <AppGate>
      {profile
        ? await children({
            userId: user.id,
            email: user.email,
            profile,
            today: toLocalDate(new Date(), profile.timezone),
            units: profile.preferredUnits,
            weightKg,
          })
        : null}
    </AppGate>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  );
}
