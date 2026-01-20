import { randomUUID } from "crypto";
import type { MappingExpression, ExpressionToken, MappingConfigV2 } from "@shared/json-import";

/**
 * Исполнитель функции
 */
type FunctionExecutor = (args: string[], record: Record<string, unknown>) => string;

/**
 * Результат вычисления выражения
 */
interface EvaluationResult {
  success: boolean;
  value: string;
  errors?: string[];
}

/**
 * Результат применения маппинга к записи
 */
export interface MappedDocument {
  id?: string;
  title: string;
  content: string;
  contentHtml?: string;
  contentMd?: string;
  metadata: Record<string, unknown>;
}

export class ExpressionInterpreter {
  private functions = new Map<string, FunctionExecutor>();

  constructor() {
    this.registerBuiltinFunctions();
  }

  /**
   * Регистрация встроенных функций
   */
  private registerBuiltinFunctions(): void {
    // NewGUID — генерация UUID v4
    this.registerFunction('NewGUID', () => randomUUID());

    // Будущие функции
    // this.registerFunction('trim', (args) => args[0]?.trim() ?? '');
    // this.registerFunction('lowercase', (args) => args[0]?.toLowerCase() ?? '');
    // this.registerFunction('uppercase', (args) => args[0]?.toUpperCase() ?? '');
  }

  /**
   * Регистрация пользовательской функции
   */
  registerFunction(name: string, executor: FunctionExecutor): void {
    this.functions.set(name, executor);
  }

  /**
   * Вычисление выражения
   */
  evaluate(expression: MappingExpression, record: Record<string, unknown>): EvaluationResult {
    const errors: string[] = [];
    const parts: string[] = [];

    for (const token of expression) {
      try {
        const value = this.evaluateToken(token, record);
        parts.push(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        parts.push(''); // Пустое значение вместо ошибки
      }
    }

    return {
      success: errors.length === 0,
      value: parts.join(''),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Вычисление одного токена
   */
  private evaluateToken(token: ExpressionToken, record: Record<string, unknown>): string {
    switch (token.type) {
      case 'text':
        return token.value;

      case 'field':
        return this.getFieldValue(record, token.value);

      case 'function':
        return this.executeFunction(token.value, token.args ?? [], record);

      default:
        throw new Error(`Unknown token type: ${(token as ExpressionToken).type}`);
    }
  }

  /**
   * Получение значения поля из записи
   */
  private getFieldValue(record: Record<string, unknown>, path: string): string {
    const parts = path.split('.');
    let value: unknown = record;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }

    if (value === null || value === undefined) {
      return '';
    }

    // Преобразование в строку
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Выполнение функции
   */
  private executeFunction(
    name: string, 
    args: string[], 
    record: Record<string, unknown>
  ): string {
    const executor = this.functions.get(name);
    if (!executor) {
      throw new Error(`Unknown function: ${name}`);
    }

    // Вычисляем аргументы, если они являются путями к полям
    const evaluatedArgs = args.map(arg => {
      // Если аргумент похож на путь к полю (содержит только буквы, цифры, точки, подчеркивания)
      if (/^[\w.]+$/.test(arg)) {
        const fieldValue = this.getFieldValue(record, arg);
        return fieldValue || arg;
      }
      return arg;
    });

    return executor(evaluatedArgs, record);
  }

  /**
   * Применение MappingConfigV2 к записи
   */
  applyMapping(config: MappingConfigV2, record: Record<string, unknown>): MappedDocument {
    const result: MappedDocument = {
      title: '',
      content: '',
      metadata: {},
    };

    // ID
    if (config.id) {
      const idResult = this.evaluate(config.id.expression, record);
      if (idResult.value) {
        result.id = idResult.value;
      }
    }

    // Content (нужно для fallback title)
    const contentResult = this.evaluate(config.content.expression, record);
    result.content = contentResult.value;

    // Title
    const titleResult = this.evaluate(config.title.expression, record);
    result.title = titleResult.value || this.getFallbackTitle(result.content, config.titleFallback);

    // Content HTML
    if (config.contentHtml) {
      const htmlResult = this.evaluate(config.contentHtml.expression, record);
      if (htmlResult.value) {
        result.contentHtml = htmlResult.value;
      }
    }

    // Content Markdown
    if (config.contentMd) {
      const mdResult = this.evaluate(config.contentMd.expression, record);
      if (mdResult.value) {
        result.contentMd = mdResult.value;
      }
    }

    // Metadata
    for (const metaField of config.metadata) {
      const metaResult = this.evaluate(metaField.expression, record);
      if (metaResult.value) {
        result.metadata[metaField.key] = this.parseMetadataValue(metaResult.value);
      }
    }

    // Fallback для title (если всё ещё пустой)
    if (!result.title) {
      result.title = this.getFallbackTitle(result.content, config.titleFallback);
    }

    return result;
  }

  /**
   * Fallback для заголовка
   */
  private getFallbackTitle(content: string, fallback?: string): string {
    if (!content) return 'Без названия';

    switch (fallback) {
      case 'first_line':
        return content.split('\n')[0].slice(0, 200) || 'Без названия';
      case 'content_excerpt':
        return content.slice(0, 200) || 'Без названия';
      default:
        return 'Без названия';
    }
  }

  /**
   * Парсинг значения метаданных (попытка JSON)
   */
  private parseMetadataValue(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}

// Singleton instance
let interpreterInstance: ExpressionInterpreter | null = null;

export function getExpressionInterpreter(): ExpressionInterpreter {
  if (!interpreterInstance) {
    interpreterInstance = new ExpressionInterpreter();
  }
  return interpreterInstance;
}
