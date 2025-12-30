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

/**
 * Вычисляет текущую активность из списка actions по правилу конкуренции:
 * выбирает action со status=processing с самым свежим updatedAt (fallback: createdAt).
 * @param actions - список всех actions для чата
 * @param chatId - ID чата для фильтрации
 * @returns текущий action или null
 */
export function computeCurrentAction(
  actions: BotAction[],
  chatId: string,
): BotAction | null {
  const active = actions.filter(
    (a) => a.chatId === chatId && a.status === "processing",
  );

  if (active.length === 0) return null;

  // Сортируем по updatedAt desc, fallback на createdAt
  const sorted = active.sort((a, b) => {
    const aTime = a.updatedAt
      ? new Date(a.updatedAt).getTime()
      : a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0;
    const bTime = b.updatedAt
      ? new Date(b.updatedAt).getTime()
      : b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0;
    return bTime - aTime; // desc
  });

  return sorted[0];
}

/**
 * Подсчитывает количество других активных actions (кроме текущего).
 * @param actions - список всех actions для чата
 * @param chatId - ID чата для фильтрации
 * @param currentActionId - ID текущего action (исключается из подсчёта)
 * @returns количество других активных actions
 */
export function countOtherActiveActions(
  actions: BotAction[],
  chatId: string,
  currentActionId: string,
): number {
  const active = actions.filter(
    (a) =>
      a.chatId === chatId &&
      a.status === "processing" &&
      a.actionId !== currentActionId,
  );
  return active.length;
}
