/* @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React, { useEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { useKnowledgeBaseAskAi } from "@/hooks/useKnowledgeBaseAskAi";
import type { KnowledgeBaseAskAiState, UseKnowledgeBaseAskAiOptions } from "@/hooks/useKnowledgeBaseAskAi";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (value: string) => value,
  },
}));

const BASE_OPTIONS: UseKnowledgeBaseAskAiOptions = {
  knowledgeBaseId: "kb",
  hybrid: { topK: 2, vector: { weight: 0 } },
  llm: { providerId: "llm" },
  baseUrl: "https://example.com",
  workspaceId: "ws",
  collection: null,
  embeddingProviderId: null,
};

const originalFetch = globalThis.fetch;

describe("useKnowledgeBaseAskAi", () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("updates visible answer immediately on streaming delta", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const states: KnowledgeBaseAskAiState[] = [];

    function TestComponent() {
      const hook = useKnowledgeBaseAskAi(BASE_OPTIONS);
      useEffect(() => {
        void hook.ask("Молниеносный ответ?");
      }, [hook.ask]);
      useEffect(() => {
        states.push(hook.state);
      }, [hook.state]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const enqueueEvent = async (chunk: string) => {
      await act(async () => {
        streamController?.enqueue(encoder.encode(chunk));
      });
    };

    const fullAnswer = "Вот и весь ответ";
    await enqueueEvent(`data: ${JSON.stringify({ delta: fullAnswer })}\n\n`);

    await waitFor(() => {
      const last = states.at(-1);
      expect(last?.isAnswerComplete).toBe(false);
      expect(last?.visibleAnswer).toContain(fullAnswer);
    });
  });

  it("keeps citations hidden while streaming and reveals them on completion", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const states: KnowledgeBaseAskAiState[] = [];

    function TestComponent() {
      const hook = useKnowledgeBaseAskAi(BASE_OPTIONS);
      useEffect(() => {
        void hook.ask("Привет");
      }, [hook.ask]);
      useEffect(() => {
        states.push(hook.state);
      }, [hook.state]);
      return null;
    }

    render(<TestComponent />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const enqueueEvent = async (chunk: string) => {
      await act(async () => {
        streamController?.enqueue(encoder.encode(chunk));
      });
    };

    await enqueueEvent(
      `event: metadata\n` +
        `data: ${JSON.stringify({ status: "Начинаем", citations: [{ chunk_id: "c1", doc_title: "Doc" }] })}\n\n`,
    );

    await waitFor(() => {
      const last = states.at(-1);
      expect(last?.statusMessage).toBe("Начинаем");
    });

    expect(
      states
        .filter((snapshot) => !snapshot.isAnswerComplete)
        .every((snapshot) => snapshot.sources.length === 0),
    ).toBe(true);

    await enqueueEvent(`data: ${JSON.stringify({ delta: "Привет " })}\n\n`);
    await enqueueEvent(`data: ${JSON.stringify({ delta: "мир!" })}\n\n`);

    await enqueueEvent(`event: complete\ndata: {}\n\n`);
    await act(async () => {
      streamController?.close();
    });

    await waitFor(() => {
      const last = states.at(-1);
      expect(last?.isAnswerComplete).toBe(true);
      expect(last?.sources.length).toBe(1);
      expect(last?.visibleAnswer).toContain("Привет мир!");
      expect(last?.answerHtml).toContain("Привет мир!");
    });

    const finalState = states.at(-1);
    expect(finalState?.visibleAnswer).toBe(finalState?.answerHtml);
  });

  it("only propagates sources after the final answer render is flushed", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    const originalWindowRaf = typeof window !== "undefined" ? window.requestAnimationFrame : undefined;
    const originalWindowCaf = typeof window !== "undefined" ? window.cancelAnimationFrame : undefined;
    const hadGlobalRaf = typeof originalRaf === "function";
    const hadGlobalCaf = typeof originalCaf === "function";
    const hadWindowRaf = typeof originalWindowRaf === "function";
    const hadWindowCaf = typeof originalWindowCaf === "function";
    const rafCallbacks: FrameRequestCallback[] = [];

    const rafStub = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    const cafStub = vi.fn((handle: number) => {
      if (rafCallbacks[handle - 1]) {
        rafCallbacks[handle - 1] = () => {};
      }
    });

    (globalThis as typeof globalThis & { requestAnimationFrame?: typeof rafStub }).requestAnimationFrame = rafStub;
    (globalThis as typeof globalThis & { cancelAnimationFrame?: typeof cafStub }).cancelAnimationFrame = cafStub;
    if (typeof window !== "undefined") {
      window.requestAnimationFrame = rafStub;
      window.cancelAnimationFrame = cafStub;
    }

    const states: KnowledgeBaseAskAiState[] = [];

    function TestComponent() {
      const hook = useKnowledgeBaseAskAi(BASE_OPTIONS);
      useEffect(() => {
        void hook.ask("Привет");
      }, [hook.ask]);
      useEffect(() => {
        states.push(hook.state);
      }, [hook.state]);
      return null;
    }

    try {
      render(<TestComponent />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      const enqueueEvent = async (chunk: string) => {
        await act(async () => {
          streamController?.enqueue(encoder.encode(chunk));
        });
      };

      await enqueueEvent(
        `event: metadata\n` +
          `data: ${JSON.stringify({ status: "Начинаем", citations: [{ chunk_id: "c1" }] })}\n\n`,
      );
      await enqueueEvent(`data: ${JSON.stringify({ delta: "Привет мир" })}\n\n`);
      await enqueueEvent(`event: complete\ndata: {}\n\n`);
      await act(async () => {
        streamController?.close();
      });

      await waitFor(() => {
        const last = states.at(-1);
        expect(last?.isAnswerComplete).toBe(true);
        expect(last?.visibleAnswer).toBe(last?.answerHtml);
        expect(last?.sources.length).toBe(0);
      });

      await act(async () => {
        rafCallbacks.splice(0).forEach((callback) => callback(0));
      });

      await waitFor(() => {
        const last = states.at(-1);
        expect(last?.sources.length).toBe(1);
      });
    } finally {
      if (hadGlobalRaf && originalRaf) {
        globalThis.requestAnimationFrame = originalRaf;
      } else {
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      }
      if (hadGlobalCaf && originalCaf) {
        globalThis.cancelAnimationFrame = originalCaf;
      } else {
        Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
      }
      if (typeof window !== "undefined") {
        if (hadWindowRaf && originalWindowRaf) {
          window.requestAnimationFrame = originalWindowRaf;
        } else if (!hadWindowRaf) {
          Reflect.deleteProperty(window, "requestAnimationFrame");
        }
        if (hadWindowCaf && originalWindowCaf) {
          window.cancelAnimationFrame = originalWindowCaf;
        } else if (!hadWindowCaf) {
          Reflect.deleteProperty(window, "cancelAnimationFrame");
        }
      }
    }
  });
});
