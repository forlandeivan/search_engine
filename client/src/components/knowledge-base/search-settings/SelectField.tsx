import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  defaultValue?: string;
  disabled?: boolean;
  isMissing?: boolean;
  missingLabel?: string;
  onChange: (value: string) => void;
};

const EMPTY_VALUE = "__empty__select_value__";

const SelectField = ({
  id,
  label,
  tooltip,
  value,
  placeholder,
  options,
  defaultValue,
  disabled,
  isMissing,
  missingLabel,
  onChange,
}: SelectFieldProps) => {
  const badges = useMemo(() => {
    const list: Array<{ key: string; label: string; variant?: "secondary" | "destructive" }> = [];
    if (!value) {
      if (defaultValue) {
        list.push({ key: "default", label: `По умолчанию: ${defaultValue}`, variant: "secondary" });
      } else {
        list.push({ key: "empty", label: "Не выбрано", variant: "secondary" });
      }
      return list;
    }

    if (isMissing) {
      list.push({
        key: "missing",
        label: missingLabel ?? "Сервис не найден",
        variant: "destructive",
      });
      return list;
    }

    if (defaultValue && value !== defaultValue) {
      list.push({ key: "custom", label: `Выбрано: ${value}` });
    }

    return list;
  }, [defaultValue, isMissing, value]);

  const hasEmptyOption = useMemo(() => options.some((option) => option.value.length === 0), [options]);

  const normalizedOptions = useMemo<SelectOption[]>(() => {
    if (!hasEmptyOption) {
      return options;
    }

    return options.map((option) =>
      option.value.length === 0 ? { ...option, value: EMPTY_VALUE } : option,
    );
  }, [hasEmptyOption, options]);

  const normalizedValue = hasEmptyOption && value.length === 0 ? EMPTY_VALUE : value;

  const handleValueChange = (nextValue: string) => {
    if (hasEmptyOption && nextValue === EMPTY_VALUE) {
      onChange("");
      return;
    }

    onChange(nextValue);
  };

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <Select value={normalizedValue} onValueChange={handleValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-8">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {normalizedOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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

export type { SelectOption };
export default SelectField;
