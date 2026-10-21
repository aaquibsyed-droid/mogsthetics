import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { COACH_SYSTEM, IDENTIFY_SYSTEM, MEAL_IDEAS_SYSTEM, PORTIONS_SYSTEM, identifyUserPrompt, portionsUserPrompt } from "./prompts";
import { AiError, estimateCost, withRetry, type AiUsage, type ImageInput, type TextProvider, type VisionProvider } from "./provider";
import { MealIdeaSchema, PortionEstimationSchema, VisionIdentificationSchema } from "./schemas";

/**
 * Claude adapter. Structured outputs are requested with a Zod schema and then
 * re-validated. Server-side refusal fallbacks are enabled ("default" routing).
 * The SDK retries 408/409/429/5xx and connection errors (maxRetries); we add one
 * retry for outputs that fail validation.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function mapError(err: unknown, usage?: AiUsage): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "The AI provider timed out.", true, usage);
  if (err instanceof Anthropic.RateLimitError)
    return new AiError("rate_limited", "The AI provider is rate limiting requests.", true, usage);
  if (err instanceof Anthropic.BadRequestError) return new AiError("bad_request", "The AI request was rejected.", false, usage);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new AiError("unavailable", "The AI provider credentials were rejected.", false, usage);
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError)
    return new AiError("unavailable", "The AI provider is unavailable.", true, usage);
  if (err instanceof Anthropic.APIError)
    return new AiError("unavailable", `AI provider error (${err.status ?? "unknown"}).`, (err.status ?? 500) >= 500, usage);
  return new AiError("unavailable", err instanceof Error ? err.message : "AI request failed.", false, usage);
}

function imageBlocks(images: ImageInput[]) {
  return images.map((img) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
  }));
}

export function createAnthropicProviders(opts: {
  apiKey: string;
  visionModel: string;
  textModel: string;
  timeoutMs: number;
  /** Test hooks. */
  fetch?: typeof fetch;
  maxRetries?: number;
}): {
  vision: VisionProvider;
  text: TextProvider;
} {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: opts.maxRetries ?? 2, fetch: opts.fetch });

  async function structured<S extends z.ZodType>(args: {
    operation: string;
    model: string;
    system: string;
    content: Anthropic.Beta.Messages.BetaContentBlockParam[];
    schema: S;
    effort: "low" | "medium" | "high";
    maxTokens: number;
  }): Promise<{ result: z.infer<S>; usage: AiUsage }> {
    return withRetry(
      async () => {
        const started = Date.now();
        let usage: AiUsage | undefined;
        try {
          const message = await client.beta.messages.parse({
            model: args.model,
            max_tokens: args.maxTokens,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
            system: args.system,
            messages: [{ role: "user", content: args.content }],
            output_config: { format: betaZodOutputFormat(args.schema), effort: args.effort },
          });
          usage = {
            provider: "anthropic",
            model: message.model,
            operation: args.operation,
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            latencyMs: Date.now() - started,
            estimatedCostUsd: estimateCost(args.model, message.usage.input_tokens, message.usage.output_tokens),
          };
          if (message.stop_reason === "refusal")
            throw new AiError("refusal", "The AI model declined to analyze this request.", false, usage);
          if (message.stop_reason === "max_tokens") throw new AiError("truncated", "The AI response was cut off.", true, usage);
          const parsed = args.schema.safeParse(message.parsed_output);
          if (!parsed.success) throw new AiError("invalid_output", "The AI response did not match the expected format.", true, usage);
          return { result: parsed.data, usage };
        } catch (err) {
          // Non-API errors thrown by parse() are output-validation failures (schema mismatch / bad JSON).
          if (!(err instanceof AiError) && !(err instanceof Anthropic.APIError)) {
            throw new AiError("invalid_output", "The AI response did not match the expected format.", true, usage);
          }
          throw mapError(
            err,
            usage ?? {
              provider: "anthropic",
              model: args.model,
              operation: args.operation,
              inputTokens: null,
              outputTokens: null,
              latencyMs: Date.now() - started,
              estimatedCostUsd: null,
            },
          );
        }
      },
      { retries: 1, baseDelayMs: 800, isRetryable: (e) => e instanceof AiError && (e.code === "invalid_output" || e.code === "truncated") },
    );
  }

  const vision: VisionProvider = {
    id: "anthropic",
    model: opts.visionModel,
    isMock: false,
    identify: ({ images, mealType, note }) =>
      structured({
        operation: "vision.identify",
        model: opts.visionModel,
        system: IDENTIFY_SYSTEM,
        content: [...imageBlocks(images), { type: "text", text: identifyUserPrompt({ mealType, note, imageCount: images.length }) }],
        schema: VisionIdentificationSchema,
        effort: "medium",
        maxTokens: 16000,
      }),
    estimatePortions: ({ images, items, knownWeights, referenceObject, note }) =>
      structured({
        operation: "vision.portions",
        model: opts.visionModel,
        system: PORTIONS_SYSTEM,
        content: [
          ...imageBlocks(images),
          {
            type: "text",
            text: portionsUserPrompt({
              itemsJson: JSON.stringify(
                items.map((i) => ({
                  id: i.id,
                  name: i.displayName,
                  state: i.state,
                  preparation: i.preparationMethod,
                  components: i.isComposite ? i.components.map((c) => c.name) : [],
                })),
              ),
              knownWeights,
              referenceObject,
              note,
            }),
          },
        ],
        schema: PortionEstimationSchema,
        effort: "medium",
        maxTokens: 16000,
      }),
  };

  const text: TextProvider = {
    id: "anthropic",
    model: opts.textModel,
    isMock: false,
    async coachReply({ contextJson, history, message }) {
      const started = Date.now();
      try {
        const res = await client.beta.messages.create({
          model: opts.textModel,
          max_tokens: 4000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          system: [{ type: "text", text: COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: "user", content: `<user_data>${contextJson}</user_data>\n\n${message}` },
          ],
          output_config: { effort: "low" },
        });
        const usage: AiUsage = {
          provider: "anthropic",
          model: res.model,
          operation: "coach.reply",
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          latencyMs: Date.now() - started,
          estimatedCostUsd: estimateCost(opts.textModel, res.usage.input_tokens, res.usage.output_tokens),
        };
        if (res.stop_reason === "refusal") throw new AiError("refusal", "The coach couldn't answer that request.", false, usage);
        const textOut = res.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (!textOut) throw new AiError("invalid_output", "The coach returned an empty reply.", true, usage);
        return { text: textOut, usage };
      } catch (err) {
        throw mapError(err);
      }
    },
    mealIdeas: ({ catalogJson, requestJson }) =>
      structured({
        operation: "suggestions.ideas",
        model: opts.textModel,
        system: MEAL_IDEAS_SYSTEM,
        content: [
          {
            type: "text",
            text: `<ingredient_catalog>${catalogJson}</ingredient_catalog>\n<request>${requestJson}</request>\nPropose 3 meal ideas.`,
          },
        ],
        schema: MealIdeaSchema,
        effort: "low",
        maxTokens: 8000,
      }),
  };

  return { vision, text };
}
