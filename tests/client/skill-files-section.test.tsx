/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillFilesSection } from "@/pages/SkillSettingsPage";

describe("SkillFilesSection", () => {
  it("рендерит секцию и CTA для редактора", () => {
    const onUpload = vi.fn(async () => ({ files: [] }));
    const { getByTestId, getByText } = render(
      <SkillFilesSection canEdit workspaceId="ws1" skillId="s1" uploadFiles={onUpload} />,
    );

    expect(getByTestId("skill-files-section")).toBeInTheDocument();
    expect(getByText("Файлы навыка")).toBeInTheDocument();
    fireEvent.click(getByTestId("skill-files-upload"));
  });

  it("не показывает секцию для пользователей без прав", () => {
    const { queryByTestId } = render(
      <SkillFilesSection canEdit={false} workspaceId="ws1" skillId="s1" uploadFiles={async () => ({ files: [] })} />,
    );

    expect(queryByTestId("skill-files-section")).toBeNull();
  });

  it("запускает upload при выборе файлов", async () => {
    const onUpload = vi.fn(async () => ({
      files: [{ id: "1", name: "doc.pdf", status: "uploaded" }],
    }));
    const { getByTestId } = render(
      <SkillFilesSection canEdit workspaceId="ws1" skillId="s1" uploadFiles={onUpload} />,
    );

    const input = getByTestId("skill-files-input") as HTMLInputElement;
    const file = new File(["content"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalled();
    });
  });
});
