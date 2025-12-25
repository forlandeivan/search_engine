/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import AdminIndexingRulesPage from "@/pages/AdminIndexingRulesPage";
import { DEFAULT_INDEXING_RULES } from "@shared/indexing-rules";

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function renderWithClient(node: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApiRequest.mockReset();
  const defaults = { ...DEFAULT_INDEXING_RULES };
  mockApiRequest.mockImplementation((method: string, url: string, payload?: unknown) => {
    if (method === "GET" && url === "/api/admin/indexing-rules") {
      return Promise.resolve({ json: async () => defaults });
    }
    if (method === "GET" && url === "/api/admin/embeddings/providers") {
      return Promise.resolve({
        json: async () => ({
          providers: [
            {
              id: defaults.embeddingsProvider,
              displayName: "Default provider",
              providerType: "gigachat",
              model: defaults.embeddingsModel,
              isActive: true,
              isConfigured: true,
            },
          ],
        }),
      });
    }
    if (method === "GET" && url === `/api/admin/embeddings/providers/${defaults.embeddingsProvider}/models`) {
      return Promise.resolve({
        json: async () => ({
          providerId: defaults.embeddingsProvider,
          providerName: "Default provider",
          supportsModelSelection: true,
          defaultModel: defaults.embeddingsModel,
          models: [defaults.embeddingsModel, "another-model"],
          isConfigured: true,
        }),
      });
    }
    if (method === "PATCH" && url === "/api/admin/indexing-rules") {
      return Promise.resolve({ json: async () => ({ ...defaults, ...(payload as object) }) });
    }
    return Promise.resolve({ json: async () => ({}) });
  });
});

describe("AdminIndexingRulesPage", () => {
  it("отправляет обновленные значения при сохранении", async () => {
    const { findByText, findByLabelText, getByTestId } = renderWithClient(<AdminIndexingRulesPage />);

    fireEvent.click(await findByText("Изменить"));

    await waitFor(() => {
      const providersCall = mockApiRequest.mock.calls.find(
        ([method, url]) => method === "GET" && url === "/api/admin/embeddings/providers",
      );
      expect(providersCall).toBeTruthy();
    });

    await waitFor(() => {
      const modelsCall = mockApiRequest.mock.calls.find(
        ([method, url]) =>
          method === "GET" &&
          url === `/api/admin/embeddings/providers/${DEFAULT_INDEXING_RULES.embeddingsProvider}/models`,
      );
      expect(modelsCall).toBeTruthy();
    });

    const chunkSizeInput = (await findByLabelText("Размер чанка")) as HTMLInputElement;
    fireEvent.change(chunkSizeInput, { target: { value: "900" } });

    const saveButton = getByTestId("indexing-rules-save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      const patchCall = mockApiRequest.mock.calls.find(
        ([method, url]) => method === "PATCH" && url === "/api/admin/indexing-rules",
      );
      expect(patchCall).toBeTruthy();
      expect(patchCall?.[2]).toEqual(expect.objectContaining({ chunkSize: 900 }));
    });
  });

  it("блокирует сохранение при невалидных числах", async () => {
    const { findByText, findByLabelText, getByTestId } = renderWithClient(<AdminIndexingRulesPage />);

    fireEvent.click(await findByText("Изменить"));

    const overlapInput = (await findByLabelText("Перекрытие чанков")) as HTMLInputElement;
    fireEvent.change(overlapInput, { target: { value: "5000" } });

    const saveButton = getByTestId("indexing-rules-save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      const patchCalls = mockApiRequest.mock.calls.filter(
        ([method, url]) => method === "PATCH" && url === "/api/admin/indexing-rules",
      );
      expect(patchCalls.length).toBe(0);
    });
  });
});
