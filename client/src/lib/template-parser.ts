import type { MappingExpression, ExpressionToken } from "@shared/json-import";
import { createFieldToken, createTextToken, createFunctionToken, createLlmToken } from "@shared/json-import";
import type { LLMTokenConfig } from "@shared/json-import";

/**
 * Парсит строковый шаблон обратно в MappingExpression
 * Поддерживает простые макросы {{field}}, функции {{FUNC(...)}} и LLM токены {{LLM:...}}
 */
export function parseTemplateToExpression(template: string): MappingExpression {
  if (!template || template.trim().length === 0) {
    return [];
  }

  const tokens: ExpressionToken[] = [];
  
  // Regex для парсинга {{field}}, {{FUNC(...)}}, {{LLM:...}} и текста
  // Паттерн: {{...}} или обычный текст
  const regex = /\{\{([^}]+)\}\}|([^{]+)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(template)) !== null) {
    // Если есть текст перед макросом
    if (match.index > lastIndex) {
      const textBefore = template.slice(lastIndex, match.index);
      if (textBefore) {
        // Убираем экранирование
        const unescaped = textBefore.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
        tokens.push(createTextToken(unescaped));
      }
    }

    if (match[1]) {
      // Это макрос {{...}}
      const content = match[1].trim();
      
      // Проверяем LLM токен
      if (content.startsWith("LLM:")) {
        try {
          const configStr = content.slice(4); // Убираем "LLM:"
          const config = JSON.parse(configStr) as LLMTokenConfig;
          tokens.push(createLlmToken(config, "LLM"));
        } catch {
          // Если не удалось распарсить, игнорируем
        }
      }
      // Проверяем, это функция или поле
      else {
        const functionMatch = parseFunctionCall(content);
        if (functionMatch) {
          // Это функция
          tokens.push(createFunctionToken(functionMatch.name, functionMatch.args));
        } else {
          // Это простое поле
          tokens.push(createFieldToken(content));
        }
      }
    } else if (match[2]) {
      // Это текст
      const unescaped = match[2].replace(/\\\{/g, "{").replace(/\\\}/g, "}");
      tokens.push(createTextToken(unescaped));
    }

    lastIndex = regex.lastIndex;
  }

  // Добавляем оставшийся текст
  if (lastIndex < template.length) {
    const remainingText = template.slice(lastIndex);
    if (remainingText) {
      const unescaped = remainingText.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
      tokens.push(createTextToken(unescaped));
    }
  }

  return tokens.length > 0 ? tokens : [];
}

/**
 * Парсит вызов функции с поддержкой вложенных макросов в аргументах
 * Примеры:
 * - SUBSTRING({{chunk_text}}, 0, 200)
 * - CONCAT({{title}}, " - ", {{category}})
 */
function parseFunctionCall(content: string): { name: string; args: string[] } | null {
  // Ищем имя функции и открывающую скобку
  const funcMatch = content.match(/^(\w+)\s*\(/);
  if (!funcMatch) {
    return null;
  }

  const funcName = funcMatch[1];
  const argsStart = funcMatch[0].length;
  
  // Находим закрывающую скобку, учитывая вложенные скобки и макросы
  let depth = 1;
  let i = argsStart;
  let inString = false;
  let stringChar: string | null = null;
  
  while (i < content.length && depth > 0) {
    const char = content[i];
    
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
    } else if (!inString) {
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
      }
    }
    
    i++;
  }
  
  if (depth !== 0) {
    // Не найдена закрывающая скобка
    return null;
  }
  
  const argsStr = content.slice(argsStart, i - 1); // Убираем закрывающую скобку
  
  // Парсим аргументы, учитывая вложенные макросы
  const args = parseFunctionArgs(argsStr);
  
  return { name: funcName, args };
}

/**
 * Парсит аргументы функции, учитывая вложенные макросы и строки
 */
function parseFunctionArgs(argsStr: string): string[] {
  if (!argsStr.trim()) {
    return [];
  }
  
  const args: string[] = [];
  let currentArg = "";
  let depth = 0;
  let inString = false;
  let stringChar: string | null = null;
  let inMacro = false;
  let macroDepth = 0;
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const nextChar = argsStr[i + 1];
    
    if (!inString && !inMacro && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      currentArg += char;
    } else if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      currentArg += char;
    } else if (!inString && char === "{" && nextChar === "{") {
      inMacro = true;
      macroDepth = 1;
      currentArg += char + nextChar;
      i++; // Пропускаем следующий символ
    } else if (inMacro && char === "}") {
      if (nextChar === "}") {
        macroDepth--;
        currentArg += char + nextChar;
        i++; // Пропускаем следующий символ
        if (macroDepth === 0) {
          inMacro = false;
        }
      } else {
        currentArg += char;
      }
    } else if (!inString && !inMacro && char === "(") {
      depth++;
      currentArg += char;
    } else if (!inString && !inMacro && char === ")") {
      depth--;
      currentArg += char;
    } else if (!inString && !inMacro && depth === 0 && char === ",") {
      // Разделитель аргументов
      args.push(currentArg.trim());
      currentArg = "";
    } else {
      currentArg += char;
    }
  }
  
  // Добавляем последний аргумент
  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }
  
  return args;
}
