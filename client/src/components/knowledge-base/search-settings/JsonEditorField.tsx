import { useEffect, useMemo, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import SettingLabel from "./SettingLabel";

type JsonEditorFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: string;
  minRows?: number;
  disabled?: boolean;
  onChange: (value: string, isValid: boolean) => void;
};

const JsonEditorField = ({
  id,
  label,
  tooltip,
  value,
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
      {!isValidJson ? <p className="text-[11px] text-destructive">Некорректный JSON</p> : null}
    </div>
  );
};

export default JsonEditorField;
