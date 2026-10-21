import type { Metadata } from "next";
import { PageShell } from "@/components/app/page-shell";
import { SettingsView } from "@/components/app/settings-view";
import { getSubscription } from "@/lib/repos/misc";
import { getServices } from "@/lib/server/context";
import { analysisQuota } from "@/lib/services/analysis";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <PageShell>
      {async ({ userId }) => {
        const { db } = await getServices();
        const [sub, quota] = await Promise.all([db.withUser(userId, (q) => getSubscription(q, userId)), analysisQuota(userId)]);
        return <SettingsView plan={sub?.plan ?? "free"} analysesPerDay={quota.limit} />;
      }}
    </PageShell>
  );
}
