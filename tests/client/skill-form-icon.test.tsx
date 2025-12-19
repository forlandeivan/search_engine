/* @vitest-environment jsdom */

import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SkillFormContent } from "@/pages/SkillsPage";
import type { Skill } from "@/types/skill";

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function renderWithClient(node: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const baseSkill: Skill = {
  id: "skill-1",
  workspaceId: "ws-1",
  name: "Icon Skill",
  description: null,
  systemPrompt: null,
  icon: "Zap",
  modelId: "model-1",
  llmProviderConfigId: "provider-1",
  collectionName: null,
  isSystem: false,
  systemKey: null,
  status: "active",
  mode: "llm",
  knowledgeBaseIds: [],
  ragConfig: {
    mode: "all_collections",
    collectionIds: [],
    topK: 5,
    minScore: 0.7,
    maxContextTokens: 3000,
    showSources: true,
    bm25Weight: null,
    bm25Limit: null,
    vectorWeight: null,
    vectorLimit: null,
    embeddingProviderId: null,
    llmTemperature: null,
    llmMaxTokens: null,
    llmResponseFormat: null,
  },
  onTranscriptionMode: "raw_only",
  onTranscriptionAutoActionId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("SkillFormContent icon selection", () => {
  it("updates icon value and submits it", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    const llmOptions = [
      {
        key: "provider-1::model-1",
        label: "Provider · Model",
        providerId: "provider-1",
        providerName: "Provider",
        modelId: "model-1",
        modelDisplayName: "Model",
        costLevel: "LOW" as const,
        providerIsActive: true,
        disabled: false,
      },
    ];

    const { getByTestId } = renderWithClient(
      <SkillFormContent
        knowledgeBases={[]}
        vectorCollections={[]}
        isVectorCollectionsLoading={false}
        embeddingProviders={[]}
        isEmbeddingProvidersLoading={false}
        llmOptions={llmOptions}
        onSubmit={handleSubmit}
        isSubmitting={false}
        skill={baseSkill}
        getIconComponent={() => null}
      />,
    );

    fireEvent.click(getByTestId("skill-icon-trigger"));
    fireEvent.click(getByTestId("skill-icon-option-Brain"));
    fireEvent.click(getByTestId("skill-save-button"));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.icon).toBe("Brain");
  });
});
