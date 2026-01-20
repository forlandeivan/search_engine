import type { MappingExpression, ExpressionToken } from "@shared/json-import";

/**
 * Сериализация выражения в строку для отображения
 */
export function expressionToDisplayString(expression: MappingExpression): string {
  return expression.map(token => {
    switch (token.type) {
      case 'text':
        return token.value;
      case 'field':
        return `{{ ${token.value} }}`;
      case 'function':
        const args = token.args?.join(', ') ?? '';
        return `{{ ${token.value}(${args}) }}`;
      default:
        return '';
    }
  }).join('');
}

/**
 * Проверка, пустое ли выражение
 */
export function isExpressionEmpty(expression: MappingExpression): boolean {
  return expression.length === 0 || 
    expression.every(t => t.type === 'text' && t.value.trim() === '');
}

/**
 * Добавление токена в выражение
 */
export function addTokenToExpression(
  expression: MappingExpression,
  token: ExpressionToken,
  position?: number
): MappingExpression {
  const newExpression = [...expression];
  if (position !== undefined && position >= 0 && position <= newExpression.length) {
    newExpression.splice(position, 0, token);
  } else {
    newExpression.push(token);
  }
  return newExpression;
}

/**
 * Удаление токена из выражения по индексу
 */
export function removeTokenFromExpression(
  expression: MappingExpression,
  index: number
): MappingExpression {
  return expression.filter((_, i) => i !== index);
}

/**
 * Нормализация выражения (объединение соседних текстовых токенов)
 */
export function normalizeExpression(expression: MappingExpression): MappingExpression {
  const result: MappingExpression = [];
  
  for (const token of expression) {
    const last = result[result.length - 1];
    
    if (token.type === 'text' && last?.type === 'text') {
      // Объединяем соседние текстовые токены
      result[result.length - 1] = {
        type: 'text',
        value: last.value + token.value,
      };
    } else if (token.type !== 'text' || token.value !== '') {
      // Пропускаем пустые текстовые токены
      result.push(token);
    }
  }
  
  return result;
}

/**
 * Клиентское вычисление выражения для preview
 * (упрощённая версия, без функций)
 */
export function evaluateExpressionClient(
  expression: MappingExpression,
  record: Record<string, unknown>
): string {
  return expression.map(token => {
    switch (token.type) {
      case 'text':
        return token.value;
      case 'field':
        return getNestedValue(record, token.value) ?? '';
      case 'function':
        // Для preview функций — показываем placeholder
        if (token.value === 'NewGUID') {
          return '[UUID будет сгенерирован]';
        }
        return `[${token.value}()]`;
      default:
        return '';
    }
  }).join('');
}

/**
 * Получение вложенного значения из объекта
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let value: unknown = obj;
  
  for (const part of parts) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  
  if (value === undefined || value === null) {
    return undefined;
  }
  
  return String(value);
}
