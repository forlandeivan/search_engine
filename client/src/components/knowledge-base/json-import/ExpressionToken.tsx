import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Braces, FunctionSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpressionToken as ExpressionTokenType } from "@shared/json-import";

interface ExpressionTokenProps {
  token: ExpressionTokenType;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

export function ExpressionToken({
  token,
  onRemove,
  disabled = false,
  className,
}: ExpressionTokenProps) {
  // Не рендерим текстовые токены как Badge
  if (token.type === 'text') {
    return <span className={className}>{token.value}</span>;
  }

  const isField = token.type === 'field';
  const isFunction = token.type === 'function';

  return (
    <Badge
      variant="secondary"
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono",
        "select-none cursor-default",
        isField && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
        isFunction && "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
        disabled && "opacity-50",
        className,
      )}
    >
      {isField && <Braces className="h-3 w-3" />}
      {isFunction && <FunctionSquare className="h-3 w-3" />}
      
      <span className="max-w-[150px] truncate">
        {token.value}
        {isFunction && token.args?.length ? `(${token.args.join(', ')})` : isFunction ? '()' : ''}
      </span>
      
      {onRemove && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-4 w-4 p-0 hover:bg-transparent"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </Badge>
  );
}
