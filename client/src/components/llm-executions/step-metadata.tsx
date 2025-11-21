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
  FETCH_PROVIDER_TOKEN: {
    title: "Получение токена провайдера",
    description: "Обновление/выдача ключа доступа",
  },
  CALL_LLM: {
    title: "Вызов LLM",
    description: "Отправка запроса на генерацию ответа",
  },
  STREAM_TO_CLIENT_START: {
    title: "Старт стрима на клиент",
  },
  STREAM_TO_CLIENT_FINISH: {
    title: "Завершение стрима на клиент",
  },
  WRITE_ASSISTANT_MESSAGE: {
    title: "Запись ответа ассистента",
  },
  FINALIZE_EXECUTION: {
    title: "Завершение запуска",
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
