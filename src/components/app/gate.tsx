import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEnv } from "@/lib/config/env";
import { getProfile } from "@/lib/repos/profiles";
import { getServices } from "@/lib/server/context";
import { getAiProviders } from "@/lib/ai";

/**
 * Server-side gate for signed-in pages: verifies the session and that
 * onboarding is complete, then renders children. Must sit inside <Suspense>.
 */
export async function AppGate({ children, allowIncomplete = false }: { children: React.ReactNode; allowIncomplete?: boolean }) {
  const user = await requireUser();
  const { db } = await getServices();
  const profile = await db.withUser(user.id, (q) => getProfile(q, user.id));
  if (!allowIncomplete && !profile?.onboardingCompletedAt) redirect("/onboarding");
  const env = getEnv();
  const ai = await getAiProviders();
  return (
    <>
      {ai.status === "mock" || ai.status === "none" ? (
        <p className="mb-4 rounded-lg border border-dashed border-warn/50 bg-warn-bg px-3 py-1.5 font-mono text-[11px] text-warn">
          Development mode{env.backend === "local" ? " · local database & auth" : ""}
          {ai.status === "mock" ? " · photo analysis uses a labelled mock, not real AI" : ""}
          {ai.status === "none" ? " · AI unavailable" : ""}
        </p>
      ) : null}
      {children}
    </>
  );
}
