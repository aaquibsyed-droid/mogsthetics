"use client";

import { uid } from "@/lib/client/uid";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
      headers: opts.form ? undefined : opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network", "You appear to be offline. Check your connection and try again.", 0);
  }
  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError("bad_response", "Unexpected response from the server.", res.status);
  }
  if (!json.ok) {
    if (res.status === 401) leaveSession("/sign-in");
    throw new ApiError(json.error.code, json.error.message, res.status, json.error.details);
  }
  return json.data;
}

const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up"];

/**
 * Full document navigation away from the signed-in app. Used on sign-out, account
 * deletion and expired sessions so no previous user's data survives in client
 * memory (the router keeps recently visited routes alive). No-op on public pages,
 * which avoids redirect loops from background requests.
 */
export function leaveSession(to: string) {
  if (typeof window === "undefined" || PUBLIC_PATHS.includes(window.location.pathname)) return;
  window.location.replace(to);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_failed" && Array.isArray(err.details) && err.details.length) {
      const d = err.details[0] as { path?: string; message?: string };
      return d.message ? `${err.message} ${d.path ? `(${d.path}) ` : ""}${d.message}` : err.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Minimal data hook: fetch on mount / key change, with reload and local mutation. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on key change is the purpose of this hook
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function newIdempotencyKey(): string {
  return uid().replaceAll("-", "");
}
