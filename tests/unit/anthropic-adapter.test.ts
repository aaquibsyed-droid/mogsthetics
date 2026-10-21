/** Offline tests of the Claude adapter wiring (request shape, parsing, failures) using an injected fetch. */
import { describe, expect, it } from "vitest";
import { createAnthropicProviders } from "@/lib/ai/anthropic";
import { createMockProviders } from "@/lib/ai/mock";

async function validVision() {
  return (await createMockProviders().vision.identify({ images: [] })).result;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
}

function message(content: unknown[], stop_reason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

function providers(fetchImpl: typeof fetch) {
  return createAnthropicProviders({
    apiKey: "sk-test",
    visionModel: "claude-opus-5-5",
    textModel: "claude-opus-5-5",
    timeoutMs: 10000,
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

describe("Anthropic adapter", () => {
  it("sends images with structured output, effort and refusal fallbacks, and validates the result", async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const v = await validVision();
    const { vision } = providers((async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return respond(200, message([{ type: "text", text: JSON.stringify(v) }]));
    }) as typeof fetch);
    const out = await vision.identify({ images: [{ mediaType: "image/jpeg", base64: "AAAA" }], note: "cooked in butter" });
    expect(out.result.items).toHaveLength(3);
    expect(out.usage).toMatchObject({ provider: "anthropic", inputTokens: 1200, outputTokens: 300 });
    expect(out.usage.estimatedCostUsd).toBeCloseTo((1200 * 4 + 300 * 20) / 1e6);
    const body = captured!.body as {
      model: string;
      fallbacks: string;
      output_config: { effort: string; format: { type: string } };
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(captured!.url).toContain("/v1/messages");
    expect(captured!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content.at(-1)!.text).toContain("<user_note>cooked in butter</user_note>");
  });

  it("maps refusals to a non-retryable error instead of fabricating output", async () => {
    const { vision } = providers((async () => respond(200, message([], "refusal"))) as typeof fetch);
    await expect(vision.identify({ images: [] })).rejects.toMatchObject({ code: "refusal", retryable: false });
  });

  it("retries once on schema-invalid output, then fails", async () => {
    let calls = 0;
    const { vision } = providers((async () => {
      calls++;
      return respond(200, message([{ type: "text", text: JSON.stringify({ wrong: true }) }]));
    }) as typeof fetch);
    await expect(vision.identify({ images: [] })).rejects.toMatchObject({ code: "invalid_output" });
    expect(calls).toBe(2);
  });

  it("maps rate limits and outages to typed retryable errors", async () => {
    const limited = providers((async () =>
      respond(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } })) as typeof fetch);
    await expect(limited.vision.identify({ images: [] })).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    const down = providers((async () =>
      respond(529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } })) as typeof fetch);
    await expect(down.vision.identify({ images: [] })).rejects.toMatchObject({ retryable: true });
  });
});
