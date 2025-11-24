import type { JsonValue } from "./json-types";

/**
 * Skill execution logging model.
 *
 * Основные цели:
 * - Отражать полный пайплайн обработки пользовательского сообщения в системном навыке Unica Chat
 *   и в других навыках (структура пайплайна одинакова).
 * - Фиксировать каждый шаг, его входы/выходы и итоговый статус, чтобы администратор мог построить
 *   блок-схему ("канвас").
 *
 * Текущий фактический пайплайн (по состоянию на server/routes.ts и server/chat-service.ts):
 * 1. `/api/chat/sessions/:chatId/messages/llm` (routes.ts) принимает HTTP-запрос.
 * 2. `addUserMessage` (chat-service.ts) пишет сообщение пользователя в chat_messages.
 * 3. `buildChatLlmContext` подтягивает конфигурацию навыка, глобальный UnicaChatConfig,
 *    провайдера LLM и историю чата.
 * 4. `fetchAccessToken` выдаёт OAuth-токен для выбранного провайдера.
 * 5. `executeLlmCompletion` обращается к LLM (stream/sync) и стримит результат на фронт.
 * 6. `addAssistantMessage` записывает ответ ассистента, `forwardLlmStreamEvents` гонит события SSE.
 *
 * Эти шаги и нужно отображать в журнале.
 */

export const SKILL_EXECUTION_TABLE_PLACEHOLDER = "skill_executions /* итоговое имя уточняется */";
export const SKILL_EXECUTION_STEP_TABLE_PLACEHOLDER =
  "skill_execution_steps /* итоговое имя уточняется */";

/**
 * Общий статус запуска навыка.
 */
export const SKILL_EXECUTION_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  ERROR: "error",
  TIMEOUT: "timeout",
  CANCELLED: "cancelled",
} as const;
export type SkillExecutionStatus = (typeof SKILL_EXECUTION_STATUS)[keyof typeof SKILL_EXECUTION_STATUS];

/**
 * Источник запуска (Unica Chat, кастомный навык, playground и т.д.).
 */
export type SkillExecutionSource =
  | "system_unica_chat"
  | "workspace_skill"
  | "playground"
  | "api";

/**
 * Описание запуска навыка.
 *
 * Рекомендуемые индексы:
 * - (workspaceId, startedAt DESC) — фильтрация по воркспейсу и времени.
 * - (skillId, startedAt DESC) — анализ конкретного навыка.
 * - (userId, startedAt DESC) — разбор активности пользователя.
 * - (chatId) — переход из UI чата к журналу.
 */
export interface SkillExecutionRecord {
  id: string;
  workspaceId: string;
  userId: string | null;
  skillId: string;
  chatId: string | null;
  userMessageId: string | null;
  source: SkillExecutionSource;
  status: SkillExecutionStatus;
  hasStepErrors: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  /**
   * Дополнительные агрегированные сведения (например, tags).
   * Сюда нельзя класть токены/секреты — только служебные пометки.
   */
  metadata?: JsonValue;
}

/**
 * Набор типов шагов. Список синхронизирован с фактическим пайплайном (routes.ts + chat-service.ts
 * + llm-client.ts). При добавлении шагов реальной логики надо расширять enum и pipeline ниже.
 */
export type SkillExecutionStepType =
  | "RECEIVE_HTTP_REQUEST"
  | "VALIDATE_REQUEST"
  | "WRITE_USER_MESSAGE"
  | "BUILD_SKILL_CONTEXT"
  | "RESOLVE_LLM_CONFIG"
  | "LOAD_SKILL_CONFIG"
  | "RESOLVE_LLM_PROVIDER_CONFIG"
  | "FETCH_PROVIDER_TOKEN"
  | "CALL_LLM"
  | "STREAM_TO_CLIENT_START"
  | "STREAM_TO_CLIENT_FINISH"
  | "WRITE_ASSISTANT_MESSAGE"
  | "FINALIZE_EXECUTION";

/**
 * Статус шага. Для канваса достаточно success/error/skipped.
 */
export const SKILL_EXECUTION_STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  ERROR: "error",
  SKIPPED: "skipped",
} as const;
export type SkillExecutionStepStatus = (typeof SKILL_EXECUTION_STEP_STATUS)[keyof typeof SKILL_EXECUTION_STEP_STATUS];

/**
 * Запись шага выполнения.
 *
 * Входные/выходные данные храним в JSON (jsonb). Перед записью обязательно:
 * - удалять/маскировать LLM токены, Authorization headers и прочие секреты;
 * - при необходимости маскировать PII (например, вытаскивать только длину строки или hash),
 *   чтобы журнал можно было безопасно показывать в UI.
 */
export interface SkillExecutionStepRecord {
  id: string;
  executionId: string;
  order: number;
  type: SkillExecutionStepType;
  status: SkillExecutionStepStatus;
  startedAt: Date;
  finishedAt: Date | null;
  inputPayload: JsonValue;
  outputPayload: JsonValue;
  errorCode?: string;
  errorMessage?: string;
  diagnosticInfo?: string;
}

/**
 * Формальная последовательность шагов пайплайна для системного Unica Chat.
 * Для других источников (playground, API) может отличаться.
 */
export const UNICA_CHAT_PIPELINE: readonly SkillExecutionStepType[] = [
  "RECEIVE_HTTP_REQUEST",
  "VALIDATE_REQUEST",
  "WRITE_USER_MESSAGE",
  "BUILD_SKILL_CONTEXT",
  "RESOLVE_LLM_CONFIG",
  "FETCH_PROVIDER_TOKEN",
  "CALL_LLM",
  "STREAM_TO_CLIENT_START",
  "STREAM_TO_CLIENT_FINISH",
  "WRITE_ASSISTANT_MESSAGE",
  "FINALIZE_EXECUTION",
] as const;

/**
 * Вспомогательные статусы: помогает быстро понять, завершён ли запуск.
 */
export function isTerminalExecutionStatus(status: SkillExecutionStatus): boolean {
  return (
    status === SKILL_EXECUTION_STATUS.SUCCESS ||
    status === SKILL_EXECUTION_STATUS.ERROR ||
    status === SKILL_EXECUTION_STATUS.TIMEOUT ||
    status === SKILL_EXECUTION_STATUS.CANCELLED
  );
}

/**
 * Проверяет, может ли шаг иметь данные стрима. Например, STREAM_TO_CLIENT_START/FINISH.
 */
export function canStepEmitStreamData(type: SkillExecutionStepType): boolean {
  return type === "STREAM_TO_CLIENT_START" || type === "STREAM_TO_CLIENT_FINISH";
}

/**
 * Диагностическое описание хранения чувствительных данных.
 *
 * На уровне модели обязательно:
 * 1. Маскировать bearer-токены, Authorization header и client_secret — заменять на `<redacted>`.
 * 2. При записи inputPayload/outputPayload для шагов CALL_LLM / FETCH_PROVIDER_TOKEN вырезать поля,
 *    содержащие конфиденциальные значения (например, requestHeaders.Authorization).
 * 3. PII (тело пользовательского запроса) допускается хранить, но с оглядкой на политики —
 *    при необходимости можно хранить только агрегаты (например, длину текста) или hash.
 */
export const SENSITIVE_DATA_POLICY =
  "Mask tokens/PII in skill_execution_step payloads. Authorization headers and provider secrets " +
  "должны записываться как <redacted>.";
