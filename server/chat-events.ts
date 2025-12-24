import EventEmitter from "events";
import type { ChatMessage } from "@shared/schema";

export type ChatEventPayload = {
  type: "message";
  message: ChatMessage;
};

class ChatEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

export const chatEvents = new ChatEvents();

export function emitChatMessage(chatId: string, message: ChatMessage): void {
  chatEvents.emit(chatId, { type: "message", message });
}

export function onChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  chatEvents.on(chatId, listener);
}

export function offChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  chatEvents.off(chatId, listener);
}
