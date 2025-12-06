import { describe, it, expect, vi, beforeEach } from "vitest";
import fetchModule from "node-fetch";
import { executeLlmCompletion } from "../server/llm-client";
import type { LlmProvider } from "@shared/schema";

vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return {
    ...actual,
    default: vi.fn(),
  };
});

const baseProvider: LlmProvider = {
  id: "prov-aitunnel",
  name: "AITunnel",
  providerType: "aitunnel",
  description: "test",
  isActive: true,
  isGlobal: false,
  tokenUrl: "https://api.aitunnel.ru/v1",
  completionUrl: "https://api.aitunnel.ru/v1/chat/completions",
  authorizationKey: "sk-aitunnel-test",
  scope: "",
  model: "gpt-5.1-chat",
  availableModels: [],
  allowSelfSignedCertificate: false,
  requestHeaders: {},
  requestConfig: {} as LlmProvider["requestConfig"],
  responseConfig: {} as LlmProvider["responseConfig"],
  workspaceId: "ws",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AITunnel gateway integration (mocked HTTP)", () => {
  beforeEach(() => {
    const mockedFetch = fetchModule as unknown as { default: ReturnType<typeof vi.fn> };
    mockedFetch.default.mockReset();
  });

  it("parses non-stream completion with finish_reason and usage", async () => {
    const mockedFetch = fetchModule as unknown as { default: ReturnType<typeof vi.fn> };
    mockedFetch.default.mockResolvedValue(
      new fetchModule.Response(
        JSON.stringify({
          choices: [
            { message: { content: "hello" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await executeLlmCompletion(baseProvider, "token", { messages: [] }, {});
    expect(result.answer).toBe("hello");
    expect(result.usageTokens).toBe(5);
  });

  it("streams delta chunks and aggregates answer", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];

    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    });

    const mockedFetch = fetchModule as unknown as { default: ReturnType<typeof vi.fn> };
    mockedFetch.default.mockResolvedValue(
      new fetchModule.Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const promise = executeLlmCompletion(baseProvider, "token", { stream: true }, { stream: true });
    const iterator = (promise as any).streamIterator as AsyncIterable<{ event: string; data: { text?: string } }>;
    const collected: string[] = [];
    if (iterator) {
      for await (const item of iterator) {
        if (item.data.text) collected.push(item.data.text);
      }
    }
    const result = await promise;
    expect(collected.join("")).toBe("Hello");
    expect(result.answer).toBe("Hello");
  });

  it("propagates provider error on non-200 response", async () => {
    const mockedFetch = fetchModule as unknown as { default: ReturnType<typeof vi.fn> };
    mockedFetch.default.mockResolvedValue(
      new fetchModule.Response(
        JSON.stringify({ error: { message: "unauthorized" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      executeLlmCompletion(baseProvider, "token", { messages: [] }, {}),
    ).rejects.toThrow(/unauthorized/i);
  });
});
