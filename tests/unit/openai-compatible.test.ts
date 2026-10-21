import { afterEach, expect, it, vi } from "vitest";
import { createOpenAICompatibleProviders } from "@/lib/ai/openai-compatible";
import { createMockProviders } from "@/lib/ai/mock";

afterEach(() => vi.unstubAllGlobals());
const make = () => createOpenAICompatibleProviders({ baseUrl: "http://localhost:11434/v1", visionModel: "qwen2.5vl:7b", textModel: "qwen2.5vl:7b", timeoutMs: 5000, label: "ollama" });

it("sends images + JSON schema and validates the reply (free provider, $0)", async () => {
  const v = (await createMockProviders().vision.identify({ images: [] })).result;
  const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[1].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(v) + "\n```" } }], usage: { prompt_tokens: 900, completion_tokens: 200 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await make().vision.identify({ images: [{ mediaType: "image/jpeg", base64: "AAAA" }] });
  expect(out.result.items).toHaveLength(3);
  expect(out.usage).toMatchObject({ provider: "ollama", estimatedCostUsd: 0 });
});

it("reports a clear error when the local model isn't running", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
  await expect(make().vision.identify({ images: [] })).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/couldn.t reach/) });
});

it("rejects malformed output instead of guessing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"nope":1}' } }] }))));
  await expect(make().vision.identify({ images: [] })).rejects.toMatchObject({ code: "invalid_output" });
});
