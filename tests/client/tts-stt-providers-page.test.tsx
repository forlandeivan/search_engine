/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import TtsSttProvidersPage from "@/pages/TtsSttProvidersPage";

const mockUseSpeechProvidersList = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/useSpeechProviders", () => ({
  useSpeechProvidersList: (params?: unknown) => mockUseSpeechProvidersList(params),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/admin/tts-stt", mockNavigate],
}));

describe("TtsSttProvidersPage", () => {
  beforeEach(() => {
    mockUseSpeechProvidersList.mockReset();
    mockNavigate.mockReset();
  });

  it("renders loading state", () => {
    mockUseSpeechProvidersList.mockReturnValue({
      providers: [],
      total: 0,
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<TtsSttProvidersPage />);
    expect(screen.getByText(/Загрузка списка провайдеров/i)).toBeTruthy();
  });

  it("renders provider rows", () => {
    mockUseSpeechProvidersList.mockReturnValue({
      providers: [
        {
          id: "yandex_speechkit",
          name: "Yandex SpeechKit",
          type: "STT",
          direction: "audio_to_text",
          status: "Disabled",
          isEnabled: false,
          lastUpdatedAt: new Date().toISOString(),
          lastStatusChangedAt: null,
          updatedByAdmin: { id: "admin-1", email: "admin@example.com" },
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<TtsSttProvidersPage />);
    expect(screen.getByText("Yandex SpeechKit")).toBeTruthy();
    expect(screen.getByText("STT")).toBeTruthy();
  });

  it("navigates to provider details when clicking Open", () => {
    mockUseSpeechProvidersList.mockReturnValue({
      providers: [
        {
          id: "yandex_speechkit",
          name: "Yandex SpeechKit",
          type: "STT",
          direction: "audio_to_text",
          status: "Disabled",
          isEnabled: false,
          lastUpdatedAt: new Date().toISOString(),
          lastStatusChangedAt: null,
          updatedByAdmin: null,
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<TtsSttProvidersPage />);
    const buttons = screen.getAllByText("Открыть");
    fireEvent.click(buttons[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/admin/tts-stt/providers/yandex_speechkit");
  });
});
