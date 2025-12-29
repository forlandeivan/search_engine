import { describe, expect, test, beforeAll, afterAll } from "vitest";
import http from "http";
import { createFileStorageProviderClient, ProviderUploadError } from "../server/file-storage-provider-client";

let server: http.Server;
let baseUrl: string;
let failOnce = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/files/upload") {
      if (failOnce) {
        failOnce = false;
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "temporary" }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ provider_file_id: "file-123", download_url: "https://provider/files/file-123" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("FileStorageProviderClient", () => {
  test("uploadFile returns provider_file_id on success", async () => {
    const client = createFileStorageProviderClient({
      baseUrl,
      authType: "none",
    });

    const result = await client.uploadFile({
      workspaceId: "ws1",
      fileName: "test.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      data: Buffer.from("test"),
    });

    expect(result.providerFileId).toBe("file-123");
    expect(result.downloadUrl).toBe("https://provider/files/file-123");
  });

  test("throws on bearer auth without token", async () => {
    const client = createFileStorageProviderClient({
      baseUrl,
      authType: "bearer",
    });

    await expect(
      client.uploadFile({
        workspaceId: "ws1",
        fileName: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        data: Buffer.from("test"),
      }),
    ).rejects.toBeInstanceOf(ProviderUploadError);
  });

  test("propagates provider error status", async () => {
    const failingBase = `${baseUrl}/not-found`;
    const client = createFileStorageProviderClient({
      baseUrl: failingBase,
      authType: "none",
    });

    await expect(
      client.uploadFile({
        workspaceId: "ws1",
        fileName: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        data: Buffer.from("test"),
      }),
    ).rejects.toBeInstanceOf(ProviderUploadError);
  });

  test("retries on 503 and eventually succeeds", async () => {
    failOnce = true;
    const client = createFileStorageProviderClient({
      baseUrl,
      authType: "none",
    });

    const result = await client.uploadFile({
      workspaceId: "ws1",
      fileName: "retry.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      data: Buffer.from("test"),
    });

    expect(result.providerFileId).toBe("file-123");
  });
});
