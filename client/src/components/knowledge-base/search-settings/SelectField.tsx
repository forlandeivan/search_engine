import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SettingLabel from "./SettingLabel";

type SelectOption = {
  value: string;
  label: string;
};

type SelectFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: string;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  isMissing?: boolean;
  onChange: (value: string) => void;
};

const SelectField = ({
  id,
  label,
  tooltip,
  value,
  placeholder,
  options,
  disabled,
  isMissing,
  onChange,
}: SelectFieldProps) => {
  const helper = useMemo(() => {
    if (!isMissing) {
      return null;
    }

    return { tone: "destructive" as const, text: "Сервис не найден" };
  }, [isMissing]);

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-8">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helper ? <p className="text-[11px] text-destructive">{helper.text}</p> : null}
    </div>
  );
};

export type { SelectOption };
export default SelectField;
