import { Switch } from "@/components/ui/switch";
import SettingLabel from "./SettingLabel";

type BooleanFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  checked: boolean;
  defaultChecked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

const BooleanField = ({ id, label, tooltip, checked, defaultChecked, disabled, onChange }: BooleanFieldProps) => {
  const isDefault = checked === defaultChecked;

  return (
    <div className="space-y-1.5">
      <SettingLabel id={id} label={label} tooltip={tooltip} />
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2">
        <div className="flex flex-col text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{checked ? "Включено" : "Выключено"}</span>
          <span className="text-[11px]">{isDefault ? "Значение по умолчанию" : "Пользовательское значение"}</span>
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
};

export default BooleanField;
