/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

const mockPostJson = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", mockNavigate],
}));

// Mock global fetch for providers query
vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/auth/providers") {
    return {
      ok: true,
      json: async () => ({
        providers: { local: { enabled: true }, google: { enabled: false }, yandex: { enabled: false } },
      }),
    } as unknown as Response;
  }
  throw new Error(`Unexpected fetch: ${url}`);
}));

import AuthPage from "@/pages/AuthPage";

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

// Mock postJson function used in AuthPage
beforeEach(() => {
  mockPostJson.mockReset();
  mockNavigate.mockReset();
  
  // Inject mock into module scope before importing
  vi.doMock("@/pages/AuthPage", async () => {
    const actual = await vi.importActual("@/pages/AuthPage");
    return actual;
  });
});

describe("AuthPage - Login Form", () => {
  it("shows validation errors and focuses first invalid field on submit", async () => {
    const { findByText, getByLabelText, getByTestId } = renderWithClient(<AuthPage />);

    // Wait for page to load
    await findByText("Вход в систему");

    const submitButton = getByTestId("button-login-submit");
    fireEvent.click(submitButton);

    // Wait for validation errors to appear
    await findByText("Введите корректный email");
    await findByText("Введите пароль");

    // Check that email input is focused
    const emailInput = getByLabelText("Email") as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(emailInput);
    });
  });

  it("shows validation error for invalid email format", async () => {
    const { findByText, getByLabelText, getByTestId } = renderWithClient(<AuthPage />);

    await findByText("Вход в систему");

    const emailInput = getByLabelText("Email");
    const passwordInput = getByLabelText("Пароль");

    fireEvent.change(emailInput, { target: { value: "invalid-email" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });

    const submitButton = getByTestId("button-login-submit");
    fireEvent.click(submitButton);

    // Wait for email validation error
    await findByText("Введите корректный email");
  });

  it("shows error when email is empty but password is filled", async () => {
    const { findByText, getByLabelText, getByTestId } = renderWithClient(<AuthPage />);

    await findByText("Вход в систему");

    const passwordInput = getByLabelText("Пароль");
    fireEvent.change(passwordInput, { target: { value: "password123" } });

    const submitButton = getByTestId("button-login-submit");
    fireEvent.click(submitButton);

    // Email should show error
    await findByText("Введите корректный email");
  });

  it("shows error when password is empty but email is filled", async () => {
    const { findByText, getByLabelText, getByTestId } = renderWithClient(<AuthPage />);

    await findByText("Вход в систему");

    const emailInput = getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    const submitButton = getByTestId("button-login-submit");
    fireEvent.click(submitButton);

    // Password should show error
    await findByText("Введите пароль");
  });

  it("validates in real-time (onChange mode)", async () => {
    const { findByText, getByLabelText, queryByText } = renderWithClient(<AuthPage />);

    await findByText("Вход в систему");

    const emailInput = getByLabelText("Email");

    // Type invalid email
    fireEvent.change(emailInput, { target: { value: "invalid" } });
    fireEvent.blur(emailInput);

    // Error should appear
    await findByText("Введите корректный email");

    // Type valid email
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    // Error should disappear
    await waitFor(() => {
      expect(queryByText("Введите корректный email")).toBeNull();
    });
  });
});
