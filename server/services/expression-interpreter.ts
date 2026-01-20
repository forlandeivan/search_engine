import { randomUUID } from "crypto";
import type { MappingExpression, ExpressionToken, MappingConfigV2, LLMTokenConfig } from "@shared/json-import";
import { LLM_TOKEN_DEFAULTS } from "@shared/json-import";
import { resolveUnicaChatProvider } from "../chat-title-generator";
import { executeLlmCompletion } from "../llm-client";
import { fetchAccessToken } from "../llm-access-token";
import { recordLlmUsageEvent } from "../usage/usage-service";

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
  private workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
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
   * Вычисление выражения (ASYNC)
   */
  async evaluate(expression: MappingExpression, record: Record<string, unknown>): Promise<EvaluationResult> {
    const errors: string[] = [];
    const parts: string[] = [];

    for (const token of expression) {
      try {
        const value = await this.evaluateToken(token, record);
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
   * Вычисление одного токена (ASYNC)
   */
  private async evaluateToken(token: ExpressionToken, record: Record<string, unknown>): Promise<string> {
    switch (token.type) {
      case 'text':
        return token.value;

      case 'field':
        return this.getFieldValue(record, token.value);

      case 'function':
        return this.executeFunction(token.value, token.args ?? [], record);

      case 'llm':
        return await this.executeLlmGeneration(token, record);

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
   * Выполнение LLM генерации
   */
  private async executeLlmGeneration(token: ExpressionToken, record: Record<string, unknown>): Promise<string> {
    if (!token.llmConfig) {
      throw new Error('LLM token missing config');
    }

    const config = token.llmConfig;
    const maxRetries = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 1. Вычисляем промпт (подставляем значения полей)
        const promptResult = await this.evaluate(config.prompt, record);
        if (!promptResult.success) {
          console.warn('[expression-interpreter] LLM prompt evaluation errors:', promptResult.errors);
        }

        const promptText = promptResult.value.trim();
        if (!promptText) {
          console.warn('[expression-interpreter] LLM prompt is empty after evaluation');
          return '';
        }

        // 2. Получаем провайдер из Unica Chat
        const { provider, requestConfig, model } = await resolveUnicaChatProvider(this.workspaceId);

        // 3. Получаем access token
        const accessToken = await fetchAccessToken(provider);

        // 4. Формируем тело запроса
        const messagesField = requestConfig.messagesField;
        const modelField = requestConfig.modelField;

        const body: Record<string, unknown> = {
          [modelField]: model || provider.model,
          [messagesField]: [
            { role: 'user', content: promptText },
          ],
          temperature: config.temperature ?? LLM_TOKEN_DEFAULTS.temperature,
          max_tokens: LLM_TOKEN_DEFAULTS.maxTokens,
        };

        // 5. Выполняем запрос
        const completion = await executeLlmCompletion(provider, accessToken, body);

        // 6. Записываем токены в usage ledger
        const tokensTotal = completion.usageTokens ?? null;
        if (tokensTotal !== null && tokensTotal > 0) {
          try {
            const executionId = randomUUID();
            const providerId = provider.id ?? provider.providerType ?? 'unknown';
            const modelName = model?.trim() || provider.model?.trim() || 'unknown';
            
            await recordLlmUsageEvent({
              workspaceId: this.workspaceId,
              executionId,
              provider: providerId,
              model: modelName,
              modelId: null, // modelId не доступен в этом контексте
              tokensTotal,
              appliedCreditsPerUnit: null,
              creditsCharged: null,
              occurredAt: new Date(),
            });
          } catch (usageError) {
            // Логируем ошибку, но не прерываем выполнение
            console.error('[expression-interpreter] Failed to record LLM usage:', usageError);
          }
        }

        // 7. Возвращаем ответ
        const answer = completion.answer?.trim() ?? '';
        return answer;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[expression-interpreter] LLM attempt ${attempt + 1} failed:`, lastError.message);
        
        // Ждём перед retry
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // Все попытки неудачны
    console.error('[expression-interpreter] LLM generation failed after retries:', lastError);
    return ''; // Fallback: пустая строка
  }

  /**
   * Применение MappingConfigV2 к записи (ASYNC)
   */
  async applyMapping(config: MappingConfigV2, record: Record<string, unknown>): Promise<MappedDocument> {
    const result: MappedDocument = {
      title: '',
      content: '',
      metadata: {},
    };

    // ID
    if (config.id) {
      const idResult = await this.evaluate(config.id.expression, record);
      if (idResult.value) {
        result.id = idResult.value;
      }
    }

    // Content (нужно для fallback title)
    const contentResult = await this.evaluate(config.content.expression, record);
    result.content = contentResult.value;

    // Title
    const titleResult = await this.evaluate(config.title.expression, record);
    result.title = titleResult.value || this.getFallbackTitle(result.content, config.titleFallback);

    // Content HTML
    if (config.contentHtml) {
      const htmlResult = await this.evaluate(config.contentHtml.expression, record);
      if (htmlResult.value) {
        result.contentHtml = htmlResult.value;
      }
    }

    // Content Markdown
    if (config.contentMd) {
      const mdResult = await this.evaluate(config.contentMd.expression, record);
      if (mdResult.value) {
        result.contentMd = mdResult.value;
      }
    }

    // Metadata
    for (const metaField of config.metadata) {
      const metaResult = await this.evaluate(metaField.expression, record);
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

/**
 * Создание нового экземпляра интерпретатора для workspace
 */
export function createExpressionInterpreter(workspaceId: string): ExpressionInterpreter {
  return new ExpressionInterpreter(workspaceId);
}
