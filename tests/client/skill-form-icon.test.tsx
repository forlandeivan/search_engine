/* @vitest-environment jsdom */

import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SkillFormContent } from "@/pages/SkillsPage";
import type { Skill } from "@/types/skill";

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function renderWithClient(node: ReactNode) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
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
  executionMode: "standard",
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

describe("SkillFormContent", () => {
  it("updates icon value and submits it", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });
    const handleSubmit = vi.fn().mockResolvedValue(true);

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

    const { getByTestId, findByTestId } = renderWithClient(
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

    const iconNameRow = getByTestId("skill-icon-name-row");
    expect(iconNameRow.contains(getByTestId("skill-icon-trigger"))).toBe(true);
    expect(iconNameRow.contains(getByTestId("skill-name-input"))).toBe(true);
    expect(getByTestId("skill-description-input")).toBeTruthy();
    expect(getByTestId("skill-instruction-textarea")).toBeTruthy();

    fireEvent.click(getByTestId("skill-icon-trigger"));
    fireEvent.click(getByTestId("skill-icon-option-Brain"));
    const saveButton = await findByTestId("save-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.icon).toBe("Brain");
  });

  it("defaults execution mode to standard when missing", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });
    const handleSubmit = vi.fn().mockResolvedValue(true);

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

    const skillWithoutMode = { ...baseSkill } as Skill;
    delete (skillWithoutMode as Record<string, unknown>).executionMode;

    const { findByTestId } = renderWithClient(
      <SkillFormContent
        knowledgeBases={[]}
        vectorCollections={[]}
        isVectorCollectionsLoading={false}
        embeddingProviders={[]}
        isEmbeddingProvidersLoading={false}
        llmOptions={llmOptions}
        onSubmit={handleSubmit}
        isSubmitting={false}
        skill={skillWithoutMode}
        getIconComponent={() => null}
      />,
    );

    const nameInput = await findByTestId("skill-name-input");
    fireEvent.change(nameInput, { target: { value: "Icon Skill Updated" } });
    const saveButton = await findByTestId("save-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.executionMode).toBe("standard");
  });

  it("submits execution mode changes", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });
    const handleSubmit = vi.fn().mockResolvedValue(true);

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

    const { findByTestId } = renderWithClient(
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

    fireEvent.click(await findByTestId("execution-mode-no-code"));
    const saveButton = await findByTestId("save-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.executionMode).toBe("no_code");
  });

  it("submits advanced LLM parameters", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });
    const handleSubmit = vi.fn().mockResolvedValue(true);

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

    const { getByTestId, findByTestId } = renderWithClient(
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

    fireEvent.click(getByTestId("llm-advanced-accordion"));
    fireEvent.change(getByTestId("llm-temperature-input"), { target: { value: "0.9" } });
    fireEvent.change(getByTestId("llm-max-tokens-input"), { target: { value: "512" } });
    const saveButton = await findByTestId("save-button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.llmTemperature).toBe("0.9");
    expect(submitted.llmMaxTokens).toBe("512");
  });

  it("shows transcription settings in transcription tab", () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ items: [] }) });

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

    const { getByText } = renderWithClient(
      <SkillFormContent
        knowledgeBases={[]}
        vectorCollections={[]}
        isVectorCollectionsLoading={false}
        embeddingProviders={[]}
        isEmbeddingProvidersLoading={false}
        llmOptions={llmOptions}
        onSubmit={vi.fn().mockResolvedValue(true)}
        isSubmitting={false}
        skill={baseSkill}
        getIconComponent={() => null}
        activeTab="transcription"
      />,
    );

    expect(getByText("Поведение при транскрибировании аудио")).toBeTruthy();
  });
});
