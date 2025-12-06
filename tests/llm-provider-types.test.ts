import { describe, it, expect } from "vitest";
import { llmProviderTypes, type LlmProvider } from "@shared/schema";
import { executeLlmCompletion } from "../server/llm-client";
import fetchModule from "node-fetch";
import { vi } from "vitest";

vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return {
    ...actual,
    default: vi.fn(),
  };
});

describe("LLM provider registry", () => {
  it("contains aitunnel as a supported type value", () => {
    expect(llmProviderTypes).toContain("aitunnel");
  });

  it("executes non-stream AITunnel calls via executeLlmCompletion", async () => {
    const aitunnelProvider = {
      providerType: "aitunnel",
      id: "test",
      name: "AITunnel",
      description: null,
      isActive: true,
      isGlobal: false,
      tokenUrl: "https://example.com/token",
      completionUrl: "https://example.com/complete",
      authorizationKey: "basic x",
      scope: "scope",
      model: "model",
      availableModels: [],
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {} as LlmProvider["requestConfig"],
      responseConfig: {} as LlmProvider["responseConfig"],
      workspaceId: "ws",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as LlmProvider;

    const mockedFetch = fetchModule as unknown as { default: ReturnType<typeof vi.fn> };
    mockedFetch.default.mockResolvedValue(
      new fetchModule.Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await executeLlmCompletion(aitunnelProvider, "token", {}, {});
    expect(result.answer).toBe("hello");
    expect(result.usageTokens).toBe(15);
    expect(mockedFetch.default).toHaveBeenCalled();
  });

  it("streams AITunnel responses and aggregates text", async () => {
    const aitunnelProvider = {
      providerType: "aitunnel",
      id: "test",
      name: "AITunnel",
      description: null,
      isActive: true,
      isGlobal: false,
      tokenUrl: "https://example.com/token",
      completionUrl: "https://example.com/complete",
      authorizationKey: "basic x",
      scope: "scope",
      model: "model",
      availableModels: [],
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {} as LlmProvider["requestConfig"],
      responseConfig: {} as LlmProvider["responseConfig"],
      workspaceId: "ws",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as LlmProvider;

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

    const promise = executeLlmCompletion(aitunnelProvider, "token", { stream: true }, { stream: true });
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
});
