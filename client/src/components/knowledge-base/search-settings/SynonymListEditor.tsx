import { FormEvent, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import SettingLabel from "./SettingLabel";

type SynonymListEditorProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: string[];
  maxItems?: number;
  disabled?: boolean;
  onChange: (value: string[]) => void;
};

const SynonymListEditor = ({ id, label, tooltip, value, maxItems, disabled, onChange }: SynonymListEditorProps) => {
  const [draft, setDraft] = useState("");

  const canAddMore = maxItems ? value.length < maxItems : true;
  const normalizedList = useMemo(() => value.map((item) => item.trim()).filter(Boolean), [value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || normalizedList.includes(trimmed) || !canAddMore) {
      setDraft("");
      return;
    }
    onChange([...normalizedList, trimmed]);
    setDraft("");
  };

  const handleRemove = (index: number) => {
    const next = normalizedList.filter((_, itemIndex) => itemIndex !== index);
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <div className="space-y-2 rounded-md border border-dashed border-border p-2">
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Добавьте синоним"
            disabled={disabled || !canAddMore}
            className="h-8 flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={disabled || !canAddMore || !draft.trim()}>
            Добавить
          </Button>
        </form>
        <div
          className={cn("flex flex-wrap gap-1", normalizedList.length === 0 && "text-xs text-muted-foreground")}
        >
          {normalizedList.length === 0 ? (
            <span>Синонимы не заданы</span>
          ) : (
            normalizedList.map((item, index) => (
              <Badge
                key={`${item}-${index}`}
                variant="outline"
                className="group flex items-center gap-1 rounded-sm px-1.5 py-0 text-[10px] font-medium"
              >
                {item}
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="text-muted-foreground transition group-hover:text-destructive"
                  disabled={disabled}
                  aria-label={`Удалить ${item}`}
                >
                  ×
                </button>
              </Badge>
            ))
          )}
        </div>
        {maxItems ? (
          <p className="text-[11px] text-muted-foreground">{`${normalizedList.length}/${maxItems} использовано`}</p>
        ) : null}
      </div>
    </div>
  );
};

export default SynonymListEditor;
