import type { MealIdeas, PortionEstimation, VisionIdentification } from "./schemas";

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}

export interface AiUsage {
  provider: string;
  model: string;
  operation: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number | null;
}

export type AiErrorCode = "timeout" | "refusal" | "invalid_output" | "rate_limited" | "unavailable" | "truncated" | "bad_request";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface VisionProvider {
  readonly id: string;
  readonly model: string;
  readonly isMock: boolean;
  identify(input: { images: ImageInput[]; mealType?: string; note?: string }): Promise<{ result: VisionIdentification; usage: AiUsage }>;
  estimatePortions(input: {
    images: ImageInput[];
    items: VisionIdentification["items"];
    knownWeights?: Array<{ name: string; grams: number }>;
    referenceObject?: string;
    note?: string;
  }): Promise<{ result: PortionEstimation; usage: AiUsage }>;
}

export interface TextProvider {
  readonly id: string;
  readonly model: string;
  readonly isMock: boolean;
  coachReply(input: {
    contextJson: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    message: string;
  }): Promise<{ text: string; usage: AiUsage }>;
  mealIdeas(input: { catalogJson: string; requestJson: string }): Promise<{ result: MealIdeas; usage: AiUsage }>;
}

/** USD per million tokens (input, output). Update when pricing changes. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export function estimateCost(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const p = MODEL_PRICING[model];
  if (!p || inputTokens === null || outputTokens === null) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Retries retryable failures with exponential backoff and jitter. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; baseDelayMs: number; isRetryable: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries || !opts.isRetryable(err)) throw err;
      const delay = opts.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await sleep(delay);
    }
  }
  throw lastErr;
}
