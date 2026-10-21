"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster
        position="top-center"
        closeButton
        toastOptions={{
          classNames: {
            toast: "!rounded-full !border !border-rule !bg-surface !text-ink !shadow-[var(--shadow-soft)] !font-sans lowercase",
            description: "!text-ink-soft",
            closeButton: "!bg-surface !border-rule !text-ink-soft",
          },
        }}
      />
    </ThemeProvider>
  );
}
