"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="label-head text-2xl">Something went wrong loading this page.</p>
      <p className="text-ink-soft">Your data is safe. Try again, or go back to the home screen.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => router.push("/home")}>
          Home
        </Button>
      </div>
    </div>
  );
}
