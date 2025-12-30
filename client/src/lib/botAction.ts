import type { BotAction, BotActionType } from "@shared/schema";

const actionTypeTexts: Record<BotActionType, string> = {
  transcribe_audio: "Готовим стенограмму…",
  summarize: "Готовим саммари…",
  generate_image: "Создаём изображение…",
  process_file: "Обрабатываем файл…",
};

const UNKNOWN_TEXT = "Выполняем действие…";

export function resolveBotActionText(action: BotAction | null | undefined): string | null {
  if (!action) return null;
  const display = action.displayText?.trim();
  if (display) return display;
  const typeKey = action.actionType as BotActionType;
  return actionTypeTexts[typeKey] ?? UNKNOWN_TEXT;
}

export function getBotActionDefaultTextMap() {
  return actionTypeTexts;
}

export function isKnownBotActionType(actionType: string): actionType is BotActionType {
  return (Object.keys(actionTypeTexts) as BotActionType[]).includes(actionType as BotActionType);
}
