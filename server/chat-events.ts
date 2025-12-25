import EventEmitter from "events";
export type ChatEventPayload = {
  type: "message";
  // При передачах наружу сериализуем сами, поэтому допускаем любые поля.
  message: any;
};

class ChatEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

export const chatEvents = new ChatEvents();

export function emitChatMessage(chatId: string, message: any): void {
  chatEvents.emit(chatId, { type: "message", message });
}

export function onChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  chatEvents.on(chatId, listener);
}

export function offChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  chatEvents.off(chatId, listener);
}
