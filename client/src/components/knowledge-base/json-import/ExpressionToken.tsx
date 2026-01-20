import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Braces, FunctionSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { LLMTokenConfigModal } from "./LLMTokenConfigModal";
import type { ExpressionToken as ExpressionTokenType, FieldInfo } from "@shared/json-import";

interface ExpressionTokenProps {
  token: ExpressionTokenType;
  onRemove?: () => void;
  onUpdate?: (token: ExpressionTokenType) => void;
  availableFields?: FieldInfo[];
  disabled?: boolean;
  className?: string;
}

export function ExpressionToken({
  token,
  onRemove,
  onUpdate,
  availableFields = [],
  disabled = false,
  className,
}: ExpressionTokenProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Не рендерим текстовые токены как Badge
  if (token.type === 'text') {
    return <span className={className}>{token.value}</span>;
  }

  const isField = token.type === 'field';
  const isFunction = token.type === 'function';
  const isLlm = token.type === 'llm';

  // Получаем отображаемый текст для LLM токена
  const getDisplayText = () => {
    if (isLlm && token.llmConfig) {
      if (!Array.isArray(token.llmConfig.prompt)) {
        return 'AI генерация';
      }
      const promptPreview = token.llmConfig.prompt
        .map((t) => {
          if (t.type === 'text') {
            return t.value;
          }
          if (t.type === 'field') {
            return `{${t.value}}`;
          }
          return '';
        })
        .join('')
        .slice(0, 30);
      return promptPreview ? `${promptPreview}...` : 'AI генерация';
    }
    return token.value;
  };

  // Обработчик клика для LLM токенов
  const handleClick = () => {
    if (isLlm && !disabled && onUpdate) {
      setIsEditModalOpen(true);
    }
  };

  // Обработчик сохранения изменений LLM токена
  const handleLlmUpdate = (config: typeof token.llmConfig) => {
    if (onUpdate && config) {
      onUpdate({
        ...token,
        llmConfig: config,
      });
    }
    setIsEditModalOpen(false);
  };

  return (
    <>
      <Badge
        variant="secondary"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono",
          "select-none",
          isField && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 cursor-default",
          isFunction && "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 cursor-default",
          isLlm && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 cursor-pointer",
          disabled && "opacity-50",
          className,
        )}
        onClick={handleClick}
      >
        {isField && <Braces className="h-3 w-3" />}
        {isFunction && <FunctionSquare className="h-3 w-3" />}
        {isLlm && <Sparkles className="h-3 w-3" />}
        
        <span className="max-w-[150px] truncate">
          {isLlm ? getDisplayText() : token.value}
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

      {/* Модальное окно редактирования LLM токена */}
      {isLlm && token.llmConfig && (
        <LLMTokenConfigModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          availableFields={availableFields}
          initialConfig={token.llmConfig}
          onSave={handleLlmUpdate}
        />
      )}
    </>
  );
}
