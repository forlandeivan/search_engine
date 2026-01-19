import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessagesArea from "@/components/chat/ChatMessagesArea";
import ChatInput, { type TranscribePayload } from "@/components/chat/ChatInput";
import { BotActionIndicatorRow } from "@/components/chat/BotActionIndicatorRow";
import type { BotAction } from "@shared/schema";
import { computeCurrentAction, countOtherActiveActions } from "@/lib/botAction";
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
  const [fileUploadState, setFileUploadState] = useState<
    { fileName: string; size: number | null; status: "uploading" | "error" } | null
  >(null);
  const fileUploadAbortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const resolveArchiveErrorMessage = (error: unknown): string | null => {
    if (isApiError(error) && error.code) {
      return ARCHIVE_ERROR_MESSAGES[error.code] ?? null;
    }
    return null;
  };
  // Храним список всех активных actions по chatId (даже если UI показывает одну строку)
  const [botActionsByChatId, setBotActionsByChatId] = useState<Record<string, BotAction[]>>({});
  const [openTranscript, setOpenTranscript] = useState<{ id: string; tabId?: string | null } | null>(null);
  const botActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Initial fetch of active bot_actions on mount / chatId change (cold start recovery)
  useEffect(() => {
    if (!workspaceId || !effectiveChatId) {
      setBotActionsByChatId((prev) => {
        if (!effectiveChatId) {
          return prev;
        }
        const next = { ...prev };
        delete next[effectiveChatId];
        return next;
      });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/chat/actions?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(effectiveChatId)}`;
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          debugLog("[BotAction] Failed to fetch active actions", response.status);
          return;
        }
        const data = (await response.json()) as { actions: BotAction[] };
        if (cancelled) return;
        // Server returns only processing actions by default, sorted by updatedAt desc
        // Сохраняем весь список активных actions
        setBotActionsByChatId((prev) => ({
          ...prev,
          [effectiveChatId]: data.actions,
        }));
      } catch (error) {
        debugLog("[BotAction] Error fetching active actions", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, effectiveChatId]);

  // SSE connection: listen for messages and bot_action events
  useEffect(() => {
    if (!workspaceId || !effectiveChatId) {
      return;
    }
    const url = new URL(`/api/chat/sessions/${effectiveChatId}/events`, window.location.origin);
    if (workspaceId) {
      url.searchParams.set("workspaceId", workspaceId);
    }
    const source = new EventSource(url.toString(), { withCredentials: true });
    let reconnectRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

    // Handle both named 'message' events and default onmessage
    source.addEventListener('message', (event) => {
      try {
        debugLog("[SSE] Received named 'message' event", { eventType: event.type, dataLength: event.data?.length });
        const payload = JSON.parse(event.data) as {
          type: string;
          message?: ChatMessage;
          action?: BotAction;
        };
        debugLog("[SSE] Parsed payload from named event", { payloadType: payload?.type, hasMessage: !!payload?.message, hasAction: !!payload?.action, messageId: payload?.message?.id });
        if (payload?.type === "message" && payload.message) {
          setLocalMessages((prev) => {
            // Check for duplicates by ID only (not by content), as same content can be sent multiple times
            if (prev.some((local) => local.id === payload.message!.id)) {
              debugLog("[SSE] Message already exists, skipping", { messageId: payload.message!.id });
              return prev;
            }
            return [...prev, payload.message!];
          });
          queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey });
        } else if (payload?.type === "bot_action" && payload.action) {
          const action = payload.action;
          setBotActionsByChatId((prev) => {
            const chatActions = prev[action.chatId] ?? [];
            const existingIndex = chatActions.findIndex((a) => a.actionId === action.actionId);

            // Out-of-order protection: проверяем updatedAt
            if (existingIndex >= 0) {
              const existing = chatActions[existingIndex];
              const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
              const actionTime = action.updatedAt ? new Date(action.updatedAt).getTime() : 0;

              // Игнорируем более старые события для того же actionId
              if (actionTime < existingTime) {
                return prev; // Игнорируем out-of-order
              }

              // Проверка на дубликат (избегаем лишних re-render)
              if (
                existing.status === action.status &&
                existingTime === actionTime &&
                existing.displayText === action.displayText &&
                JSON.stringify(existing.payload) === JSON.stringify(action.payload)
              ) {
                return prev; // Тот же объект, не обновляем
              }
            }

            // Обновляем или добавляем action
            const next = [...chatActions];
            if (existingIndex >= 0) {
              next[existingIndex] = action;
            } else {
              next.push(action);
            }

            // Удаляем из списка активных, если action завершён (done/error)
            const filtered = next.filter((a) => a.status === "processing" || a.actionId === action.actionId);

            return {
              ...prev,
              [action.chatId]: filtered,
            };
          });
        }
      } catch (error) {
        debugLog("Failed to parse SSE named event", error);
      }
    });

    source.onopen = () => {
      setStreamError(null);
      // Reconnect recovery: fetch active bot_action after reconnect
      if (reconnectRecoveryTimer) {
        clearTimeout(reconnectRecoveryTimer);
      }
      reconnectRecoveryTimer = setTimeout(async () => {
        try {
          const url = `/api/chat/actions?workspaceId=${encodeURIComponent(workspaceId)}&chatId=${encodeURIComponent(effectiveChatId)}`;
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) return;
          const data = (await response.json()) as { actions: BotAction[] };
          // Server returns only processing actions by default, sorted by updatedAt desc
          // Обновляем список активных actions, сохраняя более свежие локальные состояния
          setBotActionsByChatId((prev) => {
            const current = prev[effectiveChatId] ?? [];
            const serverActions = data.actions;
            // Объединяем: берём более свежую версию каждого actionId
            const merged = new Map<string, BotAction>();
            // Сначала добавляем локальные
            for (const action of current) {
              if (action.status === "processing") {
                merged.set(action.actionId, action);
              }
            }
            // Затем обновляем/добавляем серверные (более свежие побеждают)
            for (const action of serverActions) {
              const existing = merged.get(action.actionId);
              if (!existing) {
                merged.set(action.actionId, action);
              } else {
                const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                const serverTime = action.updatedAt ? new Date(action.updatedAt).getTime() : 0;
                if (serverTime >= existingTime) {
                  merged.set(action.actionId, action);
                }
              }
            }
            return {
              ...prev,
              [effectiveChatId]: Array.from(merged.values()),
            };
          });
        } catch (error) {
          debugLog("[BotAction] Reconnect recovery failed", error);
        }
      }, 300);
    };

    source.onmessage = (event) => {
      try {
        debugLog("[SSE] Received event", { eventType: event.type, dataLength: event.data?.length });
        const payload = JSON.parse(event.data) as {
          type: string;
          message?: ChatMessage;
          action?: BotAction;
        };
        debugLog("[SSE] Parsed payload", { payloadType: payload?.type, hasMessage: !!payload?.message, hasAction: !!payload?.action, messageId: payload?.message?.id });
        if (payload?.type === "message" && payload.message) {
          setLocalMessages((prev) => {
            // Check for duplicates by ID only (not by content), as same content can be sent multiple times
            if (prev.some((local) => local.id === payload.message!.id)) {
              debugLog("[SSE] Message already exists, skipping", { messageId: payload.message!.id });
              return prev;
            }
            return [...prev, payload.message!];
          });
          queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey });
        } else if (payload?.type === "bot_action" && payload.action) {
          const action = payload.action;
          setBotActionsByChatId((prev) => {
            const chatActions = prev[action.chatId] ?? [];
            const existingIndex = chatActions.findIndex((a) => a.actionId === action.actionId);

            // Out-of-order protection: проверяем updatedAt
            if (existingIndex >= 0) {
              const existing = chatActions[existingIndex];
              const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
              const actionTime = action.updatedAt ? new Date(action.updatedAt).getTime() : 0;

              // Игнорируем более старые события для того же actionId
              if (actionTime < existingTime) {
                return prev; // Игнорируем out-of-order
              }

              // Проверка на дубликат (избегаем лишних re-render)
              if (
                existing.status === action.status &&
                existingTime === actionTime &&
                existing.displayText === action.displayText &&
                JSON.stringify(existing.payload) === JSON.stringify(action.payload)
              ) {
                return prev; // Тот же объект, не обновляем
              }
            }

            // Обновляем или добавляем action
            const next = [...chatActions];
            if (existingIndex >= 0) {
              next[existingIndex] = action;
            } else {
              next.push(action);
            }

            // Удаляем из списка активных, если action завершён (done/error)
            const filtered = next.filter((a) => a.status === "processing" || a.actionId === action.actionId);

            return {
              ...prev,
              [action.chatId]: filtered,
            };
          });
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
      if (reconnectRecoveryTimer) {
        clearTimeout(reconnectRecoveryTimer);
      }
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
      const controller = new AbortController();
      fileUploadAbortRef.current?.abort();
      fileUploadAbortRef.current = controller;
      setFileUploadState({ fileName: file.name, size: file.size ?? null, status: "uploading" });
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

      try {
        const response = await fetch(
          `/api/chat/sessions/${targetChatId}/messages/file?workspaceId=${encodeURIComponent(
            workspaceId,
          )}`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
            signal: controller.signal,
          },
        );
        await throwIfResNotOk(response);
        setFileUploadState(null);
        await refetchMessages();
      } catch (error) {
        if (controller.signal.aborted) {
          setFileUploadState(null);
          return;
        }
        const message = formatApiErrorMessage(error);
        setFileUploadState({ fileName: file.name, size: file.size ?? null, status: "error" });
        setStreamError(message);
        toast({
          title: "Не удалось отправить файл",
          description: message,
          variant: "destructive",
        });
      }
    },
    [workspaceId, effectiveChatId, defaultSkill, createChat, handleSelectChat, refetchMessages],
  );

  const handleCancelFileUpload = useCallback(() => {
    fileUploadAbortRef.current?.abort();
    setFileUploadState(null);
  }, []);

  const handleTranscription = useCallback(
    async (input: TranscribePayload) => {
      if (!workspaceId) return;
      const showBotAction = (text: string, status: BotAction["status"], actionType: BotAction["actionType"] = "transcribe_audio") => {
        if (botActionTimerRef.current) {
          clearTimeout(botActionTimerRef.current);
          botActionTimerRef.current = null;
        }
        const targetChat = (typeof input !== "string" && input.chatId) || effectiveChatId || "local-chat";
        const actionId = (typeof input !== "string" && input.operationId) || `local-${Date.now()}`;
        const action: BotAction = {
          workspaceId: workspaceId || "local-workspace",
          chatId: targetChat || "local-chat",
          actionId,
          actionType,
          status,
          displayText: text,
          updatedAt: new Date().toISOString(),
        };
        setBotActionsByChatId((prev) => {
          const chatActions = prev[action.chatId] ?? [];
          const existingIndex = chatActions.findIndex((a) => a.actionId === actionId);
          const next = [...chatActions];
          if (existingIndex >= 0) {
            next[existingIndex] = action;
          } else {
            next.push(action);
          }
          // Удаляем из списка активных, если action завершён
          const filtered = next.filter((a) => a.status === "processing" || a.actionId === actionId);
          return {
            ...prev,
            [action.chatId]: filtered,
          };
        });
        if (status === "done" || status === "error") {
          botActionTimerRef.current = setTimeout(() => {
            setBotActionsByChatId((prev) => {
              const chatActions = prev[action.chatId] ?? [];
              const filtered = chatActions.filter((a) => a.actionId !== actionId);
              return {
                ...prev,
                [action.chatId]: filtered,
              };
            });
          }, 1800);
        }
      };

      let operationId: string | null = null;
      let fileName = "audio";
      let providedChatId: string | null = null;
      let serverAudioMessage: ChatMessage | null = null;
      const isUploadedFlow = typeof input !== "string" && input.status === "uploaded";

      if (typeof input === "string") {
        if (!input.startsWith("__PENDING_OPERATION:")) {
          // Очищаем локальные actions для этого чата при ошибке
          const targetChat = effectiveChatId || "local-chat";
          setBotActionsByChatId((prev) => {
            const next = { ...prev };
            if (next[targetChat]) {
              next[targetChat] = next[targetChat].filter((a) => !a.actionId.startsWith("local-"));
            }
            return next;
          });
          return;
        }
        const parts = input.substring("__PENDING_OPERATION:".length).split(":");
        operationId = parts[0] ?? null;
        fileName = parts[1] ? decodeURIComponent(parts[1]) : "audio";
      } else {
        operationId = input.operationId ?? null;
        fileName = input.fileName || "audio";
        providedChatId = input.chatId ?? null;
        serverAudioMessage = input.audioMessage ?? null;
        debugLog("[ChatPage] handleTranscription - parsed input", {
          isUploadedFlow,
          hasServerAudioMessage: !!serverAudioMessage,
          serverAudioMessageId: serverAudioMessage?.id,
          serverAudioMessageType: typeof serverAudioMessage?.id,
          inputKeys: Object.keys(input),
        });
      }

      let targetChatId = effectiveChatId;
      if (providedChatId) {
        targetChatId = providedChatId;
      }
      if (!targetChatId) {
        const skillId = activeChat?.skillId ?? activeSkill?.id ?? defaultSkill?.id;
        if (!skillId) {
          setStreamError('Unica Chat skill is not configured. Please contact the administrator.');
          showBotAction("Не удалось подготовить стенограмму", "error");
          return;
        }
        try {
          const newChat = await createChat({ workspaceId, skillId });
          targetChatId = newChat.id;
          setOverrideChatId(newChat.id);
          handleSelectChat(newChat.id);
        } catch (error) {
          setStreamError(formatApiErrorMessage(error));
          showBotAction("Не удалось подготовить стенограмму", "error");
          return;
        }
      }

      if (isUploadedFlow) {
        if (targetChatId && serverAudioMessage) {
          // Отправляем событие для уже загруженного аудио в no-code режиме
          debugLog("[ChatPage] Sending file event for uploaded audio", {
            chatId: targetChatId,
            messageId: serverAudioMessage.id,
            workspaceId,
          });
          try {
            const response = await fetch(
              `/api/chat/sessions/${targetChatId}/messages/${serverAudioMessage.id}/send?workspaceId=${encodeURIComponent(workspaceId)}`,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ workspaceId }),
              },
            );
            await throwIfResNotOk(response);
            debugLog("[ChatPage] File event sent successfully", {
              chatId: targetChatId,
              messageId: serverAudioMessage.id,
            });
          } catch (error) {
            console.error("[ChatPage] Failed to send uploaded audio message", error);
            // Не показываем ошибку пользователю, так как сообщение уже создано
          }

          setLocalChatId(targetChatId);
          const audioMessageTime = serverAudioMessage.createdAt ? new Date(serverAudioMessage.createdAt) : new Date();
          const audioMessage: ChatMessage = {
            ...serverAudioMessage,
            createdAt: audioMessageTime.toISOString(),
          };
          setLocalMessages((prev) => {
            const filtered = prev.filter((msg) => msg.id !== audioMessage.id);
            return [...filtered, audioMessage];
          });
          await queryClient.invalidateQueries({ queryKey: ["chat-messages"] }).catch(() => {});
          await queryClient.invalidateQueries({ queryKey: ["chats"] }).catch(() => {});
        } else {
          debugLog("[ChatPage] Cannot send file event - missing data", {
            targetChatId,
            hasServerAudioMessage: !!serverAudioMessage,
            serverAudioMessageId: serverAudioMessage?.id,
          });
        }
        showBotAction("Готово", "done");
        return;
      }

      if (!operationId) {
        // Очищаем локальные actions для этого чата при ошибке
        const targetChat = effectiveChatId || "local-chat";
        setBotActionsByChatId((prev) => {
          const next = { ...prev };
          if (next[targetChat]) {
            next[targetChat] = next[targetChat].filter((a) => !a.actionId.startsWith("local-"));
          }
          return next;
        });
        return;
      }

      if (targetChatId) {
        const audioMessageTime = serverAudioMessage?.createdAt
          ? new Date(serverAudioMessage.createdAt)
          : new Date();
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

        // Не создаём placeholder message - показываем активность через bot_action
        setLocalChatId(targetChatId);
        setLocalMessages((prev) => {
          const filtered = prev.filter((msg) => msg.id !== audioMessage.id);
          return [...filtered, audioMessage];
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
                  // Обновляем сообщения через invalidateQueries - готовый transcript появится автоматически
                  await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                  await queryClient.invalidateQueries({ queryKey: ["chats"] });
                  showBotAction("Готово", "done");
                } else {
                  await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                  await queryClient.invalidateQueries({ queryKey: ["chats"] });
                  showBotAction("Готово", "done");
                }
                return;
              }

              if (status.status === 'failed') {
                setStreamError(status.error || 'Транскрибация не удалась. Попробуйте снова.');
                showBotAction("Ошибка при стенограмме", "error");
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

          setStreamError('Транскрибация заняла слишком много времени. Попробуйте снова.');
          showBotAction("Стенограмма заняла слишком много времени", "error");
        };

        await pollOperation();
      }
      showBotAction("Готово", "done");
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

  useEffect(() => {
    return () => {
      if (botActionTimerRef.current) {
        clearTimeout(botActionTimerRef.current);
      }
    };
  }, []);

  // Вычисляем currentAction для текущего чата
  const currentBotAction = useMemo(() => {
    if (!effectiveChatId) return null;
    const allActions = Object.values(botActionsByChatId).flat();
    return computeCurrentAction(allActions, effectiveChatId);
  }, [botActionsByChatId, effectiveChatId]);

  // Подсчитываем количество других активных actions (для опционального счётчика "+N")
  const otherActiveCount = useMemo(() => {
    if (!effectiveChatId || !currentBotAction) return 0;
    const allActions = Object.values(botActionsByChatId).flat();
    return countOtherActiveActions(allActions, effectiveChatId, currentBotAction.actionId);
  }, [botActionsByChatId, effectiveChatId, currentBotAction]);

  useEffect(() => {
    if (!isDev) return;
    (window as typeof window & { __setMockBotActionIndicator?: (payload: BotAction | null) => void }).__setMockBotActionIndicator =
      (payload) => {
        if (!payload || !effectiveChatId) {
          setBotActionsByChatId((prev) => {
            const next = { ...prev };
            if (effectiveChatId) {
              delete next[effectiveChatId];
            }
            return next;
          });
          return;
        }
        setBotActionsByChatId((prev) => ({
          ...prev,
          [payload.chatId]: [payload],
        }));
      };
    return () => {
      if ((window as any).__setMockBotActionIndicator) {
        delete (window as any).__setMockBotActionIndicator;
      }
    };
  }, [isDev, effectiveChatId]);

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
              streamError={streamError}
              errorMessage={normalizedMessagesError}
              scrollContainerRef={messagesScrollRef}
              onReset={() => handleSelectChat(null)}
              onOpenTranscript={(id: string, defaultTabId?: string | null) =>
                setOpenTranscript({ id, tabId: defaultTabId ?? null })
              }
              onOpenCard={async (cardId, fallbackTranscriptId, defaultTabId) => {
                if (!workspaceId) return;
                try {
                  const response = await fetch(
                    `/api/cards/${cardId}?workspaceId=${workspaceId}`,
                    { credentials: "include" },
                  );
                  await throwIfResNotOk(response);
                  const data = await response.json();
                  const transcriptId: string | null =
                    data?.card?.transcriptId ?? fallbackTranscriptId ?? null;
                  if (!transcriptId) {
                    toast({
                      title: "Карточка не содержит транскрипт",
                      variant: "destructive",
                    });
                    return;
                  }
                  setOpenTranscript({ id: transcriptId, tabId: defaultTabId ?? null });
                } catch (error) {
                  console.error("[ChatPage] failed to open card", error);
                  toast({
                    title: "Не удалось открыть карточку",
                    variant: "destructive",
                  });
                }
              }}
              readOnlyReason={readOnlyReason}
            />
          <div className="shrink-0">
            <BotActionIndicatorRow action={currentBotAction} otherActiveCount={otherActiveCount > 0 ? otherActiveCount : undefined} />
          <ChatInput
            onSend={handleSend}
            onTranscribe={handleTranscription}
            onSendFile={handleSendFile}
            onCancelFileUpload={handleCancelFileUpload}
            fileUploadState={fileUploadState}
            disabled={disableInput}
            readOnlyHint={readOnlyHint}
            chatId={effectiveChatId ?? null}
            placeholder={
              placeholder
            }
            disableAudioTranscription={false}
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
  // Не считаем аудиофайлы эквивалентными только по имени - разные отправки одного файла должны быть разными сообщениями
  // Сравниваем только по ID сообщения или attachmentId, чтобы избежать реальных дубликатов
  if (a?.id === b?.id) {
    return true;
  }
  
  // Если есть attachmentId, сравниваем по нему (один и тот же attachmentId = одно и то же сообщение)
  const aAttachmentId = a?.file?.attachmentId ?? a?.metadata?.attachmentId;
  const bAttachmentId = b?.file?.attachmentId ?? b?.metadata?.attachmentId;
  if (aAttachmentId && bAttachmentId && aAttachmentId === bAttachmentId) {
    return true;
  }
  
  // Разные отправки одного файла - это разные сообщения, не считаем их эквивалентными
  return false;
}
