import type { LlmModelOption } from "@shared/schema";

/**
 * Рекомендованный список топовых моделей AITunnel.
 *
 * Это не полный ответ /v1/models, а curated-подборка самых популярных вариантов.
 * Перед выкладкой на прод обязательно руками вызови GET https://api.aitunnel.ru/v1/models
 * (см. скрипт dev/check-aitunnel-models.ts) и сверяй ID, чтобы не промахнуться.
 *
 * Сохранённые в БД значения модели валидны даже если их нет в этом списке.
 */
export const AITUNNEL_RECOMMENDED_MODELS: LlmModelOption[] = [
  // OpenAI family
  { label: "OpenAI — GPT-5.1 Chat (флагман)", value: "gpt-5.1-chat" },
  { label: "OpenAI — GPT-5 Mini (быстрее и дешевле)", value: "gpt-5-mini" },
  { label: "OpenAI — GPT-4.1", value: "gpt-4.1" },
  { label: "OpenAI — GPT-4.1 Mini", value: "gpt-4.1-mini" },
  { label: "OpenAI — GPT-4o Mini (запасной)", value: "gpt-4o-mini" },

  // DeepSeek
  { label: "DeepSeek — R1 (рассуждения)", value: "deepseek-r1" },
  // Если появятся версии: deepseek-r1-0528, deepseek-v3 — добавить сюда.

  // Anthropic
  { label: "Anthropic — Claude 3.7 Sonnet", value: "claude-3.7-sonnet" },
  { label: "Anthropic — Claude 3.7 Sonnet Thinking", value: "claude-3.7-sonnet-thinking" },

  // Google
  { label: "Google — Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { label: "Google — Gemini 2.5 Flash", value: "gemini-2.5-flash" },
];

export function getRecommendedAitunnelModels(): LlmModelOption[] {
  // возвращаем копию, чтобы никто не мутировал исходный список
  return [...AITUNNEL_RECOMMENDED_MODELS];
}
