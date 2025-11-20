import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ChatSummary, ChatPayload, ChatMessage } from "@/types/chat";

type ChatListResponse = { chats: ChatSummary[] };
type ChatResponse = { chat: ChatSummary };
type ChatMessagesResponse = { messages: ChatMessage[] };

const buildChatsQueryKey = (workspaceId?: string, search?: string) =>
  ["chats", workspaceId ?? "unknown", search?.trim() ?? ""] as const;

const buildChatMessagesKey = (workspaceId?: string, chatId?: string) =>
  ["chat-messages", workspaceId ?? "unknown", chatId ?? "none"] as const;

async function fetchChats(workspaceId: string, searchQuery?: string): Promise<ChatSummary[]> {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  if (searchQuery && searchQuery.trim().length > 0) {
    params.set("q", searchQuery.trim());
  }
  const response = await apiRequest("GET", `/api/chat/sessions?${params.toString()}`);
  const data = (await response.json()) as ChatListResponse;
  return data.chats ?? [];
}

async function fetchChatMessages(chatId: string, workspaceId: string): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  const response = await apiRequest("GET", `/api/chat/sessions/${chatId}/messages?${params.toString()}`);
  const data = (await response.json()) as ChatMessagesResponse;
  return data.messages ?? [];
}

async function createChatRequest(payload: ChatPayload): Promise<ChatSummary> {
  const response = await apiRequest("POST", "/api/chat/sessions", payload);
  const data = (await response.json()) as ChatResponse;
  return data.chat;
}

async function renameChatRequest(chatId: string, title: string): Promise<ChatSummary> {
  const response = await apiRequest("PATCH", `/api/chat/sessions/${chatId}`, { title });
  const data = (await response.json()) as ChatResponse;
  return data.chat;
}

async function deleteChatRequest(chatId: string, workspaceId: string): Promise<void> {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  await apiRequest("DELETE", `/api/chat/sessions/${chatId}?${params.toString()}`);
}

export function useChats(workspaceId?: string, searchQuery?: string) {
  const queryKey = buildChatsQueryKey(workspaceId, searchQuery);
  const query = useQuery<ChatSummary[], Error>({
    queryKey,
    queryFn: () => fetchChats(workspaceId!, searchQuery),
    enabled: Boolean(workspaceId),
  });

  return {
    chats: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateChat(options: { onSuccess?: (chat: ChatSummary) => void } = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<ChatSummary, Error, ChatPayload>({
    mutationFn: createChatRequest,
    onSuccess: async (createdChat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      options.onSuccess?.(createdChat);
    },
  });

  return {
    createChat: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

type RenameChatVariables = { chatId: string; title: string };

export function useRenameChat(options: { onSuccess?: (chat: ChatSummary) => void } = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<ChatSummary, Error, RenameChatVariables>({
    mutationFn: ({ chatId, title }) => renameChatRequest(chatId, title),
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      options.onSuccess?.(chat);
    },
  });

  return {
    renameChat: mutation.mutateAsync,
    isRenaming: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

type DeleteChatVariables = { chatId: string; workspaceId: string };

export function useDeleteChat(options: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, DeleteChatVariables>({
    mutationFn: ({ chatId, workspaceId }) => deleteChatRequest(chatId, workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      options.onSuccess?.();
    },
  });

  return {
    deleteChat: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

type UseChatMessagesOptions = {
  enabled?: boolean;
};

export function useChatMessages(chatId?: string, workspaceId?: string, options: UseChatMessagesOptions = {}) {
  const { enabled = true } = options;
  const queryKey = buildChatMessagesKey(workspaceId, chatId);
  const query = useQuery<ChatMessage[], Error>({
    queryKey,
    queryFn: () => fetchChatMessages(chatId!, workspaceId!),
    enabled: Boolean(enabled && chatId && workspaceId),
    refetchInterval: false,
  });

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export type ChatStreamHandlers = {
  onDelta?: (delta: string) => void;
  onDone?: (payload?: unknown) => void;
  onError?: (error: Error) => void;
};

export async function sendChatMessageLLM({
  chatId,
  workspaceId,
  content,
  signal,
  handlers,
}: {
  chatId: string;
  workspaceId: string;
  content: string;
  signal?: AbortSignal;
  handlers?: ChatStreamHandlers;
}): Promise<void> {
  const response = await fetch(`/api/chat/sessions/${chatId}/messages/llm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({ workspaceId, content }),
    signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = response.statusText || "Не удалось отправить сообщение";
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.message) {
        message = String(parsed.message);
      }
    } catch {
      if (raw.trim().length > 0) {
        message = raw.trim();
      }
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const payload = await response.json();
    handlers?.onDone?.(payload);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");

      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary).replace(/\r/g, "");
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        if (!rawEvent.trim()) {
          continue;
        }

        const lines = rawEvent.split("\n");
        let eventName = "delta";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const payloadText = dataLines.join("\n");
        if (!payloadText) {
          continue;
        }

        if (payloadText === "[DONE]") {
          continue;
        }

        let parsedPayload: unknown = payloadText;
        try {
          parsedPayload = JSON.parse(payloadText);
        } catch {
          // ignore parse errors, leave as raw string
        }

        if (eventName === "delta") {
          const delta =
            typeof parsedPayload === "string"
              ? parsedPayload
              : typeof (parsedPayload as { text?: string }).text === "string"
                ? (parsedPayload as { text?: string }).text!
                : "";
          if (delta) {
            handlers?.onDelta?.(delta);
          }
          continue;
        }

        if (eventName === "done") {
          handlers?.onDone?.(parsedPayload);
          continue;
        }

        if (eventName === "error") {
          const message =
            typeof parsedPayload === "string"
              ? parsedPayload
              : typeof (parsedPayload as { message?: string }).message === "string"
                ? (parsedPayload as { message?: string }).message!
                : "Ошибка генерации ответа";
          handlers?.onError?.(new Error(message));
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
