import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import SettingLabel from "./SettingLabel";

type JsonEditorFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: string;
  defaultValue?: string;
  minRows?: number;
  disabled?: boolean;
  onChange: (value: string, isValid: boolean) => void;
};

const JsonEditorField = ({
  id,
  label,
  tooltip,
  value,
  defaultValue,
  minRows = 4,
  disabled,
  onChange,
}: JsonEditorFieldProps) => {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isValidJson = useMemo(() => {
    if (!draft.trim()) {
      return true;
    }
    try {
      JSON.parse(draft);
      return true;
    } catch (error) {
      return false;
    }
  }, [draft]);

  const badges = useMemo(() => {
    const list: Array<{ key: string; label: string; variant?: "secondary" | "destructive" }> = [];
    if (!draft.trim()) {
      if (defaultValue && defaultValue.trim()) {
        list.push({ key: "default", label: "Используется дефолтный фильтр", variant: "secondary" });
      } else {
        list.push({ key: "empty", label: "Фильтр не задан", variant: "secondary" });
      }
      return list;
    }

    if (!isValidJson) {
      list.push({ key: "invalid", label: "Некорректный JSON", variant: "destructive" });
    } else {
      list.push({ key: "custom", label: "Пользовательский фильтр" });
    }
    return list;
  }, [defaultValue, draft, isValidJson]);

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <Textarea
        id={id}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const valid = (() => {
            if (!next.trim()) {
              return true;
            }
            try {
              JSON.parse(next);
              return true;
            } catch (error) {
              return false;
            }
          })();
          onChange(next, valid);
        }}
        rows={minRows}
        disabled={disabled}
        className="resize-none text-xs"
        placeholder='{"must": []}'
      />
      {badges.length > 0 ? (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {badges.map((badge) => (
            <Badge
              key={badge.key}
              variant={badge.variant ?? "outline"}
              className="rounded-sm px-1.5 py-0 text-[10px] font-medium"
            >
              {badge.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default JsonEditorField;
