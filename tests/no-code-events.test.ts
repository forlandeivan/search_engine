import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestInit } from "node-fetch";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../server/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn() })) })) })),
  },
  pool: null,
  isDatabaseConfigured: true,
}));

vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  return {
    ...actual,
    default: fetchMock,
    Headers: actual.Headers,
  };
});

import { buildMessageCreatedEventPayload, deliverNoCodeEvent } from "../server/no-code-events";

describe("no-code events", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("builds stable message.created payload without secrets", () => {
    const payload = buildMessageCreatedEventPayload({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      skillId: "skill-1",
      actorUserId: "user-1",
      message: {
        id: "msg-1",
        role: "user",
        content: "Привет",
        createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
        metadata: { foo: "bar" },
      },
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.event).toBe("message.created");
    expect(payload.eventId).toBe("msg-1");
    expect(payload.workspace).toEqual({ id: "workspace-1" });
    expect(payload.chat).toEqual({ id: "chat-1" });
    expect(payload.skill).toEqual({ id: "skill-1", executionMode: "no_code" });
    expect(payload.message).toEqual({
      id: "msg-1",
      role: "user",
      text: "Привет",
      createdAt: "2025-01-01T00:00:00.000Z",
      metadata: { foo: "bar" },
    });
    expect(payload.actor).toEqual({ userId: "user-1" });
    expect(JSON.stringify(payload)).not.toContain("bearer");
    expect(JSON.stringify(payload)).not.toContain("Authorization");
  });

  it("delivers without Authorization for authType=none", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "ok",
    });

    const payload = buildMessageCreatedEventPayload({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      skillId: "skill-1",
      actorUserId: "user-1",
      message: {
        id: "msg-1",
        role: "user",
        content: "Привет",
        createdAt: new Date().toISOString(),
        metadata: {},
      },
    });

    await deliverNoCodeEvent({
      endpointUrl: "https://example.com/hook",
      authType: "none",
      bearerToken: null,
      payload,
      timeoutMs: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as any;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("delivers with Authorization for authType=bearer", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "ok",
    });

    const payload = buildMessageCreatedEventPayload({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      skillId: "skill-1",
      actorUserId: "user-1",
      message: {
        id: "msg-1",
        role: "user",
        content: "Привет",
        createdAt: new Date().toISOString(),
        metadata: {},
      },
    });

    await deliverNoCodeEvent({
      endpointUrl: "https://example.com/hook",
      authType: "bearer",
      bearerToken: "secret-token",
      payload,
      timeoutMs: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as any;
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });
});
