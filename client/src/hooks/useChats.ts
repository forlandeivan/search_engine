import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ChatSummary, ChatPayload } from "@/types/chat";

type ChatListResponse = { chats: ChatSummary[] };
type ChatResponse = { chat: ChatSummary };

const buildChatsQueryKey = (workspaceId?: string, search?: string) =>
  ["chats", workspaceId ?? "unknown", search?.trim() ?? ""] as const;

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
