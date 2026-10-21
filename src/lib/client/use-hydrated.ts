"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during SSR and before hydration, true afterwards. Submit buttons use it
 * so a form can't be submitted natively before its client handler exists
 * (which would either render a blank streamed response or put form fields —
 * possibly personal data — into a GET query string).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
