import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import type { ImportMode, ImportModeOption } from "./types";

type ImportModeSelectorProps = {
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  options: ImportModeOption[];
  disabled?: boolean;
};

export function ImportModeSelector({
  mode,
  onModeChange,
  options,
  disabled,
}: ImportModeSelectorProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onModeChange(option.value)}
          disabled={disabled || option.disabled}
          className={cn(
            "flex flex-col gap-2 rounded-lg border p-3 text-left transition",
            mode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
            (disabled || option.disabled) && "opacity-50 cursor-not-allowed",
          )}
        >
          <div className="flex items-center gap-2">
            <option.icon className="h-4 w-4" />
            <span className="text-sm font-semibold">{option.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">{option.description}</p>
        </button>
      ))}
    </div>
  );
}
