import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessagesArea from "@/components/chat/ChatMessagesArea";
import ChatInput from "@/components/chat/ChatInput";
import {
  useChats,
  useChatMessages,
  useCreateChat,
  sendChatMessageLLM,
} from "@/hooks/useChats";
import { useSkills } from "@/hooks/useSkills";
import type { ChatMessage } from "@/types/chat";

type ChatPageParams = {
  workspaceId?: string;
  chatId?: string;
};

type ChatPageProps = {
  params?: ChatPageParams;
};

export default function ChatPage({ params }: ChatPageProps) {
  const workspaceId = params?.workspaceId ?? "";
  const routeChatId = params?.chatId ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const prevWorkspaceRef = useRef<string | null>(workspaceId);

  const [overrideChatId, setOverrideChatId] = useState<string | null>(null);
  const effectiveChatId = routeChatId || overrideChatId || null;

  const { chats } = useChats(workspaceId);
  const activeChat = chats.find((chat) => chat.id === effectiveChatId) ?? null;

  const { skills } = useSkills({ enabled: Boolean(workspaceId) });
  const defaultSkill = useMemo(
    () => skills.find((skill) => skill.isSystem && skill.systemKey === "UNICA_CHAT") ?? null,
    [skills],
  );
  const activeSkill =
    (activeChat && skills.find((skill) => skill.id === activeChat.skillId)) ?? defaultSkill;

  const {
    messages: fetchedMessages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
  } = useChatMessages(
    effectiveChatId ?? undefined,
    workspaceId ? workspaceId : undefined,
  );

  const [localChatId, setLocalChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const { createChat } = useCreateChat();

  useEffect(() => {
    setOverrideChatId(null);
  }, [routeChatId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    if (prevWorkspaceRef.current && prevWorkspaceRef.current !== workspaceId) {
      setOverrideChatId(null);
      setLocalChatId(null);
      setLocalMessages([]);
      setStreamError(null);
      setIsStreaming(false);
      navigate(`/workspaces/${workspaceId}/chat`);
    }
    prevWorkspaceRef.current = workspaceId;
  }, [workspaceId, navigate]);

  useEffect(() => {
    if (localChatId !== effectiveChatId) {
      setLocalChatId(effectiveChatId);
      setLocalMessages([]);
      setStreamError(null);
      setIsStreaming(false);
    }
  }, [effectiveChatId, localChatId]);

  const visibleMessages =
    effectiveChatId && localChatId === effectiveChatId
      ? [...(fetchedMessages ?? []), ...localMessages]
      : fetchedMessages ?? [];

  const normalizedMessagesError = useMemo(() => {
    if (!isMessagesError || !messagesError) {
      return null;
    }
    const message = messagesError.message ?? "Ошибка загрузки диалога";
    if (message.startsWith("404")) {
      return "Диалог не найден или у вас нет доступа.";
    }
    if (message.startsWith("403")) {
      return "У вас нет прав на просмотр этого диалога.";
    }
    return message.replace(/^\d+:\s*/, "");
  }, [isMessagesError, messagesError]);

  const handleSelectChat = useCallback(
    (nextChatId: string | null) => {
      if (!workspaceId) {
        return;
      }
      setStreamError(null);
      if (nextChatId) {
        navigate(`/workspaces/${workspaceId}/chat/${nextChatId}`);
      } else {
        navigate(`/workspaces/${workspaceId}/chat`);
      }
    },
    [navigate, workspaceId],
  );

  const streamMessage = useCallback(
    async (targetChatId: string, content: string) => {
      if (!workspaceId) {
        return;
      }
    const userMessage = buildLocalMessage("user", targetChatId, content);
    const assistantMessage = buildLocalMessage("assistant", targetChatId, "");
    setLocalChatId(targetChatId);
    setLocalMessages([userMessage, assistantMessage]);
    setIsStreaming(true);

    try {
      await sendChatMessageLLM({
        chatId: targetChatId,
        workspaceId,
        content,
        handlers: {
          onDelta: (delta) => {
            setLocalMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            );
          },
          onDone: async () => {
            setLocalMessages([]);
            await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
          },
          onError: (error) => {
            setStreamError(error.message);
          },
        },
      });
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStreaming(false);
    }
  },
    [queryClient, workspaceId],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!workspaceId || isStreaming) {
        return;
      }
      setStreamError(null);

      const targetChatId = effectiveChatId;
      if (targetChatId) {
        await streamMessage(targetChatId, content);
        return;
      }

      if (!defaultSkill) {
        setStreamError("Не найден системный навык Unica Chat.");
        return;
      }

      try {
        const newChat = await createChat({
          workspaceId,
          skillId: defaultSkill.id,
        });
        setOverrideChatId(newChat.id);
        handleSelectChat(newChat.id);
        await streamMessage(newChat.id, content);
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      workspaceId,
      isStreaming,
      effectiveChatId,
      defaultSkill,
      createChat,
      handleSelectChat,
      streamMessage,
    ],
  );

  const isNewChat = !effectiveChatId;
  const skillLabel = activeSkill?.name ?? activeChat?.skillName ?? "Unica Chat";
  const chatTitle = activeChat?.title ?? null;
  const disableInput = !workspaceId || isStreaming || Boolean(normalizedMessagesError && !isNewChat);

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex h-full">
        <ChatSidebar
          workspaceId={workspaceId}
          selectedChatId={effectiveChatId ?? undefined}
          onSelectChat={handleSelectChat}
          onCreateNewChat={() => handleSelectChat(null)}
        />
        <section className="flex flex-1 flex-col">
          <ChatMessagesArea
            chatTitle={chatTitle}
            skillName={skillLabel}
            messages={visibleMessages}
            isLoading={isMessagesLoading && !isNewChat}
            isNewChat={isNewChat}
            isStreaming={isStreaming}
            streamError={streamError}
            errorMessage={normalizedMessagesError}
            onReset={() => handleSelectChat(null)}
          />
          <ChatInput
            onSend={handleSend}
            disabled={disableInput}
            placeholder={
              isNewChat ? "Начните с первого вопроса..." : "Введите сообщение и нажмите Enter"
            }
          />
        </section>
      </div>
    </div>
  );
}

function buildLocalMessage(
  role: ChatMessage["role"],
  chatId: string,
  content: string,
): ChatMessage {
  return {
    id: `local-${role}-${Date.now()}`,
    chatId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
