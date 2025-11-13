import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import SettingLabel from "./SettingLabel";

type NumericFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: number | null) => void;
};

const formatNumber = (value: number | null) => {
  if (value === null) {
    return "";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
};

const isStepMismatch = (value: number, min: number, step: number) => {
  const epsilon = 1e-6;
  const offset = value - min;
  const steps = offset / step;
  return Math.abs(Math.round(steps) - steps) > epsilon;
};

const NumericField = ({
  id,
  label,
  tooltip,
  value,
  min,
  max,
  step,
  defaultValue,
  placeholder,
  disabled,
  onChange,
}: NumericFieldProps) => {
  const [internal, setInternal] = useState(() => formatNumber(value));

  useEffect(() => {
    setInternal(formatNumber(value));
  }, [value]);

  const { isOutOfRange, hasStepMismatch, parsedValue } = useMemo(() => {
    if (!internal.trim()) {
      return { parsedValue: null, isOutOfRange: false, hasStepMismatch: false };
    }

    const parsed = Number(internal);
    if (Number.isNaN(parsed)) {
      return { parsedValue: null, isOutOfRange: true, hasStepMismatch: false };
    }

    return {
      parsedValue: parsed,
      isOutOfRange: parsed < min || parsed > max,
      hasStepMismatch: Number.isFinite(step) && step > 0 ? isStepMismatch(parsed, min, step) : false,
    };
  }, [internal, max, min, step]);

  const badges = useMemo(() => {
    const result: Array<{ key: string; label: string; variant?: "secondary" | "destructive" }> = [];

    if (!internal.trim()) {
      result.push({ key: "default", label: `По умолчанию: ${formatNumber(defaultValue)}`, variant: "secondary" });
      return result;
    }

    if (isOutOfRange) {
      result.push({ key: "range", label: `Диапазон ${min}–${max}`, variant: "destructive" });
      return result;
    }

    if (hasStepMismatch) {
      result.push({ key: "step", label: `Шаг ${step}`, variant: "secondary" });
    }

    if (parsedValue !== null && parsedValue !== defaultValue) {
      result.push({ key: "custom", label: `Текущее: ${formatNumber(parsedValue)}` });
    }

    return result;
  }, [defaultValue, hasStepMismatch, internal, isOutOfRange, max, min, parsedValue, step]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    setInternal(raw);

    if (!raw.trim()) {
      onChange(null);
      return;
    }

    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      return;
    }

    onChange(parsed);
  };

  const handleBlur = () => {
    if (!internal.trim()) {
      return;
    }

    const parsed = Number(internal);
    if (Number.isNaN(parsed)) {
      setInternal(formatNumber(value));
      return;
    }

    const clamped = Math.min(Math.max(parsed, min), max);
    if (clamped !== parsed) {
      setInternal(formatNumber(clamped));
      onChange(clamped);
    }
  };

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={internal}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8"
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

export default NumericField;
