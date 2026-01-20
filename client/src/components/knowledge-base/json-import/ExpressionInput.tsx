import { useState, useRef, useCallback, KeyboardEvent, useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ExpressionToken } from "./ExpressionToken";
import { FieldTokenPopup } from "./FieldTokenPopup";
import { FunctionTokenPopup } from "./FunctionTokenPopup";
import type { MappingExpression, FieldInfo, LLMTokenConfig, ExpressionToken as ExpressionTokenType } from "@shared/json-import";
import { createFieldToken, createFunctionToken, createTextToken, createLlmToken } from "@shared/json-import";
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

// Уникальный ID для макросов в DOM
const MACRO_DATA_ATTR = 'data-macro-id';
const MACRO_TYPE_ATTR = 'data-macro-type';
const MACRO_VALUE_ATTR = 'data-macro-value';

/**
 * Парсинг DOM элемента в токены
 */
function parseContentEditable(element: HTMLElement): MappingExpression {
  const tokens: MappingExpression = [];
  
  // Проходим по всем дочерним узлам
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes[i];
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text) {
        tokens.push(createTextToken(text));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      if (el.hasAttribute(MACRO_DATA_ATTR)) {
        const type = el.getAttribute(MACRO_TYPE_ATTR);
        const value = el.getAttribute(MACRO_VALUE_ATTR);
        
        if (type === 'field' && value) {
          tokens.push(createFieldToken(value));
        } else if (type === 'function' && value) {
          const args = el.getAttribute('data-macro-args');
          const token = createFunctionToken(value);
          if (args) {
            try {
              token.args = JSON.parse(args);
            } catch {
              // Игнорируем ошибки парсинга
            }
          }
          tokens.push(token);
        } else if (type === 'llm' && value) {
          const configStr = el.getAttribute('data-macro-config');
          if (configStr) {
            try {
              const config = JSON.parse(configStr) as LLMTokenConfig;
              tokens.push(createLlmToken(config, value));
            } catch {
              // Игнорируем ошибки парсинга
            }
          }
        }
      } else {
        // Рекурсивно обрабатываем вложенные элементы
        const nestedTokens = parseContentEditable(el);
        tokens.push(...nestedTokens);
      }
    }
  }

  return normalizeExpression(tokens);
}

/**
 * Рендеринг токенов в HTML для contentEditable
 */
function renderTokensToHtml(tokens: MappingExpression): string {
  if (tokens.length === 0) {
    return '';
  }

  return tokens.map((token, index) => {
    if (token.type === 'text') {
      // Экранируем HTML в тексте
      return token.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    } else if (token.type === 'field') {
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="field" ${MACRO_VALUE_ATTR}="${token.value}" contenteditable="false" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-mono cursor-default">\u007b\u007b ${token.value} \u007d\u007d</span>`;
    } else if (token.type === 'function') {
      const args = token.args?.join(', ') || '';
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="function" ${MACRO_VALUE_ATTR}="${token.value}" data-macro-args='${JSON.stringify(token.args || [])}' contenteditable="false" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs font-mono cursor-default">\u007b\u007b ${token.value}(${args}) \u007d\u007d</span>`;
    } else if (token.type === 'llm') {
      const configStr = JSON.stringify(token.llmConfig || {});
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="llm" ${MACRO_VALUE_ATTR}="AI генерация" data-macro-config='${configStr.replace(/'/g, '&#39;')}' contenteditable="false" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs font-mono cursor-pointer">\u2728 AI генерация</span>`;
    }
    return '';
  }).join('');
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
  const safeValue = Array.isArray(value) ? value : [];
  const editorRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);

  // HTML представление токенов
  const htmlContent = useMemo(() => {
    if (safeValue.length === 0) {
      return '';
    }
    return renderTokensToHtml(safeValue);
  }, [safeValue]);

  // Инициализация содержимого при первом рендере
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML.trim() === '' && htmlContent) {
      editorRef.current.innerHTML = htmlContent;
    } else if (editorRef.current && editorRef.current.innerHTML.trim() === '' && safeValue.length === 0) {
      // Устанавливаем пустое содержимое для показа placeholder
      editorRef.current.innerHTML = '';
    }
  }, []);

  // Обновляем contentEditable при изменении value извне
  useEffect(() => {
    if (!editorRef.current || isUpdatingRef.current) {
      return;
    }

    const currentHtml = editorRef.current.innerHTML.trim();
    const newHtml = safeValue.length === 0 ? '' : renderTokensToHtml(safeValue);
    
    // Сравниваем без пробелов и переносов строк
    const normalizedCurrent = currentHtml.replace(/\s+/g, ' ').trim();
    const normalizedNew = newHtml.replace(/\s+/g, ' ').trim();
    
    if (normalizedCurrent !== normalizedNew) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      
      // Сохраняем позицию курсора относительно текста
      let cursorOffset = 0;
      if (range && editorRef.current.contains(range.startContainer)) {
        const textBefore = getTextBeforeCursor(editorRef.current, range);
        cursorOffset = textBefore.length;
      }

      editorRef.current.innerHTML = newHtml || '';

      // Восстанавливаем курсор
      if (selection && cursorOffset >= 0) {
        try {
          const newRange = setCursorAtOffset(editorRef.current, cursorOffset);
          if (newRange) {
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } catch {
          // Если не удалось восстановить, просто ставим курсор в конец
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  }, [htmlContent, safeValue]);

  // Получить текст до курсора
  function getTextBeforeCursor(root: HTMLElement, range: Range): string {
    const text: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node === range.startContainer) {
        if (node.nodeType === Node.TEXT_NODE) {
          text.push(node.textContent?.substring(0, range.startOffset) || '');
        }
        break;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        text.push(node.textContent || '');
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute(MACRO_DATA_ATTR)) {
          // Макросы не добавляем в текст для подсчета позиции
        }
      }
    }

    return text.join('');
  }

  // Установить курсор на позицию
  function setCursorAtOffset(root: HTMLElement, offset: number): Range | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node: Node | null;
    let currentOffset = 0;

    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = node.textContent?.length || 0;
        if (currentOffset + textLength >= offset) {
          const range = document.createRange();
          range.setStart(node, offset - currentOffset);
          range.collapse(true);
          return range;
        }
        currentOffset += textLength;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute(MACRO_DATA_ATTR)) {
          // Макросы пропускаем
        }
      }
    }

    // Если не нашли, ставим в конец
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
  }


  // Обработка изменений в contentEditable
  const handleInput = useCallback(() => {
    if (!editorRef.current || isUpdatingRef.current) {
      return;
    }

    // Предотвращаем редактирование макросов
    const macros = editorRef.current.querySelectorAll(`[${MACRO_DATA_ATTR}]`);
    macros.forEach((macro) => {
      (macro as HTMLElement).contentEditable = 'false';
    });

    isUpdatingRef.current = true;
    try {
      const tokens = parseContentEditable(editorRef.current);
      onChange(tokens);
    } finally {
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [onChange]);

  // Вставка токена в текущую позицию курсора
  const insertTokenAtCursor = useCallback((token: ExpressionTokenType) => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    // Создаем элемент для макроса
    const macroSpan = document.createElement('span');
    macroSpan.setAttribute(MACRO_DATA_ATTR, Date.now().toString());
    
    if (token.type === 'field') {
      macroSpan.setAttribute(MACRO_TYPE_ATTR, 'field');
      macroSpan.setAttribute(MACRO_VALUE_ATTR, token.value);
      macroSpan.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs font-mono cursor-default';
      macroSpan.contentEditable = 'false';
      macroSpan.textContent = `{{ ${token.value} }}`;
    } else if (token.type === 'function') {
      macroSpan.setAttribute(MACRO_TYPE_ATTR, 'function');
      macroSpan.setAttribute(MACRO_VALUE_ATTR, token.value);
      macroSpan.setAttribute('data-macro-args', JSON.stringify(token.args || []));
      macroSpan.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs font-mono cursor-default';
      macroSpan.contentEditable = 'false';
      const args = token.args?.join(', ') || '';
      macroSpan.textContent = `{{ ${token.value}(${args}) }}`;
    } else if (token.type === 'llm') {
      macroSpan.setAttribute(MACRO_TYPE_ATTR, 'llm');
      macroSpan.setAttribute(MACRO_VALUE_ATTR, 'AI генерация');
      macroSpan.setAttribute('data-macro-config', JSON.stringify(token.llmConfig || {}));
      macroSpan.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs font-mono cursor-pointer';
      macroSpan.contentEditable = 'false';
      macroSpan.innerHTML = '✨ AI генерация';
    }

    range.insertNode(macroSpan);
    
    // Ставим курсор после вставленного элемента
    const newRange = document.createRange();
    newRange.setStartAfter(macroSpan);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    // Триггерим обновление
    handleInput();
  }, [handleInput]);

  // Вставка токена поля
  const handleFieldSelect = useCallback((fieldPath: string) => {
    const token = createFieldToken(fieldPath);
    insertTokenAtCursor(token);
    setIsFieldPopupOpen(false);
  }, [insertTokenAtCursor]);

  // Вставка токена функции
  const handleFunctionSelect = useCallback((functionName: string) => {
    const token = createFunctionToken(functionName);
    insertTokenAtCursor(token);
    setIsFunctionPopupOpen(false);
  }, [insertTokenAtCursor]);

  // Вставка LLM токена
  const handleLlmTokenAdd = useCallback((config: LLMTokenConfig) => {
    const token = createLlmToken(config, 'AI генерация');
    insertTokenAtCursor(token);
    setIsFieldPopupOpen(false);
  }, [insertTokenAtCursor]);

  // Обработка клавиш
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    // Ctrl+Space — открыть popup полей
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      setIsFunctionPopupOpen(false);
      setIsFieldPopupOpen(true);
      return;
    }

    // Ctrl+Shift+F — открыть popup функций
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      setIsFieldPopupOpen(false);
      setIsFunctionPopupOpen(true);
      return;
    }

    // Escape — закрыть popup
    if (e.key === 'Escape') {
      setIsFieldPopupOpen(false);
      setIsFunctionPopupOpen(false);
      return;
    }

    // Backspace на макросе - удаляем его
    if (e.key === 'Backspace' && editorRef.current) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        
        // Проверяем, если курсор сразу после макроса
        if (startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
          const prevSibling = startContainer.previousSibling;
          if (prevSibling && (prevSibling as HTMLElement).hasAttribute?.(MACRO_DATA_ATTR)) {
            e.preventDefault();
            prevSibling.remove();
            handleInput();
            return;
          }
        }
        
        // Если выделен макрос целиком
        if (range.startContainer === range.endContainer) {
          const parent = range.startContainer.parentElement;
          if (parent && parent.hasAttribute(MACRO_DATA_ATTR)) {
            e.preventDefault();
            parent.remove();
            handleInput();
            return;
          }
        }
      }
    }

    // Delete на макросе - удаляем его
    if (e.key === 'Delete' && editorRef.current) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // Если выделен макрос целиком
        if (range.startContainer === range.endContainer) {
          const parent = range.startContainer.parentElement;
          if (parent && parent.hasAttribute(MACRO_DATA_ATTR)) {
            e.preventDefault();
            parent.remove();
            handleInput();
            return;
          }
        }
      }
    }
  }, [disabled, handleInput]);

  // Клик для открытия popup
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    
    const target = e.target as HTMLElement;
    // Если клик на макросе - не открываем popup
    if (target.hasAttribute(MACRO_DATA_ATTR) || target.closest(`[${MACRO_DATA_ATTR}]`)) {
      return;
    }
    
    // Если клик не на макросе, можно открыть popup (но не делаем это автоматически)
  }, [disabled]);

  // Определяем, какой попап показывать
  const isAnyPopupOpen = isFieldPopupOpen || isFunctionPopupOpen;

  return (
    <div className={cn("relative", className)}>
      <Popover 
        open={isAnyPopupOpen} 
        onOpenChange={(open) => {
          if (!open) {
            setIsFieldPopupOpen(false);
            setIsFunctionPopupOpen(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <div
            ref={editorRef}
            contentEditable={!disabled}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            suppressContentEditableWarning
            className={cn(
              "min-h-[40px] w-full rounded-md border bg-background px-3 py-2",
              "text-sm ring-offset-background",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-50",
              error && "border-destructive",
              !disabled && "cursor-text",
              "[&:empty]:before:content-[attr(data-placeholder)]",
              "[&:empty]:before:text-muted-foreground",
            )}
            data-placeholder={placeholder}
            style={{ whiteSpace: 'pre-wrap' }}
          />
        </PopoverTrigger>
        
        <PopoverContent className="w-80 p-0" align="start">
          {isFunctionPopupOpen ? (
            <FunctionTokenPopup
              onSelect={handleFunctionSelect}
              onBack={() => {
                setIsFunctionPopupOpen(false);
                setIsFieldPopupOpen(true);
              }}
            />
          ) : (
            <FieldTokenPopup
              fields={availableFields}
              onSelect={handleFieldSelect}
              onOpenFunctions={() => {
                setIsFieldPopupOpen(false);
                setIsFunctionPopupOpen(true);
              }}
              onAddLlmToken={handleLlmTokenAdd}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
