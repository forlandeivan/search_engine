/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import SpeechProviderDetailsPage from "@/pages/SpeechProviderDetailsPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockUseSpeechProviderDetails = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/useSpeechProviders", () => ({
  useSpeechProviderDetails: (providerId: string) => mockUseSpeechProviderDetails(providerId),
  updateSpeechProvider: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/admin/tts-stt/providers/yandex_speechkit", mockNavigate],
}));

function renderWithClient(node: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const sampleProvider = {
  provider: {
    id: "yandex_speechkit",
    name: "Yandex SpeechKit",
    type: "STT",
    direction: "audio_to_text",
    status: "Disabled" as const,
    isEnabled: false,
    lastUpdatedAt: new Date().toISOString(),
    lastStatusChangedAt: null,
    updatedByAdmin: { id: "admin-1", email: "admin@example.com" },
    lastValidationAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    config: { languageCode: "ru-RU", enablePunctuation: true },
    secrets: {
      apiKey: { isSet: true },
      folderId: { isSet: false },
    },
  },
  isLoading: false,
  isError: false,
  error: null,
};

describe("SpeechProviderDetailsPage", () => {
  beforeEach(() => {
    mockUseSpeechProviderDetails.mockReset();
    mockNavigate.mockReset();
  });

  it("renders loading state", () => {
    mockUseSpeechProviderDetails.mockReturnValue({
      provider: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderWithClient(<SpeechProviderDetailsPage providerId="yandex_speechkit" />);
    expect(screen.getByText(/Загрузка данных провайдера/i)).toBeTruthy();
  });

  it("renders error state", () => {
    mockUseSpeechProviderDetails.mockReturnValue({
      provider: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Not found"),
    });

    renderWithClient(<SpeechProviderDetailsPage providerId="yandex_speechkit" />);
    expect(screen.getByText(/Провайдер не найден/i)).toBeTruthy();
  });

  it("renders provider data", () => {
    mockUseSpeechProviderDetails.mockReturnValue(sampleProvider);

    renderWithClient(<SpeechProviderDetailsPage providerId="yandex_speechkit" />);
    expect(screen.getByText("Yandex SpeechKit")).toBeTruthy();
    expect(screen.getByText(/Тип:\s*STT/i)).toBeTruthy();
    expect(screen.getByText(/Последний изменил/i)).toBeTruthy();
  });
});
