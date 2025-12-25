/* @vitest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillFilesSection } from "@/pages/SkillSettingsPage";

describe("SkillFilesSection", () => {
  it("рендерит секцию и CTA для редактора", () => {
    const onUploadClick = vi.fn();
    const { getByTestId, getByText } = render(
      <SkillFilesSection canEdit hasFiles={false} onUploadClick={onUploadClick} />,
    );

    expect(getByTestId("skill-files-section")).toBeInTheDocument();
    expect(getByText("Файлы навыка")).toBeInTheDocument();
    fireEvent.click(getByTestId("skill-files-upload"));
    expect(onUploadClick).toHaveBeenCalledTimes(1);
  });

  it("не показывает секцию для пользователей без прав", () => {
    const { queryByTestId } = render(
      <SkillFilesSection canEdit={false} hasFiles={false} onUploadClick={() => undefined} />,
    );

    expect(queryByTestId("skill-files-section")).toBeNull();
  });
});
