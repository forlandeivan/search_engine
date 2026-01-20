import { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ExpressionToken } from "./ExpressionToken";
import { FieldTokenPopup } from "./FieldTokenPopup";
import { FunctionTokenPopup } from "./FunctionTokenPopup";
import type { MappingExpression, FieldInfo } from "@shared/json-import";
import { createFieldToken, createFunctionToken, createTextToken } from "@shared/json-import";
import { normalizeExpression } from "@/lib/expression-utils";

interface ExpressionInputProps {
  value: MappingExpression;
  onChange: (value: MappingExpression) => void;
  availableFields: FieldInfo[];
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}

export function ExpressionInput({
  value,
  onChange,
  availableFields,
  placeholder = "Введите выражение или выберите поле...",
  disabled = false,
  error = false,
  className,
}: ExpressionInputProps) {
  const [isFieldPopupOpen, setIsFieldPopupOpen] = useState(false);
  const [isFunctionPopupOpen, setIsFunctionPopupOpen] = useState(false);
  const [insertPosition, setInsertPosition] = useState<number>(value.length);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Обновляем позицию вставки при изменении value
  useEffect(() => {
    setInsertPosition(value.length);
  }, [value.length]);

  // Фокус на text input при показе
  useEffect(() => {
    if (showTextInput && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [showTextInput]);

  // Вставка токена поля
  const handleFieldSelect = useCallback((fieldPath: string) => {
    const token = createFieldToken(fieldPath);
    const newValue = [...value];
    newValue.splice(insertPosition, 0, token);
    onChange(normalizeExpression(newValue));
    setInsertPosition(insertPosition + 1);
    setIsFieldPopupOpen(false);
  }, [value, insertPosition, onChange]);

  // Вставка токена функции
  const handleFunctionSelect = useCallback((functionName: string) => {
    const token = createFunctionToken(functionName);
    const newValue = [...value];
    newValue.splice(insertPosition, 0, token);
    onChange(normalizeExpression(newValue));
    setInsertPosition(insertPosition + 1);
    setIsFunctionPopupOpen(false);
  }, [value, insertPosition, onChange]);

  // Удаление токена
  const handleRemoveToken = useCallback((index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(normalizeExpression(newValue));
    if (insertPosition > index) {
      setInsertPosition(insertPosition - 1);
    }
  }, [value, insertPosition, onChange]);

  // Добавление текстового токена
  const handleAddText = useCallback(() => {
    if (!textInput.trim()) {
      setShowTextInput(false);
      setTextInput("");
      return;
    }

    const token = createTextToken(textInput);
    const newValue = [...value];
    newValue.splice(insertPosition, 0, token);
    onChange(normalizeExpression(newValue));
    setInsertPosition(insertPosition + 1);
    setShowTextInput(false);
    setTextInput("");
  }, [value, insertPosition, textInput, onChange]);

  // Обработка клавиш
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    // Ctrl+Space — открыть popup полей
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      setIsFieldPopupOpen(true);
      return;
    }

    // Ctrl+Shift+F — открыть popup функций
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      setIsFunctionPopupOpen(true);
      return;
    }

    // Escape — закрыть popup или text input
    if (e.key === 'Escape') {
      if (showTextInput) {
        setShowTextInput(false);
        setTextInput("");
      } else {
        setIsFieldPopupOpen(false);
        setIsFunctionPopupOpen(false);
      }
      return;
    }
  }, [disabled, showTextInput]);

  // Обработка клавиш в text input
  const handleTextInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowTextInput(false);
      setTextInput("");
    }
  }, [handleAddText]);

  // Клик между токенами для добавления текста
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || showTextInput) return;

    // Если клик не на токене и не на кнопке "+ текст", открываем popup
    const target = e.target as HTMLElement;
    if (!target.closest('[data-token]') && !target.closest('button')) {
      setIsFieldPopupOpen(true);
    }
  }, [disabled, showTextInput]);

  // Клик на токен для установки позиции вставки
  const handleTokenClick = useCallback((index: number) => {
    if (disabled) return;
    setInsertPosition(index + 1);
  }, [disabled]);

  return (
    <div className={cn("relative", className)}>
      <Popover open={isFieldPopupOpen} onOpenChange={setIsFieldPopupOpen}>
        <PopoverTrigger asChild>
          <div
            ref={inputRef}
            role="textbox"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={handleKeyDown}
            onClick={handleContainerClick}
            className={cn(
              "min-h-[40px] w-full rounded-md border bg-background px-3 py-2",
              "text-sm ring-offset-background",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "flex flex-wrap items-center gap-1",
              disabled && "cursor-not-allowed opacity-50",
              error && "border-destructive",
              !disabled && "cursor-text",
            )}
          >
            {value.length === 0 && !showTextInput ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {value.map((token, index) => {
                  // Для текстовых токенов добавляем возможность редактирования
                  if (token.type === 'text') {
                    return (
                      <span
                        key={`${token.type}-${index}`}
                        data-token
                        onClick={() => handleTokenClick(index)}
                        className="cursor-text"
                        title="Кликните для редактирования"
                      >
                        {token.value}
                      </span>
                    );
                  }
                  
                  return (
                    <div
                      key={`${token.type}-${index}`}
                      data-token
                      onClick={() => handleTokenClick(index)}
                      className="cursor-pointer"
                    >
                      <ExpressionToken
                        token={token}
                        onRemove={() => handleRemoveToken(index)}
                        disabled={disabled}
                      />
                    </div>
                  );
                })}
                {showTextInput && (
                  <input
                    ref={textInputRef}
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={handleTextInputKeyDown}
                    onBlur={handleAddText}
                    className="min-w-[100px] px-1 py-0.5 text-sm border-b-2 border-primary outline-none bg-transparent"
                    placeholder="Введите текст..."
                    autoFocus
                  />
                )}
                {!showTextInput && !disabled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTextInput(true);
                      setInsertPosition(value.length);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-accent"
                    title="Добавить текст (или нажмите Ctrl+Space для выбора поля)"
                  >
                    + текст
                  </button>
                )}
              </>
            )}
          </div>
        </PopoverTrigger>
        
        <PopoverContent className="w-80 p-0" align="start">
          <FieldTokenPopup
            fields={availableFields}
            onSelect={handleFieldSelect}
            onOpenFunctions={() => {
              setIsFieldPopupOpen(false);
              setIsFunctionPopupOpen(true);
            }}
          />
        </PopoverContent>
      </Popover>

      {/* Popup для функций */}
      <Popover open={isFunctionPopupOpen} onOpenChange={setIsFunctionPopupOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <FunctionTokenPopup
            onSelect={handleFunctionSelect}
            onBack={() => {
              setIsFunctionPopupOpen(false);
              setIsFieldPopupOpen(true);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
