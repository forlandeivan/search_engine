import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SettingLabelProps = {
  id?: string;
  label: string;
  tooltip?: string;
  className?: string;
};

const SettingLabel = ({ id, label, tooltip, className }: SettingLabelProps) => {
  return (
    <div className={cn("flex items-start justify-between gap-2", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {tooltip ? (
        <Tooltip delayDuration={200} disableHoverableContent>
          <TooltipTrigger asChild>
            <span
              className="inline-flex h-4 w-4 select-none items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground transition hover:text-foreground"
              aria-label={tooltip}
            >
              ?
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">{tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
};

export default SettingLabel;
