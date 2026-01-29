/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";

const mockApiRequest = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ token: "t" }),
  useLocation: () => ["", mockNavigate],
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
    getQueryFn: () => async () => null,
  };
});

import AcceptInvitePage from "@/pages/AcceptInvitePage";

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockNavigate.mockReset();

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/auth/invite/t") {
      return {
        ok: true,
        json: async () => ({
          valid: true,
          invitation: {
            id: "inv-1",
            email: "test@example.com",
            role: "user",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
          workspace: { id: "ws-1", name: "WS", iconUrl: null },
          invitedBy: null,
          userExists: false,
        }),
      } as unknown as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AcceptInvitePage", () => {
  it("shows validation errors and focuses first invalid field on submit", async () => {
    const { findByText, getByLabelText } = renderWithClient(<AcceptInvitePage />);

    const submitButton = await findByText("Создать аккаунт и присоединиться");
    fireEvent.click(submitButton);

    await findByText("Введите имя");
    await findByText("Минимум 8 символов");
    await findByText("Подтвердите пароль");

    expect(mockApiRequest).not.toHaveBeenCalled();

    const fullNameInput = getByLabelText("Имя") as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(fullNameInput);
    });
  });

  it("does not submit when password is invalid (no digits)", async () => {
    const { findByText, getByLabelText } = renderWithClient(<AcceptInvitePage />);

    await findByText("Создать аккаунт и присоединиться");

    fireEvent.change(getByLabelText("Имя"), { target: { value: "Тестовый пользователь" } });
    fireEvent.change(getByLabelText("Пароль"), { target: { value: "abcdefgh" } });
    fireEvent.change(getByLabelText("Подтверждение пароля"), { target: { value: "abcdefgh" } });

    fireEvent.click(await findByText("Создать аккаунт и присоединиться"));

    await waitFor(() => {
      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    await findByText("Должен содержать буквы и цифры");
  });

  it("does not submit when passwords do not match", async () => {
    const { findByText, getByLabelText } = renderWithClient(<AcceptInvitePage />);

    await findByText("Создать аккаунт и присоединиться");

    fireEvent.change(getByLabelText("Имя"), { target: { value: "Тестовый пользователь" } });
    fireEvent.change(getByLabelText("Пароль"), { target: { value: "abc12345" } });
    fireEvent.change(getByLabelText("Подтверждение пароля"), { target: { value: "different123" } });

    fireEvent.click(await findByText("Создать аккаунт и присоединиться"));

    await waitFor(() => {
      expect(mockApiRequest).not.toHaveBeenCalled();
    });

    await findByText("Пароли не совпадают");
  });

  it("submits when form is valid", async () => {
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { findByText, getByLabelText } = renderWithClient(<AcceptInvitePage />);

    await findByText("Создать аккаунт и присоединиться");

    fireEvent.change(getByLabelText("Имя"), { target: { value: "Тестовый пользователь" } });
    fireEvent.change(getByLabelText("Пароль"), { target: { value: "abc12345" } });
    fireEvent.change(getByLabelText("Подтверждение пароля"), { target: { value: "abc12345" } });

    fireEvent.click(await findByText("Создать аккаунт и присоединиться"));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalled();
    });

    const call = mockApiRequest.mock.calls.find(
      ([method, url]) => method === "POST" && url === "/api/auth/complete-invite",
    );
    expect(call).toBeTruthy();
    const payload = call?.[2] as { token?: string; password?: string; fullName?: string } | undefined;
    expect(payload?.token).toBe("t");
    expect(payload?.password).toBe("abc12345");
    expect(payload?.fullName).toBe("Тестовый пользователь");
  });
});

