import type { MappingExpression, ExpressionToken } from "@shared/json-import";
import { createFieldToken, createTextToken, createFunctionToken } from "@shared/json-import";

/**
 * Парсит строковый шаблон обратно в MappingExpression
 * Поддерживает простые макросы {{field}} и функции {{FUNC(...)}}
 */
export function parseTemplateToExpression(template: string): MappingExpression {
  if (!template || template.trim().length === 0) {
    return [];
  }

  const tokens: ExpressionToken[] = [];
  
  // Regex для парсинга {{field}}, {{FUNC(...)}} и текста
  // Паттерн: {{...}} или обычный текст
  const regex = /\{\{([^}]+)\}\}|([^{]+)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(template)) !== null) {
    // Если есть текст перед макросом
    if (match.index > lastIndex) {
      const textBefore = template.slice(lastIndex, match.index);
      if (textBefore) {
        tokens.push(createTextToken(textBefore));
      }
    }

    if (match[1]) {
      // Это макрос {{...}}
      const content = match[1].trim();
      
      // Проверяем, это функция или поле
      const functionMatch = content.match(/^(\w+)\s*\((.*)\)$/);
      if (functionMatch) {
        // Это функция
        const funcName = functionMatch[1];
        const argsStr = functionMatch[2];
        const args = argsStr
          .split(',')
          .map((arg) => arg.trim())
          .filter((arg) => arg.length > 0);
        tokens.push(createFunctionToken(funcName, args));
      } else {
        // Это простое поле
        tokens.push(createFieldToken(content));
      }
    } else if (match[2]) {
      // Это текст
      tokens.push(createTextToken(match[2]));
    }

    lastIndex = regex.lastIndex;
  }

  // Добавляем оставшийся текст
  if (lastIndex < template.length) {
    const remainingText = template.slice(lastIndex);
    if (remainingText) {
      tokens.push(createTextToken(remainingText));
    }
  }

  return tokens.length > 0 ? tokens : [];
}
