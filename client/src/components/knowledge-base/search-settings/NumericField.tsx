import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { Input } from "@/components/ui/input";
import SettingLabel from "./SettingLabel";

type NumericFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
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
  placeholder,
  disabled,
  onChange,
}: NumericFieldProps) => {
  const [internal, setInternal] = useState(() => formatNumber(value));

  useEffect(() => {
    setInternal(formatNumber(value));
  }, [value]);

  const { isOutOfRange, hasStepMismatch, isInvalid } = useMemo(() => {
    if (!internal.trim()) {
      return { isOutOfRange: false, hasStepMismatch: false, isInvalid: false };
    }

    const parsed = Number(internal);
    if (Number.isNaN(parsed)) {
      return { isOutOfRange: false, hasStepMismatch: false, isInvalid: true };
    }

    return {
      isOutOfRange: parsed < min || parsed > max,
      hasStepMismatch: Number.isFinite(step) && step > 0 ? isStepMismatch(parsed, min, step) : false,
      isInvalid: false,
    };
  }, [internal, max, min, step]);

  const helper = useMemo(() => {
    if (!internal.trim()) {
      return null;
    }

    if (isInvalid) {
      return { tone: "destructive" as const, text: "Введите корректное число" };
    }

    if (isOutOfRange) {
      return { tone: "destructive" as const, text: `Диапазон ${min}–${max}` };
    }

    if (hasStepMismatch) {
      return { tone: "muted" as const, text: `Шаг ${step}` };
    }

    return null;
  }, [hasStepMismatch, internal, isInvalid, isOutOfRange, max, min, step]);

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
      {helper ? (
        <p
          className={
            helper.tone === "destructive"
              ? "text-[11px] text-destructive"
              : "text-[11px] text-muted-foreground"
          }
        >
          {helper.text}
        </p>
      ) : null}
    </div>
  );
};

export default NumericField;
