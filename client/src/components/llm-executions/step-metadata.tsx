import type { LlmExecutionStep } from "@/types/llm-execution";

interface StepMetadata {
  title: string;
  description?: string;
}

const STEP_TYPE_METADATA: Record<string, StepMetadata> = {
  RECEIVE_HTTP_REQUEST: {
    title: "Приём HTTP-запроса",
    description: "Получение обращения к API чата",
  },
  VALIDATE_REQUEST: {
    title: "Валидация запроса",
    description: "Проверка прав доступа и структуры тела",
  },
  WRITE_USER_MESSAGE: {
    title: "Запись пользовательского сообщения",
    description: "Сохранение сообщения в chat_messages",
  },
  BUILD_SKILL_CONTEXT: {
    title: "Подготовка контекста навыка",
    description: "Формирование промпта и истории диалога",
  },
  RESOLVE_LLM_CONFIG: {
    title: "Выбор LLM-конфигурации",
    description: "Определение провайдера и модели",
  },
  RESOLVE_LLM_PROVIDER_CONFIG: {
    title: "Конфигурация LLM провайдера",
    description: "Загрузка настроек и токенов провайдера",
  },
  LOAD_SKILL_CONFIG: {
    title: "Загрузка конфигурации навыка",
    description: "Чтение настроек RAG и LLM для навыка",
  },
  FETCH_PROVIDER_TOKEN: {
    title: "Получение токена провайдера",
    description: "Обновление/выдача ключа доступа",
  },
  // ========================
  // RAG Pipeline Steps
  // ========================
  CALL_RAG_PIPELINE: {
    title: "RAG Pipeline",
    description: "Полный цикл поиска и генерации ответа по базе знаний",
  },
  VECTOR_SEARCH: {
    title: "Векторный поиск",
    description: "Поиск релевантных чанков в базе знаний (BM25 + векторный)",
  },
  BUILD_RAG_CONTEXT: {
    title: "Сборка контекста",
    description: "Формирование контекста из найденных чанков для LLM",
  },
  BUILD_LLM_PROMPT: {
    title: "Формирование промпта",
    description: "Итоговый промпт с контекстом, отправляемый на LLM",
  },
  // ========================
  // LLM Call Steps
  // ========================
  CALL_LLM: {
    title: "Вызов LLM",
    description: "Отправка запроса на генерацию ответа",
  },
  STREAM_TO_CLIENT_START: {
    title: "Старт стрима",
    description: "Начало потоковой передачи ответа клиенту",
  },
  STREAM_TO_CLIENT_FINISH: {
    title: "Завершение стрима",
    description: "Окончание потоковой передачи",
  },
  WRITE_ASSISTANT_MESSAGE: {
    title: "Запись ответа",
    description: "Сохранение ответа ассистента в БД",
  },
  UPDATE_CHAT_TITLE: {
    title: "Обновление заголовка чата",
    description: "Генерация заголовка на основе диалога",
  },
  FINALIZE_EXECUTION: {
    title: "Завершение запуска",
    description: "Финализация логов и статистики",
  },
  // ========================
  // No-Code Integration Steps
  // ========================
  DISPATCH_NO_CODE_EVENT: {
    title: "No-Code событие",
    description: "Отправка события во внешнюю no-code систему",
  },
};

export function getStepMetadata(step: LlmExecutionStep): StepMetadata {
  return (
    STEP_TYPE_METADATA[step.type] ?? {
      title: `Технический шаг: ${step.type}`,
      description: undefined,
    }
  );
}
