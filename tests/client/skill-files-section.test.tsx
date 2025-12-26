/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { SkillFilesSection } from "@/pages/SkillSettingsPage";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("SkillFilesSection", () => {
  it("рендерит секцию и CTA для редактора", () => {
    const onUpload = vi.fn(async () => ({ files: [] }));
    const { getByTestId, getByText } = renderWithClient(
      <SkillFilesSection canEdit workspaceId="ws1" skillId="s1" uploadFiles={onUpload} initialFiles={[]} />,
    );

    expect(getByTestId("skill-files-section")).toBeInTheDocument();
    expect(getByText("Файлы навыка")).toBeInTheDocument();
    fireEvent.click(getByTestId("skill-files-upload"));
  });

  it("не показывает секцию для пользователей без прав", () => {
    const { queryByTestId } = renderWithClient(
      <SkillFilesSection canEdit={false} workspaceId="ws1" skillId="s1" uploadFiles={async () => ({ files: [] })} />,
    );

    expect(queryByTestId("skill-files-section")).toBeNull();
  });

  it("запускает upload при выборе файлов", async () => {
    const onUpload = vi.fn(async () => ({
      files: [{ id: "1", name: "doc.pdf", status: "uploaded" }],
    }));
    const { getByTestId } = renderWithClient(
      <SkillFilesSection canEdit workspaceId="ws1" skillId="s1" uploadFiles={onUpload} initialFiles={[]} />,
    );

    const input = getByTestId("skill-files-input") as HTMLInputElement;
    const file = new File(["content"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalled();
    });
  });

  it("отклоняет неподдерживаемый формат", async () => {
    const onUpload = vi.fn();
    const { getByTestId, queryByText } = renderWithClient(
      <SkillFilesSection canEdit workspaceId="ws1" skillId="s1" uploadFiles={onUpload} initialFiles={[]} />,
    );

    const input = getByTestId("skill-files-input") as HTMLInputElement;
    const file = new File(["content"], "image.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUpload).not.toHaveBeenCalled();
    });
    expect(queryByText(/Формат не поддерживается/)).toBeTruthy();
  });

  it("показывает кнопку удаления для загруженного файла", () => {
    const { getByTestId } = renderWithClient(
      <SkillFilesSection
        canEdit
        workspaceId="ws1"
        skillId="s1"
        uploadFiles={async () => ({ files: [] })}
        initialFiles={[{ id: "file1", name: "doc.pdf", status: "uploaded" }]}
      />,
    );

    expect(getByTestId("skill-file-delete-file1")).toBeInTheDocument();
  });
});
