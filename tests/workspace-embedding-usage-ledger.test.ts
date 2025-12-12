import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaceEmbeddingUsageLedger, workspaceUsageMonth, workspaces } from "@shared/schema";
import { formatUsagePeriodCode } from "../server/usage/usage-types";
import { recordEmbeddingUsageEvent } from "../server/usage/usage-service";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Embedding Ledger User",
    firstName: "Embedding",
    lastName: "Ledger",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
}

async function createWorkspaceForUser(userId: string, id: string) {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name: `Embedding Ledger Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace_embedding_usage_ledger", () => {
  let workspaceId: string;
  const operationId = `op-${Date.now()}`;
  const now = new Date(Date.UTC(2025, 1, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`embedding-ledger-${Date.now()}@example.com`);
    workspaceId = `embedding-ledger-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("inserts embedding ledger record", async () => {
    const [inserted] = await (storage as any).db
      .insert(workspaceEmbeddingUsageLedger)
      .values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        operationId,
        provider: "gigachat",
        model: "GigaChat-Embeddings",
        tokensTotal: 321,
        contentBytes: 2048,
        occurredAt: now,
      })
      .returning();

    expect(inserted.workspaceId).toBe(workspaceId);
    expect(inserted.tokensTotal).toBe(321);
  });

  it("rejects duplicate operation_id within workspace", async () => {
    const insertDuplicate = () =>
      (storage as any).db.insert(workspaceEmbeddingUsageLedger).values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        operationId,
        provider: "gigachat",
        model: "GigaChat-Embeddings",
        tokensTotal: 10,
        occurredAt: now,
      });

    await expect(insertDuplicate()).rejects.toThrow();

    const rows = await (storage as any).db
      .select()
      .from(workspaceEmbeddingUsageLedger)
      .where(
        and(
          eq(workspaceEmbeddingUsageLedger.workspaceId, workspaceId),
          eq(workspaceEmbeddingUsageLedger.operationId, operationId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("increments aggregate only once per operation", async () => {
    const user = await createUser(`embedding-ledger-agg-${Date.now()}@example.com`);
    const aggWorkspaceId = `embedding-ledger-agg-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, aggWorkspaceId);
    const opId = `agg-embed-${Date.now()}`;
    const tokens = 77;

    await recordEmbeddingUsageEvent({
      workspaceId: aggWorkspaceId,
      operationId: opId,
      provider: "gigachat",
      model: "GigaChat-Embeddings",
      tokensTotal: tokens,
      contentBytes: 1024,
      occurredAt: now,
    });

    const rows = await (storage as any).db
      .select()
      .from(workspaceEmbeddingUsageLedger)
      .where(
        and(
          eq(workspaceEmbeddingUsageLedger.workspaceId, aggWorkspaceId),
          eq(workspaceEmbeddingUsageLedger.operationId, opId),
        ),
      );
    expect(rows).toHaveLength(1);

    const [usageRow] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(
        and(
          eq(workspaceUsageMonth.workspaceId, aggWorkspaceId),
          eq(workspaceUsageMonth.periodCode, periodCode),
        ),
      );
    expect(Number(usageRow.embeddingsTokensTotal)).toBe(tokens);

    await recordEmbeddingUsageEvent({
      workspaceId: aggWorkspaceId,
      operationId: opId,
      provider: "gigachat",
      model: "GigaChat-Embeddings",
      tokensTotal: 10,
      occurredAt: now,
    });

    const ledgerAfterDuplicate = await (storage as any).db
      .select()
      .from(workspaceEmbeddingUsageLedger)
      .where(
        and(
          eq(workspaceEmbeddingUsageLedger.workspaceId, aggWorkspaceId),
          eq(workspaceEmbeddingUsageLedger.operationId, opId),
        ),
      );
    expect(ledgerAfterDuplicate).toHaveLength(1);

    const [usageAfterDuplicate] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(
        and(
          eq(workspaceUsageMonth.workspaceId, aggWorkspaceId),
          eq(workspaceUsageMonth.periodCode, periodCode),
        ),
      );
    expect(Number(usageAfterDuplicate.embeddingsTokensTotal)).toBe(tokens);
  });
});
