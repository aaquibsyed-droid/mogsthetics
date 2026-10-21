"use client";

import { useRouter } from "next/navigation";
import { QuickLog } from "./quick-log";

export function QuickLogRedirect({ date }: { date: string }) {
  const router = useRouter();
  return <QuickLog today={date} onLogged={() => router.push(`/diary?date=${date}`)} />;
}
