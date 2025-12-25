import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INDEXING_RULES } from "@shared/indexing-rules";

const resolveStatusMock = vi.fn();
const getProviderMock = vi.fn();

vi.doMock("../server/embedding-provider-registry", () => ({
  resolveEmbeddingProviderStatus: resolveStatusMock,
  listEmbeddingProvidersWithStatus: vi.fn(),
}));

vi.doMock("../server/storage", () => ({
  storage: {
    getEmbeddingProvider: getProviderMock,
  },
}));

describe("resolveEmbeddingProviderForWorkspace", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resolveStatusMock.mockReset();
    getProviderMock.mockReset();
  });

  it("uses provider from indexing rules when request is empty and overrides model", async () => {
    const { resolveEmbeddingProviderForWorkspace, indexingRulesService } = await import("../server/indexing-rules");
    vi.spyOn(indexingRulesService, "getIndexingRules").mockResolvedValue({
      ...DEFAULT_INDEXING_RULES,
      embeddingsProvider: "rules-provider",
      embeddingsModel: "rules-model",
    });

    resolveStatusMock.mockResolvedValue({
      id: "rules-provider",
      displayName: "Rules Provider",
      providerType: "gigachat",
      model: "db-model",
      isActive: true,
      isConfigured: true,
    });

    getProviderMock.mockResolvedValue({
      id: "rules-provider",
      name: "Rules Provider",
      providerType: "gigachat",
      isActive: true,
      isGlobal: false,
      tokenUrl: "https://token.local",
      embeddingsUrl: "https://embed.local",
      authorizationKey: "secret",
      scope: "scope",
      model: "db-model",
      maxTokensPerVectorization: null,
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {},
      responseConfig: {},
      qdrantConfig: {},
      workspaceId: "ws-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await resolveEmbeddingProviderForWorkspace({
      workspaceId: "ws-1",
      requestedProviderId: null,
    });

    expect(resolveStatusMock).toHaveBeenCalledWith("rules-provider", "ws-1");
    expect(getProviderMock).toHaveBeenCalledWith("rules-provider", "ws-1");
    expect(result.provider.model).toBe("rules-model");
  });

  it("throws domain error when provider is not configured", async () => {
    const { resolveEmbeddingProviderForWorkspace, indexingRulesService, IndexingRulesDomainError } = await import(
      "../server/indexing-rules"
    );
    vi.spyOn(indexingRulesService, "getIndexingRules").mockResolvedValue(DEFAULT_INDEXING_RULES);

    resolveStatusMock.mockResolvedValue({
      id: DEFAULT_INDEXING_RULES.embeddingsProvider,
      displayName: "Broken Provider",
      providerType: "gigachat",
      model: DEFAULT_INDEXING_RULES.embeddingsModel,
      isActive: true,
      isConfigured: false,
      statusReason: "Missing credentials",
    });

    await expect(
      resolveEmbeddingProviderForWorkspace({
        workspaceId: "ws-1",
        requestedProviderId: null,
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });
});
