import "server-only";
import { z } from "zod";
import { COACH_SYSTEM, FOOD_TEXT_SYSTEM, IDENTIFY_SYSTEM, MEAL_IDEAS_SYSTEM, PORTIONS_SYSTEM, identifyUserPrompt, portionsUserPrompt } from "./prompts";
import { AiError, withRetry, type AiUsage, type ImageInput, type TextProvider, type VisionProvider } from "./provider";
import { FoodTextEstimateSchema, MealIdeaSchema, PortionEstimationSchema, VisionIdentificationSchema } from "./schemas";

/**
 * Free AI via any OpenAI-compatible chat endpoint:
 *  - Ollama (local, $0, private):  AI_BASE_URL=http://localhost:11434/v1  AI_VISION_MODEL=qwen2.5vl:7b
 *  - Google Gemini free tier:      AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_VISION_MODEL=gemini-3.5-flash
 * Outputs are requested as JSON schema and always re-validated with Zod.
 */
export function createOpenAICompatibleProviders(opts: {
  baseUrl: string;
  apiKey?: string;
  visionModel: string;
  textModel: string;
  timeoutMs: number;
  label: string;
  /** Provider-specific request fields, e.g. Gemini `reasoning_effort`. */
  extraBody?: Record<string, unknown>;
  /** Tried in order when a model is busy or unavailable (503/404). */
  fallbackModels?: string[];
}): {
  vision: VisionProvider;
  text: TextProvider;
} {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;

  async function chat(
    operation: string,
    model: string,
    messages: unknown[],
    schema?: z.ZodType,
  ): Promise<{ content: string; usage: AiUsage }> {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          ...opts.extraBody,
          ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "result", schema: z.toJSONSchema(schema) } } } : {}),
        }),
      });
      if (res.status === 429) throw new AiError("rate_limited", "Lots of people are scanning right now. Give it a minute and try again.", true);
      const next = opts.fallbackModels?.[opts.fallbackModels.indexOf(model) + 1];
      if ((res.status === 503 || res.status === 404) && next) {
        clearTimeout(timer);
        return chat(operation, next, messages, schema);
      }
      if (res.status === 503) throw new AiError("unavailable", "Lots of people are scanning right now. Give it a minute and try again.", true);
      if (!res.ok) throw new AiError("unavailable", `AI provider responded ${res.status}.`, res.status >= 500);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: body.choices?.[0]?.message?.content ?? "",
        usage: {
          provider: opts.label,
          model,
          operation,
          inputTokens: body.usage?.prompt_tokens ?? null,
          outputTokens: body.usage?.completion_tokens ?? null,
          latencyMs: Date.now() - started,
          estimatedCostUsd: 0,
        },
      };
    } catch (e) {
      if (e instanceof AiError) throw e;
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new AiError(
        aborted ? "timeout" : "unavailable",
        aborted ? "That took longer than expected. Please try again." : "We couldn't reach photo scanning. Check your connection and try again.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function structured<S extends z.ZodType>(operation: string, model: string, system: string, content: unknown[], schema: S) {
    return withRetry(
      async () => {
        const { content: text, usage } = await chat(
          operation,
          model,
          [
            { role: "system", content: system },
            { role: "user", content },
          ],
          schema,
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        } catch {
          throw new AiError("invalid_output", "The AI response wasn't valid JSON.", true, usage);
        }
        const r = schema.safeParse(parsed);
        if (!r.success) throw new AiError("invalid_output", "The AI response did not match the expected format.", true, usage);
        return { result: r.data as z.infer<S>, usage };
      },
      {
        retries: 1,
        baseDelayMs: 500,
        isRetryable: (e) => e instanceof AiError && (e.code === "invalid_output" || (e.code === "unavailable" && e.retryable)),
      },
    );
  }

  const images = (imgs: ImageInput[]) =>
    imgs.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.base64}` } }));

  const vision: VisionProvider = {
    id: opts.label,
    model: opts.visionModel,
    isMock: false,
    identify: ({ images: imgs, mealType, note }) =>
      structured(
        "vision.identify",
        opts.visionModel,
        IDENTIFY_SYSTEM,
        [...images(imgs), { type: "text", text: identifyUserPrompt({ mealType, note, imageCount: imgs.length }) }],
        VisionIdentificationSchema,
      ),
    estimatePortions: ({ images: imgs, items, knownWeights, referenceObject, note }) =>
      structured(
        "vision.portions",
        opts.visionModel,
        PORTIONS_SYSTEM,
        [
          ...images(imgs),
          {
            type: "text",
            text: portionsUserPrompt({
              itemsJson: JSON.stringify(
                items.map((i) => ({
                  id: i.id,
                  name: i.displayName,
                  state: i.state,
                  components: i.isComposite ? i.components.map((c) => c.name) : [],
                })),
              ),
              knownWeights,
              referenceObject,
              note,
            }),
          },
        ],
        PortionEstimationSchema,
      ),
  };

  const text: TextProvider = {
    id: opts.label,
    model: opts.textModel,
    isMock: false,
    async coachReply({ contextJson, history, message }) {
      const { content, usage } = await chat("coach.reply", opts.textModel, [
        { role: "system", content: COACH_SYSTEM },
        ...history,
        { role: "user", content: `<user_data>${contextJson}</user_data>\n\n${message}` },
      ]);
      if (!content.trim()) throw new AiError("invalid_output", "The coach returned an empty reply.", true, usage);
      return { text: content.trim(), usage };
    },
    mealIdeas: ({ catalogJson, requestJson }) =>
      structured(
        "suggestions.ideas",
        opts.textModel,
        MEAL_IDEAS_SYSTEM,
        [
          {
            type: "text",
            text: `<preferences>${catalogJson}</preferences>\n<request>${requestJson}</request>\nPropose 3 meal ideas.`,
          },
        ],
        MealIdeaSchema,
      ),
    estimateFoods: ({ text }) =>
      structured("quicklog.estimate", opts.textModel, FOOD_TEXT_SYSTEM, [{ type: "text", text: `<food_text>${text}</food_text>` }], FoodTextEstimateSchema),
  };
  return { vision, text };
}
