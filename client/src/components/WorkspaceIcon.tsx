import { useEffect, useState } from "react";
import defaultWorkspaceIcon from "/branding/logo.svg";

type WorkspaceIconProps = {
  iconUrl?: string | null;
  size?: number;
  className?: string;
  testId?: string;
};

export function WorkspaceIcon({ iconUrl, size = 40, className, testId }: WorkspaceIconProps) {
  const [src, setSrc] = useState(iconUrl || defaultWorkspaceIcon);

  useEffect(() => {
    setSrc(iconUrl || defaultWorkspaceIcon);
  }, [iconUrl]);

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-[#0e4c7d] ${className ?? ""}`}
      style={{ width: size, height: size }}
      data-testid={testId}
    >
      <img
        src={src}
        alt="Иконка рабочего пространства"
        className="h-full w-full object-cover"
        onError={() => setSrc(defaultWorkspaceIcon)}
      />
    </div>
  );
}
