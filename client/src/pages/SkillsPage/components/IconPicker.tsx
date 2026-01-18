/**
 * Icon Picker Component
 *
 * A dialog-based icon picker for selecting skill icons
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ICON_OPTIONS } from "../constants";

export type IconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
  renderIcon: (name: string | null | undefined, className?: string) => JSX.Element | null;
};

export function IconPicker({ value, onChange, renderIcon }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredIcons = useMemo(() => {
    if (!normalizedQuery) {
      return ICON_OPTIONS;
    }
    return ICON_OPTIONS.filter((icon) => icon.value.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery]);

  const handleSelect = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-md border bg-muted flex items-center justify-center">
          {renderIcon(value, "h-5 w-5") ?? <span className="text-xs text-muted-foreground">—</span>}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9"
          data-testid="skill-icon-trigger"
          onClick={() => setOpen(true)}
        >
          Выбрать
        </Button>
      </div>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Иконка навыка</DialogTitle>
          <DialogDescription>Выберите иконку, которая будет отображаться в списке навыков.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск иконки"
            className="h-9"
          />
          <div className="grid gap-2 grid-cols-4 sm:grid-cols-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 text-xs",
                "data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:bg-accent",
              )}
              data-selected={value === ""}
              onClick={() => handleSelect("")}
              aria-label="Без иконки"
              data-testid="skill-icon-option-none"
            >
              ✕
            </Button>
            {filteredIcons.map((icon) => {
              const selected = value === icon.value;
              return (
                <Button
                  key={icon.value}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-9",
                    "data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:bg-accent",
                  )}
                  data-selected={selected}
                  onClick={() => handleSelect(icon.value)}
                  aria-label={icon.value}
                  data-testid={`skill-icon-option-${icon.value}`}
                >
                  {renderIcon(icon.value, "h-4 w-4")}
                </Button>
              );
            })}
          </div>
          {filteredIcons.length === 0 && (
            <p className="text-xs text-muted-foreground">Ничего не найдено</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
