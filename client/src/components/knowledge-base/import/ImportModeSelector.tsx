import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
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
    <RadioGroup
      value={mode}
      onValueChange={(value) => onModeChange(value as ImportMode)}
      className="grid gap-3"
    >
      {options.map((option) => {
        const optionId = `knowledge-base-create-${option.value}`;
        const isDisabled = disabled || option.disabled;

        return (
          <FieldLabel
            key={option.value}
            htmlFor={optionId}
            className={isDisabled ? "cursor-not-allowed" : undefined}
          >
            <Field orientation="horizontal" data-disabled={isDisabled}>
              <FieldContent>
                <FieldTitle className="flex items-center gap-2">
                  <option.icon className="h-4 w-4 text-muted-foreground" />
                  {option.title}
                </FieldTitle>
                <FieldDescription>{option.description}</FieldDescription>
              </FieldContent>
              <RadioGroupItem value={option.value} id={optionId} disabled={isDisabled} />
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}
