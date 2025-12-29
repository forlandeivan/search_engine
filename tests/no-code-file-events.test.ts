import { describe, expect, test } from "vitest";
import { buildFileEventPayload } from "../server/no-code-file-events";

describe("buildFileEventPayload", () => {
  test("builds payload for attachment", () => {
    const payload = buildFileEventPayload({
      action: "file_uploaded",
      file: {
        id: "f1",
        workspaceId: "ws1",
        skillId: "s1",
        chatId: "c1",
        messageId: "m1",
        userId: "u1",
        kind: "attachment",
        name: "doc.txt",
        mimeType: "text/plain",
        sizeBytes: BigInt(123),
        storageType: "external_provider",
        providerId: "p1",
        providerFileId: "pf1",
        status: "ready",
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    });

    expect(payload.file.id).toBe("f1");
    expect(payload.file.type).toBe("attachment");
    expect(payload.file.providerId).toBe("p1");
    expect(payload.file.providerFileId).toBe("pf1");
    expect(payload.skillId).toBe("s1");
    expect(payload.chatId).toBe("c1");
    expect(payload.userId).toBe("u1");
    expect(payload.messageId).toBe("m1");
    expect(payload.eventId).toBeTruthy();
  });
});
