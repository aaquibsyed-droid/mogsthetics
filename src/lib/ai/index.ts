import "server-only";
import { getEnv } from "@/lib/config/env";
import type { TextProvider, VisionProvider } from "./provider";
import { createMockProviders } from "./mock";

export interface AiProviders {
  vision: VisionProvider | null;
  text: TextProvider | null;
  status: "anthropic" | "ollama" | "gemini" | "mock" | "none";
}

let cached: AiProviders | null = null;

/** Resolves configured providers. `null` providers mean AI features are unavailable (manual logging still works). */
export async function getAiProviders(): Promise<AiProviders> {
  if (cached) return cached;
  const env = getEnv();
  if (env.aiProvider === "anthropic" && env.ANTHROPIC_API_KEY) {
    const { createAnthropicProviders } = await import("./anthropic");
    const p = createAnthropicProviders({
      apiKey: env.ANTHROPIC_API_KEY,
      visionModel: env.AI_VISION_MODEL ?? "claude-opus-5-5",
      textModel: env.AI_COACH_MODEL ?? env.AI_VISION_MODEL ?? "claude-opus-5-5",
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    });
    cached = { ...p, status: "anthropic" };
  } else if (env.aiProvider === "ollama" || env.aiProvider === "gemini") {
    const { createOpenAICompatibleProviders } = await import("./openai-compatible");
    const gemini = env.aiProvider === "gemini";
    const visionModel = env.AI_VISION_MODEL ?? (gemini ? "gemini-3.8-flash" : "qwen2.5vl:7b");
    const p = createOpenAICompatibleProviders({
      baseUrl: env.AI_BASE_URL ?? (gemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "http://localhost:11434/v1"),
      apiKey: gemini ? env.GEMINI_API_KEY : undefined,
      visionModel,
      textModel: env.AI_COACH_MODEL ?? visionModel,
      timeoutMs: gemini ? 45000 : Math.max(env.AI_REQUEST_TIMEOUT_MS, 240000),
      extraBody: gemini ? { reasoning_effort: "low" } : undefined,
      label: env.aiProvider,
    });
    cached = { ...p, status: env.aiProvider };
  } else if (env.aiProvider === "mock") {
    cached = { ...createMockProviders(), status: "mock" };
  } else {
    cached = { vision: null, text: null, status: "none" };
  }
  return cached;
}
