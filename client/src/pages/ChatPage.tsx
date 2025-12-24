import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessagesArea from "@/components/chat/ChatMessagesArea";
import ChatInput, { type TranscribePayload } from "@/components/chat/ChatInput";
import { TranscriptCanvas } from "@/components/chat/TranscriptCanvas";
import { useChats, useChatMessages, useCreateChat, sendChatMessageLLM } from "@/hooks/useChats";
import { throwIfResNotOk } from "@/lib/queryClient";
import { useSkills } from "@/hooks/useSkills";
import { formatApiErrorMessage, isApiError } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage } from "@/types/chat";
import { resolveAssistantActionVisibility } from "@/lib/assistantAction";

const ARCHIVE_ERROR_MESSAGES: Record<string, string> = {
  CHAT_ARCHIVED: "Чат архивирован. Отправка недоступна.",
  SKILL_ARCHIVED: "Навык архивирован. Отправка недоступна.",
};

type ArchiveReadOnlyReason = "chat" | "skill";

type ChatPageParams = {
  workspaceId?: string;
  chatId?: string;
};

type ChatPageProps = {
  params: ChatPageParams;
};

const isDev = import.meta.env.DEV;
const debugLog = (...args: unknown[]) => {
  if (isDev) {
    console.info(...args);
  }
};

export default function ChatPage({ params }: ChatPageProps) {
  const workspaceId = params?.workspaceId ?? "";
  const routeChatId = params?.chatId ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const prevWorkspaceRef = useRef<string | null>(workspaceId);

  const [overrideChatId, setOverrideChatId] = useState<string | null>(null);
  const effectiveChatId = routeChatId || overrideChatId || null;
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  const { chats } = useChats(workspaceId, undefined, { refetchIntervalMs: false });
  const activeChat = chats.find((chat) => chat.id === effectiveChatId) ?? null;
  const activeAssistantAction = activeChat?.currentAssistantAction ?? null;

  const { skills } = useSkills({
    workspaceId: workspaceId || null,
    enabled: Boolean(workspaceId),
    includeArchived: true,
  });
  const defaultSkill = useMemo(
    () => skills.find((skill) => skill.isSystem && skill.systemKey === "UNICA_CHAT") ?? null,
    [skills],
  );
  const activeSkill = useMemo(() => {
    if (activeChat) {
      return skills.find((skill) => skill.id === activeChat.skillId) ?? null;
    }
    return defaultSkill;
  }, [activeChat, defaultSkill, skills]);

  const [localChatId, setLocalChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const { toast } = useToast();
  const resolveArchiveErrorMessage = (error: unknown): string | null => {
    if (isApiError(error) && error.code) {
      return ARCHIVE_ERROR_MESSAGES[error.code] ?? null;
    }
    return null;
  };
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [openTranscript, setOpenTranscript] = useState<{ id: string; tabId?: string | null } | null>(null);

  const { createChat } = useCreateChat();
  const [creatingSkillId, setCreatingSkillId] = useState<string | null>(null);

  const {
    messages: fetchedMessages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
    refetch: refetchMessages,
  } = useChatMessages(effectiveChatId ?? undefined, workspaceId || undefined, {
    refetchIntervalMs: effectiveChatId && isStreaming ? 1000 : false,
  });
  const chatMessagesQueryKey = useMemo(
    () => ["chat-messages", workspaceId || "unknown", effectiveChatId || "none"],
    [workspaceId, effectiveChatId],
  );

  useEffect(() => {
    setOverrideChatId(null);
  }, [routeChatId]);

  useEffect(() => {
    if (isDev) {
      (window as typeof window & { __chatWorkspaceId?: string | null }).__chatWorkspaceId = workspaceId || null;
    }
  }, [workspaceId]);

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

  useEffect(() => {
    setOpenTranscript(null);
  }, [effectiveChatId]);

  useEffect(() => {
    if (!workspaceId || !effectiveChatId) {
      return;
    }
    const url = new URL(`/api/chats/${effectiveChatId}/events`, window.location.origin);
    if (workspaceId) {
      url.searchParams.set("workspaceId", workspaceId);
    }
    const source = new EventSource(url.toString(), { withCredentials: true });
    source.onopen = () => {
      setStreamError(null);
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: string; message?: ChatMessage };
        if (payload?.type === "message" && payload.message) {
          setLocalMessages((prev) => {
            if (prev.some((local) => areMessagesEquivalent(local, payload.message!))) {
              return prev;
            }
            return [...prev, payload.message!];
          });
          queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey });
        }
      } catch (error) {
        debugLog("Failed to parse SSE event", error);
      }
    };
    source.onerror = () => {
      setStreamError("Не удалось подключиться к каналу чата.");
    };
    return () => {
      source.close();
    };
  }, [effectiveChatId, workspaceId, queryClient, chatMessagesQueryKey]);

  const shouldShowLocal = Boolean(
    effectiveChatId && localChatId === effectiveChatId && localMessages.length > 0,
  );

  const visibleMessages = useMemo(() => {
    const base = fetchedMessages ?? [];
    if (!shouldShowLocal) {
      return base;
    }
    const deduped = base.filter(
      (message) => !localMessages.some((local) => areMessagesEquivalent(local, message)),
    );
    const combined = [...deduped, ...localMessages];
    return combined.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [fetchedMessages, localMessages, shouldShowLocal]);

  const effectiveAssistantAction = useMemo(
    () => resolveAssistantActionVisibility(activeAssistantAction, visibleMessages),
    [activeAssistantAction, visibleMessages],
  );

  const normalizedMessagesError = useMemo(() => {
    if (!isMessagesError || !messagesError) {
      return null;
    }
    const message = messagesError.message ?? "Failed to load chat history.";
    if (message.startsWith("404")) {
      return "Chat not found or not accessible.";
    }
    if (message.startsWith("403")) {
      return "You do not have permission to view this chat.";
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
      debugLog("[chat] streamMessage start", { chatId: targetChatId, workspaceId });
    const userMessage = buildLocalMessage("user", targetChatId, content);
    // Создаём временный ассистентский bubble только если будем реально стримить дельты.
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
                  message.id === assistantMessage.id ? { ...message, content: `${message.content}${delta}` } : message,
                ),
              );
            },
            onDone: async () => {
              // После завершения стрима убираем локальный ассистентский placeholder,
              // чтобы не осталось пустого bubble: сервер отдаст финальный ответ через refetch.
              setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
              await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
              await queryClient.invalidateQueries({ queryKey: ["chats"] });
              debugLog("[chat] streamMessage finished", { chatId: targetChatId });
            },
            onError: (error) => {
              debugLog("[chat] streamMessage error", error);
              const archiveMessage = resolveArchiveErrorMessage(error);
              setStreamError(archiveMessage ?? formatApiErrorMessage(error));
              // При ошибке тоже удаляем placeholder, чтобы не было фантома.
              setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
            },
          },
        });
      } catch (error) {
        debugLog("[chat] streamMessage failure", error);
        const archiveMessage = resolveArchiveErrorMessage(error);
        if (archiveMessage) {
          toast({ title: archiveMessage, variant: "destructive" });
          setStreamError(archiveMessage);
        } else {
          setStreamError(formatApiErrorMessage(error));
        }
        setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
      } finally {
        setIsStreaming(false);
      }
    },
    [queryClient, workspaceId],
  );

  const handleCreateChatForSkill = useCallback(
    async (skillId: string) => {
      if (!workspaceId || creatingSkillId) {
        return;
      }
      setCreatingSkillId(skillId);
      try {
        const newChat = await createChat({
          workspaceId,
          skillId,
        });
        setOverrideChatId(newChat.id);
        handleSelectChat(newChat.id);
      } catch (error) {
        setStreamError(formatApiErrorMessage(error));
      } finally {
        setCreatingSkillId((prev) => (prev === skillId ? null : prev));
      }
    },
    [workspaceId, creatingSkillId, createChat, handleSelectChat],
  );

  const handleCreateNewChat = useCallback(async () => {
    if (!defaultSkill) {
      setStreamError("Unica Chat skill is not configured. Please contact the administrator.");
      return;
    }
    await handleCreateChatForSkill(defaultSkill.id);
  }, [defaultSkill, handleCreateChatForSkill]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!workspaceId || isStreaming) {
        debugLog("[chat] handleSend skipped", { workspaceId, isStreaming });
        return;
      }
      setStreamError(null);

      const targetChatId = effectiveChatId;
      if (targetChatId) {
        debugLog("[chat] sending message to existing chat", { chatId: targetChatId });
        await streamMessage(targetChatId, content);
        return;
      }

      if (!defaultSkill) {
        setStreamError("Unica Chat skill is not configured. Please contact the administrator.");
        return;
      }

      try {
        const newChat = await createChat({
          workspaceId,
          skillId: defaultSkill.id,
        });
        debugLog("[chat] created new chat", { chatId: newChat.id });
        setOverrideChatId(newChat.id);
        try {
          await streamMessage(newChat.id, content);
        } finally {
          handleSelectChat(newChat.id);
        }
      } catch (error) {
        debugLog("[chat] failed to create chat", error);
        setStreamError(formatApiErrorMessage(error));
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

  const handleSendFile = useCallback(
    async (file: File) => {
      if (!workspaceId) return;
      let targetChatId = effectiveChatId;
      if (!targetChatId) {
        if (!defaultSkill) {
          setStreamError("Unica Chat skill is not configured. Please contact the administrator.");
          return;
        }
        const newChat = await createChat({ workspaceId, skillId: defaultSkill.id });
        setOverrideChatId(newChat.id);
        targetChatId = newChat.id;
        handleSelectChat(newChat.id);
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspaceId", workspaceId);

      const response = await fetch(`/api/chat/sessions/${targetChatId}/messages/file`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      await throwIfResNotOk(response);
      await refetchMessages();
    },
    [workspaceId, effectiveChatId, defaultSkill, createChat, handleSelectChat, refetchMessages],
  );

  const handleTranscription = useCallback(
    async (input: TranscribePayload) => {
      if (!workspaceId) return;
      setIsTranscribing(true);

      let operationId: string | null = null;
      let fileName = "audio";
      let providedChatId: string | null = null;
      let serverAudioMessage: ChatMessage | null = null;
      let serverPlaceholder: ChatMessage | null = null;

      if (typeof input === "string") {
        if (!input.startsWith("__PENDING_OPERATION:")) {
          setIsTranscribing(false);
          return;
        }
        const parts = input.substring("__PENDING_OPERATION:".length).split(":");
        operationId = parts[0] ?? null;
        fileName = parts[1] ? decodeURIComponent(parts[1]) : "audio";
      } else {
        operationId = input.operationId;
        fileName = input.fileName || "audio";
        providedChatId = input.chatId ?? null;
        serverAudioMessage = input.audioMessage ?? null;
        serverPlaceholder = input.placeholderMessage ?? null;
      }

      if (!operationId) {
        setIsTranscribing(false);
        return;
      }

      let targetChatId = effectiveChatId;
      if (providedChatId) {
        targetChatId = providedChatId;
      }
      if (!targetChatId) {
        const skillId = activeChat?.skillId ?? activeSkill?.id ?? defaultSkill?.id;
        if (!skillId) {
          setStreamError('Unica Chat skill is not configured. Please contact the administrator.');
          setIsTranscribing(false);
          return;
        }
        try {
          const newChat = await createChat({ workspaceId, skillId });
          targetChatId = newChat.id;
          setOverrideChatId(newChat.id);
          handleSelectChat(newChat.id);
        } catch (error) {
          setStreamError(formatApiErrorMessage(error));
          setIsTranscribing(false);
          return;
        }
      }

      if (targetChatId) {
        const audioMessageTime = serverAudioMessage?.createdAt
          ? new Date(serverAudioMessage.createdAt)
          : new Date();
        const placeholderId = serverPlaceholder?.id ?? `local-transcript-${Date.now()}`;
        const audioMessage: ChatMessage =
          serverAudioMessage ?? {
            id: `local-audio-${Date.now()}`,
            chatId: targetChatId,
            role: "user",
            content: fileName || "Audio file",
            metadata: {
              type: "audio",
              fileName: fileName || "Audio file",
            },
            createdAt: audioMessageTime.toISOString(),
          };

        const placeholderMessage: ChatMessage =
          serverPlaceholder ?? {
            id: placeholderId,
            chatId: targetChatId,
            role: "assistant",
            content: "Идёт расшифровка аудиозаписи...",
            metadata: {
              type: "transcript",
              transcriptId: placeholderId,
              transcriptStatus: "processing",
            },
            createdAt: new Date(audioMessageTime.getTime() + 1000).toISOString(),
          };
        setLocalChatId(targetChatId);
        setLocalMessages((prev) => {
          const filtered = prev.filter(
            (msg) => msg.id !== audioMessage.id && msg.id !== placeholderMessage.id,
          );
          return [...filtered, audioMessage, placeholderMessage];
        });
        // Обновляем список чатов: название может смениться после загрузки аудио
        queryClient.invalidateQueries({ queryKey: ["chats"] }).catch(() => {});

        const pollOperation = async () => {
          let attempts = 0;
          const maxAttempts = 900; // до ~30 минут при интервале 2с
          const delayMs = 2000;

          while (attempts < maxAttempts) {
            try {
              const response = await fetch(`/api/chat/transcribe/operations/${operationId}`, {
                method: 'GET',
                credentials: 'include',
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const status = await response.json();

              if (status.status === 'completed') {
                const completeRes = await fetch(`/api/chat/transcribe/complete/${operationId}`, {
                  method: 'POST',
                  credentials: 'include',
                });
                
                if (completeRes.ok) {
                  const completeData = await completeRes.json();
                  if (completeData.message) {
                    setLocalMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === placeholderMessage.id
                          ? {
                              ...completeData.message,
                              createdAt: completeData.message.createdAt,
                            }
                          : msg,
                      )
                    );
                    await queryClient.invalidateQueries({ queryKey: ["chats"] });
                  } else {
                    setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderMessage.id));
                    await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                    await queryClient.invalidateQueries({ queryKey: ["chats"] });
                  }
                } else {
                  setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderMessage.id));
                  await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                  await queryClient.invalidateQueries({ queryKey: ["chats"] });
                }
                return;
              }

              if (status.status === 'failed') {
                setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderMessage.id));
                setStreamError(status.error || 'Транскрибация не удалась. Попробуйте снова.');
                await queryClient.invalidateQueries({ queryKey: ["chats"] });
                return;
              }

              attempts += 1;
              if (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
            } catch (error) {
              console.error('[ChatPage] Poll error:', error);
              attempts += 1;
              if (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
            }
          }

          setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderMessage.id));
          setStreamError('Транскрибация заняла слишком много времени. Попробуйте снова.');
        };

        await pollOperation();
      }
      setIsTranscribing(false);
    },
    [
      activeChat?.skillId,
      activeSkill?.id,
      createChat,
      defaultSkill?.id,
      effectiveChatId,
      handleSelectChat,
      queryClient,
      workspaceId,
    ],
  );

  const isNewChat = !effectiveChatId;
  const skillLabel = activeSkill?.name ?? activeChat?.skillName ?? "Unica Chat";
  const chatTitle = activeChat?.title ?? null;
  const chatArchived = activeChat?.status === "archived";
  const skillArchived = activeSkill?.status === "archived";
  const readOnlyReason: ArchiveReadOnlyReason | null = chatArchived ? "chat" : skillArchived ? "skill" : null;
  const isReadOnlyChat = Boolean(readOnlyReason);
  const disableInput = !workspaceId || isStreaming || Boolean(normalizedMessagesError && !isNewChat) || isReadOnlyChat;
  const isDefaultCreating = creatingSkillId !== null && creatingSkillId === (defaultSkill?.id ?? null);
  const readOnlyHint =
    readOnlyReason === "skill"
      ? "Навык архивирован, ввод недоступен"
      : readOnlyReason === "chat"
        ? "Чат архивирован, ввод недоступен"
        : undefined;
  const placeholder =
    readOnlyReason === "skill"
      ? "Навык архивирован и доступен только для чтения"
      : readOnlyReason === "chat"
        ? "Чат архивирован и доступен только для чтения"
        : isNewChat
          ? "Спросите что-нибудь..."
          : "Введите сообщение...";

  useEffect(() => {
    document.body.classList.add("chat-scroll-locked");
    return () => {
      document.body.classList.remove("chat-scroll-locked");
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden" data-testid="chat-page">
      <ChatSidebar
        workspaceId={workspaceId}
        selectedChatId={effectiveChatId ?? undefined}
        onSelectChat={handleSelectChat}
        onCreateNewChat={handleCreateNewChat}
        onCreateChatForSkill={handleCreateChatForSkill}
        isCreatingChat={isDefaultCreating}
        creatingSkillId={creatingSkillId}
        className="w-[400px] shrink-0"
      />

      <section className={cn(
        "flex min-h-0 flex-1 overflow-hidden",
        openTranscript ? "flex-row" : "flex-col"
      )}>
        <div className="flex min-h-0 flex-col flex-1 overflow-hidden">
          <ChatMessagesArea
              chatTitle={chatTitle}
              skillName={skillLabel}
              assistantAction={effectiveAssistantAction}
              isReadOnly={isReadOnlyChat}
              messages={visibleMessages}
              isLoading={isMessagesLoading && !isNewChat}
              isNewChat={isNewChat}
              isStreaming={isStreaming}
              isTranscribing={isTranscribing}
              streamError={streamError}
              errorMessage={normalizedMessagesError}
              scrollContainerRef={messagesScrollRef}
              onReset={() => handleSelectChat(null)}
              onOpenTranscript={(id: string, defaultTabId?: string | null) =>
                setOpenTranscript({ id, tabId: defaultTabId ?? null })
              }
              readOnlyReason={readOnlyReason}
            />
          <div className="shrink-0">
          <ChatInput
            onSend={handleSend}
            onTranscribe={handleTranscription}
            onSendFile={handleSendFile}
            disabled={disableInput}
            readOnlyHint={readOnlyHint}
            chatId={effectiveChatId ?? null}
            placeholder={
              placeholder
            }
            disableAudioTranscription={activeSkill?.executionMode === "no_code"}
          />
          </div>
        </div>
        {openTranscript?.id && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <TranscriptCanvas
              workspaceId={workspaceId}
              chatId={effectiveChatId ?? ""}
              transcriptId={openTranscript.id}
              skillId={activeSkill?.id}
              initialTabId={openTranscript.tabId ?? null}
              onClose={() => setOpenTranscript(null)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function buildLocalMessage(role: ChatMessage["role"], chatId: string, content: string, timestamp?: Date): ChatMessage {
  const date = timestamp || new Date();
  return {
    id: `local-${role}-${Date.now()}`,
    chatId,
    role,
    content,
    createdAt: date.toISOString(),
  };
}

function areMessagesEquivalent(a?: ChatMessage, b?: ChatMessage): boolean {
  if (!a || !b) {
    return false;
  }

  if (a.id === b.id) {
    return true;
  }

  const normalizedContent = (value?: string | null) => (value ?? "").trim();
  if (
    a.role === b.role &&
    normalizedContent(a.content) === normalizedContent(b.content) &&
    normalizedContent(a.content) !== ""
  ) {
    return true;
  }

  if (isSameTranscript(a, b) || isSameAudio(a, b)) {
    return true;
  }

  return false;
}

function isSameTranscript(a?: ChatMessage, b?: ChatMessage): boolean {
  return (
    a?.metadata?.type === "transcript" &&
    b?.metadata?.type === "transcript" &&
    Boolean(a?.metadata?.transcriptId) &&
    Boolean(b?.metadata?.transcriptId) &&
    a?.metadata?.transcriptId === b?.metadata?.transcriptId
  );
}

function isSameAudio(a?: ChatMessage, b?: ChatMessage): boolean {
  return (
    a?.metadata?.type === "audio" &&
    b?.metadata?.type === "audio" &&
    Boolean(a?.metadata?.fileName) &&
    Boolean(b?.metadata?.fileName) &&
    a?.metadata?.fileName === b?.metadata?.fileName
  );
}
