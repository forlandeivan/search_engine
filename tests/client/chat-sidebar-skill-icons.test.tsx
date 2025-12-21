/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChatSidebar from "@/components/chat/ChatSidebar";

const mockSkills = [
  { id: "skill-1", name: "Skill One", icon: "Brain", isSystem: false, status: "active" },
  { id: "skill-2", name: "Skill Two", icon: null, isSystem: false, status: "active" },
  { id: "skill-3", name: "System Skill", icon: "Zap", isSystem: true, status: "active", systemKey: "UNICA_CHAT" },
];

vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({ skills: mockSkills, isLoading: false, isFetching: false }),
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({ chats: [], isLoading: false, isFetching: false }),
  useRenameChat: () => ({ renameChat: vi.fn(), isRenaming: false }),
  useDeleteChat: () => ({ deleteChat: vi.fn(), isDeleting: false }),
}));

describe("ChatSidebar skill icons", () => {
  it("renders skill icon when present and fallback when missing", () => {
    render(
      <ChatSidebar
        workspaceId="ws-1"
        selectedChatId={null}
        onSelectChat={() => {}}
        onCreateNewChat={() => {}}
      />,
    );

    const itemWithIcon = screen.getByTestId("skill-list-item-skill-1");
    const iconWithValue = itemWithIcon.querySelector('[data-testid="skill-icon"]');
    expect(iconWithValue).toBeTruthy();
    expect(iconWithValue?.getAttribute("data-fallback")).toBe("false");
    expect(iconWithValue?.getAttribute("data-icon-name")).toBe("Brain");

    const itemFallback = screen.getByTestId("skill-list-item-skill-2");
    const iconFallback = itemFallback.querySelector('[data-testid="skill-icon"]');
    expect(iconFallback).toBeTruthy();
    expect(iconFallback?.getAttribute("data-fallback")).toBe("true");

    expect(screen.queryByTestId("skill-list-item-skill-3")).toBeNull();
  });
});
