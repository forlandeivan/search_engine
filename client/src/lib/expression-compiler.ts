import type { MappingExpression, ExpressionToken } from "@shared/json-import";

/**
 * Компилирует выражение в строковый шаблон для использования в Liquid-шаблонах
 */
export function compileExpressionToTemplate(expression: MappingExpression): string {
  if (!expression || expression.length === 0) {
    return "";
  }

  return expression
    .map((token) => {
      switch (token.type) {
        case "field":
          return `{{${token.value}}}`;
        case "function":
          return compileFunctionToken(token);
        case "llm":
          // Для LLM токенов сохраняем конфигурацию в специальном формате
          const configStr = JSON.stringify(token.llmConfig || {});
          return `{{LLM:${configStr}}}`;
        case "text":
          return escapeLiquidText(token.value);
        default:
          return "";
      }
    })
    .join("");
}

/**
 * Компилирует токен функции в строку
 */
function compileFunctionToken(token: ExpressionToken): string {
  if (token.type !== "function") {
    return "";
  }

  const args = token.args && token.args.length > 0 ? token.args.join(", ") : "";
  return `{{${token.value}(${args})}}`;
}

/**
 * Экранирует текст для Liquid шаблона
 */
function escapeLiquidText(text: string): string {
  // Экранируем фигурные скобки, если они не являются частью макроса
  return text.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}
