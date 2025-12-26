import { deleteObject as deleteWorkspaceObject } from "./workspace-storage-service";

export type SkillFileUploadResult = {
  id?: string;
  name: string;
  size: number | null;
  contentType: string | null;
  status: "uploaded" | "error";
  errorMessage?: string | null;
  createdAt?: string;
  version?: number;
  ingestionStatus?: "pending" | "running" | "done" | "error";
  processingStatus?: "processing" | "ready" | "error";
  processingErrorMessage?: string | null;
};

export type UploadedSkillFileDescriptor = {
  key: string;
  resultIndex: number;
};

export async function cleanupFailedSkillFileUpload(params: {
  workspaceId: string;
  uploadedKeys: UploadedSkillFileDescriptor[];
  results: SkillFileUploadResult[];
}): Promise<void> {
  const { workspaceId, uploadedKeys, results } = params;

  await Promise.allSettled(uploadedKeys.map(({ key }) => deleteWorkspaceObject(workspaceId, key)));

  uploadedKeys.forEach(({ resultIndex }) => {
    if (results[resultIndex]) {
      results[resultIndex] = {
        ...results[resultIndex],
        status: "error",
        errorMessage: "Не удалось сохранить файл. Попробуйте ещё раз.",
        id: undefined,
        ingestionStatus: undefined,
        processingStatus: undefined,
      };
    }
  });
}
