import { Switch } from "@/components/ui/switch";
import SettingLabel from "./SettingLabel";

type BooleanFieldProps = {
  id: string;
  label: string;
  tooltip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

const BooleanField = ({ id, label, tooltip, checked, disabled, onChange }: BooleanFieldProps) => (
  <div className="space-y-1.5">
    <SettingLabel id={id} label={label} tooltip={tooltip} />
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">{checked ? "Включено" : "Выключено"}</span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  </div>
);

export default BooleanField;
