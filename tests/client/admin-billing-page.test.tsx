/* @vitest-environment jsdom */

import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import AdminBillingPage from "@/pages/AdminBillingPage";

const mockApiRequest = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

function renderWithClient(node: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("AdminBillingPage", () => {
  it("sends no-code flag when saving plan", async () => {
    const planId = "plan-1";

    mockApiRequest.mockImplementation((method: string, url: string, payload?: unknown) => {
      if (method === "GET" && url === "/api/admin/tariffs") {
        return Promise.resolve({
          json: async () => ({
            tariffs: [
              {
                id: planId,
                code: "PRO",
                name: "Pro",
                description: "Plan",
                isActive: true,
                includedCreditsAmount: 0,
                includedCreditsPeriod: "monthly",
                noCodeFlowEnabled: false,
              },
            ],
          }),
        });
      }
      if (method === "GET" && url === `/api/admin/tariffs/${planId}`) {
        return Promise.resolve({
          json: async () => ({
            plan: {
              id: planId,
              code: "PRO",
              name: "Pro",
              description: "Plan",
              isActive: true,
              includedCreditsAmount: 0,
              includedCreditsPeriod: "monthly",
              noCodeFlowEnabled: false,
            },
            limits: [],
          }),
        });
      }
      if (method === "GET" && url === "/api/admin/tariff-limit-catalog") {
        return Promise.resolve({ json: async () => ({ catalog: [] }) });
      }
      if (method === "PUT" && url === `/api/admin/tariffs/${planId}`) {
        return Promise.resolve({
          json: async () => ({
            plan: {
              id: planId,
              code: "PRO",
              name: "Pro",
              noCodeFlowEnabled: (payload as { noCodeFlowEnabled?: boolean })?.noCodeFlowEnabled ?? false,
            },
          }),
        });
      }
      if (method === "PUT" && url === `/api/admin/tariffs/${planId}/limits`) {
        return Promise.resolve({ json: async () => ({ plan: { id: planId }, limits: [] }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    });

    const { findByText, findByTestId } = renderWithClient(<AdminBillingPage />);

    fireEvent.click(await findByText("Редактировать"));

    const toggle = await findByTestId("tariff-no-code-switch");
    fireEvent.click(toggle);

    fireEvent.click(await findByText("Сохранить"));

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(
        ([method, url]) => method === "PUT" && url === `/api/admin/tariffs/${planId}`,
      );
      expect(call).toBeTruthy();
      const payload = call?.[2] as { noCodeFlowEnabled?: boolean } | undefined;
      expect(payload?.noCodeFlowEnabled).toBe(true);
    });
  });
});
