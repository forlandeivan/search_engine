import { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FieldTokenPopup } from "./FieldTokenPopup";
import { FunctionTokenPopup } from "./FunctionTokenPopup";
import { LLMTokenConfigModal } from "./LLMTokenConfigModal";
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
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    } else if (token.type === 'field') {
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="field" ${MACRO_VALUE_ATTR}="${token.value}" contenteditable="false" style="display: inline-block; margin: 0 1px; padding: 1px 6px; border-radius: 4px; background-color: rgb(219 234 254); color: rgb(30 64 175); font-size: 0.75rem; font-family: monospace; cursor: default; user-select: none;">{$${token.value}}</span>`;
    } else if (token.type === 'function') {
      const args = token.args?.join(', ') || '';
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="function" ${MACRO_VALUE_ATTR}="${token.value}" data-macro-args='${JSON.stringify(token.args || [])}' contenteditable="false" style="display: inline-block; margin: 0 1px; padding: 1px 6px; border-radius: 4px; background-color: rgb(243 232 255); color: rgb(107 33 168); font-size: 0.75rem; font-family: monospace; cursor: default; user-select: none;">{$${token.value}(${args})}</span>`;
    } else if (token.type === 'llm') {
      const configStr = JSON.stringify(token.llmConfig || {});
      return `<span ${MACRO_DATA_ATTR}="${index}" ${MACRO_TYPE_ATTR}="llm" ${MACRO_VALUE_ATTR}="AI генерация" data-macro-config='${configStr.replace(/'/g, '&#39;')}' contenteditable="false" style="display: inline-block; margin: 0 1px; padding: 1px 6px; border-radius: 4px; background-color: rgb(220 252 231); color: rgb(21 128 61); font-size: 0.75rem; font-family: monospace; cursor: pointer; user-select: none;">✨ AI</span>`;
    }
    return '';
  }).join('');
}

/**
 * Парсинг DOM элемента в токены
 */
function parseContentEditable(element: HTMLElement): MappingExpression {
  const tokens: MappingExpression = [];
  
  // Проходим по всем дочерним узлам
  function parseNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text) {
        // Заменяем <br> обратно на \n
        tokens.push(createTextToken(text.replace(/<br>/g, '\n')));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      if (el.tagName === 'BR') {
        // Обрабатываем <br> как перенос строки
        if (tokens.length > 0 && tokens[tokens.length - 1].type === 'text') {
          tokens[tokens.length - 1].value += '\n';
        } else {
          tokens.push(createTextToken('\n'));
        }
      } else if (el.hasAttribute(MACRO_DATA_ATTR)) {
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
        // Рекурсивно обрабатываем дочерние узлы
        el.childNodes.forEach(child => parseNode(child));
      }
    }
  }

  element.childNodes.forEach(child => parseNode(child));

  return normalizeExpression(tokens);
}

export function ExpressionInput({
  value,
  onChange,
  availableFields,
  placeholder = "Введите текст или нажмите Ctrl+Space для вставки полей...",
  disabled = false,
  error = false,
  className,
}: ExpressionInputProps) {
  const [isFieldPopupOpen, setIsFieldPopupOpen] = useState(false);
  const [isFunctionPopupOpen, setIsFunctionPopupOpen] = useState(false);
  const [editingLlmTokenIndex, setEditingLlmTokenIndex] = useState<number | null>(null);
  const safeValue = Array.isArray(value) ? value : [];
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdateRef = useRef(false);
  const lastValueRef = useRef<MappingExpression>(safeValue);

  // Синхронизация contenteditableс value извне (только если изменение пришло снаружи)
  useEffect(() => {
    if (!editorRef.current || isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    // Проверяем, действительно ли value изменился
    const valueChanged = JSON.stringify(lastValueRef.current) !== JSON.stringify(safeValue);
    
    if (valueChanged) {
      const newHtml = safeValue.length === 0 ? '' : renderTokensToHtml(safeValue);
      
      // Сохраняем позицию курсора
      const selection = window.getSelection();
      let cursorOffset = 0;
      let isFocused = false;
      
      if (selection && selection.rangeCount > 0 && editorRef.current.contains(selection.focusNode)) {
        isFocused = true;
        cursorOffset = getTextOffsetBeforeCursor(editorRef.current, selection.getRangeAt(0));
      }

      editorRef.current.innerHTML = newHtml || '';
      lastValueRef.current = safeValue;

      // Восстанавливаем курсор
      if (isFocused && selection) {
        try {
          const newRange = setCursorAtTextOffset(editorRef.current, cursorOffset);
          if (newRange) {
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } catch (e) {
          // Если не удалось восстановить позицию, просто ставим курсор в конец
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  }, [safeValue]);

  // Получить текстовое смещение курсора (игнорируя макросы)
  function getTextOffsetBeforeCursor(root: HTMLElement, range: Range): number {
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) {
        if (node.nodeType === Node.TEXT_NODE) {
          offset += range.startOffset;
        }
        break;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        offset += (node.textContent || '').length;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        // Макросы не добавляем в подсчет
        if (el.hasAttribute && !el.hasAttribute(MACRO_DATA_ATTR) && el.tagName === 'BR') {
          offset += 1; // <br> считаем как 1 символ
        }
      }
    }
    
    return offset;
  }

  // Установить курсор на текстовое смещение
  function setCursorAtTextOffset(root: HTMLElement, targetOffset: number): Range | null {
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = (node.textContent || '').length;
        if (offset + textLength >= targetOffset) {
          const range = document.createRange();
          range.setStart(node, Math.min(targetOffset - offset, textLength));
          range.collapse(true);
          return range;
        }
        offset += textLength;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.hasAttribute && !el.hasAttribute(MACRO_DATA_ATTR) && el.tagName === 'BR') {
          offset += 1;
        }
      }
    }
    
    // Если не нашли, ставим в конец
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
  }

  // Обработка изменений в contentEditable (ввод текста, удаление)
  const handleInput = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    const tokens = parseContentEditable(editorRef.current);
    isInternalUpdateRef.current = true;
    lastValueRef.current = tokens;
    onChange(tokens);
  }, [onChange]);

  // Вставка токена в текущую позицию курсора
  const insertTokenAtCursor = useCallback((token: ExpressionTokenType) => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      // Если нет выделения, добавляем в конец
      const newTokens = [...safeValue, token];
      isInternalUpdateRef.current = true;
      lastValueRef.current = newTokens;
      onChange(newTokens);
      
      // Обновляем HTML и ставим курсор в конец
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = renderTokensToHtml(newTokens);
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          editorRef.current.focus();
        }
      }, 0);
      return;
    }

    const range = selection.getRangeAt(0);
    
    // Находим текстовое смещение курсора
    const textOffset = getTextOffsetBeforeCursor(editorRef.current, range);
    
    // Парсим текущее содержимое в токены
    const currentTokens = parseContentEditable(editorRef.current);
    
    // Находим позицию в массиве токенов, куда надо вставить новый токен
    let tokenOffset = 0;
    let insertIndex = 0;
    
    for (let i = 0; i < currentTokens.length; i++) {
      const token = currentTokens[i];
      if (token.type === 'text') {
        const textLength = token.value.length;
        if (tokenOffset + textLength >= textOffset) {
          // Курсор внутри этого текстового токена
          const offsetInToken = textOffset - tokenOffset;
          
          if (offsetInToken === 0) {
            // В начале токена - вставляем перед ним
            insertIndex = i;
          } else if (offsetInToken === textLength) {
            // В конце токена - вставляем после него
            insertIndex = i + 1;
          } else {
            // В середине - разбиваем текстовый токен
            const before = token.value.substring(0, offsetInToken);
            const after = token.value.substring(offsetInToken);
            const newTokens = [
              ...currentTokens.slice(0, i),
              createTextToken(before),
              token,
              createTextToken(after),
              ...currentTokens.slice(i + 1),
            ];
            insertIndex = i + 1;
            // Обновляем currentTokens для вставки
            currentTokens.splice(i, 1, createTextToken(before), createTextToken(after));
            tokenOffset += textLength;
            break;
          }
          tokenOffset += textLength;
          break;
        }
        tokenOffset += textLength;
      } else {
        // Макрос - не добавляем к смещению, но увеличиваем индекс
        insertIndex = i + 1;
      }
    }
    
    // Если курсор в конце, вставляем в конец
    if (insertIndex === 0 && currentTokens.length > 0) {
      insertIndex = currentTokens.length;
    }
    
    // Вставляем новый токен
    const newTokens = [
      ...currentTokens.slice(0, insertIndex),
      token,
      ...currentTokens.slice(insertIndex),
    ];
    
    isInternalUpdateRef.current = true;
    lastValueRef.current = newTokens;
    onChange(newTokens);
    
    // Обновляем HTML и ставим курсор после вставленного токена
    setTimeout(() => {
      if (editorRef.current && selection) {
        editorRef.current.innerHTML = renderTokensToHtml(newTokens);
        
        // Ставим курсор после вставленного макроса
        const newOffset = textOffset;
        try {
          const newRange = setCursorAtTextOffset(editorRef.current, newOffset);
          if (newRange) {
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } catch {
          // Просто ставим курсор в конец
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        editorRef.current.focus();
      }
    }, 0);
  }, [safeValue, onChange]);

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
  }, [disabled]);

  // Клик для открытия popup или редактирования макроса
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    
    const target = e.target as HTMLElement;
    
    // Проверяем, клик по AI макросу
    if (target.hasAttribute(MACRO_DATA_ATTR) && target.getAttribute(MACRO_TYPE_ATTR) === 'llm') {
      const macroId = target.getAttribute(MACRO_DATA_ATTR);
      if (macroId) {
        const index = parseInt(macroId, 10);
        setEditingLlmTokenIndex(index);
        return;
      }
    }
    
    // Открываем popup при клике в любое место input
    if (!isFieldPopupOpen && !isFunctionPopupOpen) {
      setIsFunctionPopupOpen(false);
      setIsFieldPopupOpen(true);
    }
  }, [disabled, isFieldPopupOpen, isFunctionPopupOpen]);

  // Обновление LLM токена после редактирования
  const handleLlmTokenUpdate = useCallback((config: LLMTokenConfig) => {
    if (editingLlmTokenIndex === null) return;
    
    const updatedTokens = [...safeValue];
    const token = updatedTokens[editingLlmTokenIndex];
    
    if (token && token.type === 'llm') {
      updatedTokens[editingLlmTokenIndex] = {
        ...token,
        llmConfig: config,
      };
      
      isInternalUpdateRef.current = true;
      lastValueRef.current = updatedTokens;
      onChange(updatedTokens);
    }
    
    setEditingLlmTokenIndex(null);
  }, [editingLlmTokenIndex, safeValue, onChange]);

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
              "empty:before:content-[attr(data-placeholder)]",
              "empty:before:text-muted-foreground",
              "empty:before:pointer-events-none",
            )}
            data-placeholder={placeholder}
            style={{ 
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
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

      {/* Модальное окно редактирования LLM токена */}
      {editingLlmTokenIndex !== null && safeValue[editingLlmTokenIndex]?.type === 'llm' && (
        <LLMTokenConfigModal
          open={true}
          onOpenChange={(open) => !open && setEditingLlmTokenIndex(null)}
          availableFields={availableFields}
          initialConfig={safeValue[editingLlmTokenIndex].llmConfig}
          onSave={handleLlmTokenUpdate}
        />
      )}
    </div>
  );
}
