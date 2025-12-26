import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../server/workspace-storage-service", () => ({
  deleteObject: vi.fn(),
}));

import { deleteObject as deleteWorkspaceObject } from "../server/workspace-storage-service";
import { cleanupFailedSkillFileUpload } from "../server/skill-file-upload-utils";

describe("cleanupFailedSkillFileUpload", () => {
  beforeEach(() => {
    deleteWorkspaceObject.mockReset();
    deleteWorkspaceObject.mockResolvedValue(undefined);
  });

  it("marks uploaded results as error and clears ids", async () => {
    const results = [
      {
        id: "file-1",
        name: "one.pdf",
        size: 10,
        contentType: "application/pdf",
        status: "uploaded" as const,
        errorMessage: null,
        ingestionStatus: "pending" as const,
        processingStatus: "processing" as const,
      },
    ];

    await cleanupFailedSkillFileUpload({
      workspaceId: "ws-1",
      uploadedKeys: [{ key: "files/skills/1/file-1", resultIndex: 0 }],
      results,
    });

    expect(deleteWorkspaceObject).toHaveBeenCalledTimes(1);
    expect(deleteWorkspaceObject).toHaveBeenCalledWith("ws-1", "files/skills/1/file-1");
    expect(results[0]).toMatchObject({
      status: "error",
      errorMessage: "Не удалось сохранить файл. Попробуйте ещё раз.",
      id: undefined,
      ingestionStatus: undefined,
      processingStatus: undefined,
    });
  });

  it("does not throw if cleanup fails", async () => {
    deleteWorkspaceObject.mockRejectedValueOnce(new Error("minio-down"));
    const results = [
      { name: "two.pdf", size: null, contentType: null, status: "uploaded" as const },
    ];

    await expect(
      cleanupFailedSkillFileUpload({
        workspaceId: "ws-2",
        uploadedKeys: [{ key: "files/skills/2/file-2", resultIndex: 0 }],
        results,
      }),
    ).resolves.not.toThrow();

    expect(results[0].status).toBe("error");
    expect(results[0].errorMessage).toBe("Не удалось сохранить файл. Попробуйте ещё раз.");
  });
});
