import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, Save, RotateCcw, Bold, Italic, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessagesArea from "@/components/chat/ChatMessagesArea";
import ChatInput from "@/components/chat/ChatInput";
import { useChats, useChatMessages, useCreateChat, sendChatMessageLLM, useRenameChat } from "@/hooks/useChats";
import { useSkills } from "@/hooks/useSkills";
import type { ChatMessage, Transcript } from "@/types/chat";
import type { ActionDto, SkillActionDto } from "@shared/skills";

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

function buildLocalMessage(role: ChatMessage["role"], chatId: string, content: string): ChatMessage {
  return {
    id: `local-${role}-${Date.now()}`,
    chatId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export default function ChatPage({ params }: ChatPageProps) {
  const workspaceId = params?.workspaceId ?? "";
  const routeChatId = params?.chatId ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const prevWorkspaceRef = useRef<string | null>(workspaceId);

  const [overrideChatId, setOverrideChatId] = useState<string | null>(null);
  const effectiveChatId = routeChatId || overrideChatId || null;
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [openedTranscriptId, setOpenedTranscriptId] = useState<string | null>(null);
  const [openedTranscript, setOpenedTranscript] = useState<Transcript | null>(null);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [draftTranscriptText, setDraftTranscriptText] = useState("");
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [saveTranscriptMessage, setSaveTranscriptMessage] = useState<string | null>(null);
  const [saveTranscriptError, setSaveTranscriptError] = useState<string | null>(null);
  const [isRunningActionId, setIsRunningActionId] = useState<string | null>(null);
  const [isRunningMessageActionId, setIsRunningMessageActionId] = useState<string | null>(null);
  const [isRunningToolbarActionId, setIsRunningToolbarActionId] = useState<string | null>(null);

  const { chats } = useChats(workspaceId);
  const activeChat = chats.find((chat) => chat.id === effectiveChatId) ?? null;

  const { skills } = useSkills({ enabled: Boolean(workspaceId) });
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

  const skillActionsQuery = useQuery<{
    items: { action: ActionDto; skillAction: SkillActionDto | null; ui: { effectiveLabel: string; editable: boolean } }[];
  }>({
    queryKey: ["skill-actions", activeSkill?.id],
    enabled: Boolean(activeSkill?.id),
    queryFn: async () => {
      const response = await fetch(`/api/skills/${activeSkill?.id}/actions`);
      if (!response.ok) {
        throw new Error("Failed to load actions");
      }
      return (await response.json()) as {
        items: { action: ActionDto; skillAction: SkillActionDto | null; ui: { effectiveLabel: string; editable: boolean } }[];
      };
    },
  });

const canvasActions = useMemo(() => {
    const items = skillActionsQuery.data?.items ?? [];
    return items
      .filter((item) => {
        const { action, skillAction } = item;
        if (!skillAction || !skillAction.enabled) return false;
        if (!skillAction.enabledPlacements.includes("canvas")) return false;
        return action.target === "transcript" || action.target === "selection";
      })
      .map((item) => ({
        id: item.action.id,
        label: item.ui.effectiveLabel || item.action.label,
        description: item.action.description,
        target: item.action.target,
        inputType: item.action.inputType,
        outputMode: item.action.outputMode,
      }));
  }, [skillActionsQuery.data]);

  const messageActions = useMemo(() => {
    const items = skillActionsQuery.data?.items ?? [];
    return items
      .filter((item) => {
        const { action, skillAction } = item;
        if (!skillAction || !skillAction.enabled) return false;
        if (!skillAction.enabledPlacements.includes("chat_message")) return false;
        return action.target === "message" || action.target === "selection";
      })
      .map((item) => ({
        id: item.action.id,
        label: item.ui.effectiveLabel || item.action.label,
        description: item.action.description,
        target: item.action.target,
        inputType: item.action.inputType,
        outputMode: item.action.outputMode,
        scope: item.action.scope,
      }));
  }, [skillActionsQuery.data]);

  const toolbarActions = useMemo(() => {
    const items = skillActionsQuery.data?.items ?? [];
    return items
      .filter((item) => {
        const { action, skillAction } = item;
        if (!skillAction || !skillAction.enabled) return false;
        if (!skillAction.enabledPlacements.includes("chat_toolbar")) return false;
        return action.target === "selection" || action.target === "conversation";
      })
      .map((item) => ({
        id: item.action.id,
        label: item.ui.effectiveLabel || item.action.label,
        description: item.action.description,
        target: item.action.target,
        inputType: item.action.inputType,
        outputMode: item.action.outputMode,
      }));
  }, [skillActionsQuery.data]);

  const {
    messages: fetchedMessages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
  } = useChatMessages(effectiveChatId ?? undefined, workspaceId || undefined);
  const { renameChat } = useRenameChat();

  const [localChatId, setLocalChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const { createChat } = useCreateChat();
  const [creatingSkillId, setCreatingSkillId] = useState<string | null>(null);

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

  const shouldShowLocal = Boolean(
    effectiveChatId && localChatId === effectiveChatId && localMessages.length > 0,
  );

  const visibleMessages = useMemo(() => {
    const base = fetchedMessages ?? [];
    if (!shouldShowLocal) {
      return base;
    }
    const filteredLocal = localMessages.filter((local) => {
      const localMetadata = (local.metadata ?? {}) as Record<string, unknown>;
      const localTranscriptId = localMetadata.transcriptId as string | undefined;

      return !base.some((message) => {
        const messageMetadata = (message.metadata ?? {}) as Record<string, unknown>;
        const messageTranscriptId = messageMetadata.transcriptId as string | undefined;

        // If server already returned a message for this transcript, skip local placeholder
        if (localTranscriptId && messageTranscriptId && localTranscriptId === messageTranscriptId) {
          return true;
        }

        // Fallback: same role and identical content
        return (
          local.role === message.role &&
          local.content.trim() === (message.content ?? "").trim()
        );
      });
    });

    return [...base, ...filteredLocal];
  }, [fetchedMessages, localMessages, shouldShowLocal]);

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

  useEffect(() => {
    if (openedTranscript) {
      setDraftTranscriptText(openedTranscript.fullText ?? "");
      setSaveTranscriptMessage(null);
      setSaveTranscriptError(null);
    }
  }, [openedTranscript]);

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
              await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
              debugLog("[chat] streamMessage finished", { chatId: targetChatId });
            },
            onError: (error) => {
              debugLog("[chat] streamMessage error", error);
              setStreamError(error.message);
            },
          },
        });
      } catch (error) {
        debugLog("[chat] streamMessage failure", error);
        setStreamError(error instanceof Error ? error.message : String(error));
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
        setStreamError(error instanceof Error ? error.message : String(error));
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

  const handleTranscription = useCallback(
    async (transcribed: string | { operationId: string; placeholder?: ChatMessage }) => {
      if (!workspaceId) {
        return;
      }

      if (typeof transcribed !== "string") {
        const operationId = transcribed.operationId;
        const placeholder = transcribed.placeholder;

        if (placeholder) {
          setLocalMessages((prev) => [...prev, placeholder]);
        }

        setIsTranscribing(true);
        const pollOperation = async () => {
          let attempts = 0;
          const maxAttempts = 600; // 10 minutes with 1-second polling

          while (attempts < maxAttempts) {
            try {
              const response = await fetch(`/api/chat/transcribe/operations/${operationId}`, {
                method: "GET",
                credentials: "include",
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const status = await response.json();

              if (status.status === "completed" && status.result?.text) {
                await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
                setIsTranscribing(false);
                return;
              }

              if (status.status === "failed") {
                setStreamError(status.error || "Transcription failed. Please try again.");
                setIsTranscribing(false);
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000));
              attempts++;
            } catch (error) {
              console.error("[ChatPage] Poll error:", error);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              attempts++;
            }
          }

          setStreamError("Transcription took too long. Please try again.");
          setIsTranscribing(false);
        };

        pollOperation();
        return;
      }

      // Check if this is a pending operation
      if (transcribed.startsWith("__PENDING_OPERATION:")) {
        const parts = transcribed.substring("__PENDING_OPERATION:".length).split(":");
        const operationId = parts[0];
        setIsTranscribing(true);
        
        // Poll for transcription result
        const pollOperation = async () => {
          let attempts = 0;
          const maxAttempts = 600; // 10 minutes with 1-second polling
          
          while (attempts < maxAttempts) {
            try {
              const response = await fetch(`/api/chat/transcribe/operations/${operationId}`, {
                method: "GET",
                credentials: "include",
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const status = await response.json();
              
              if (status.status === "completed" && status.result?.text) {
                await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
                setIsTranscribing(false);
                return;
              }
              
              
              if (status.status === "failed") {
                setStreamError(status.error || "Transcription failed. Please try again.");
                setIsTranscribing(false);
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000));
              attempts++;
            } catch (error) {
              console.error("[ChatPage] Poll error:", error);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              attempts++;
            }
          }
          
          setStreamError("Transcription took too long. Please try again.");
          setIsTranscribing(false);
        };

        // Start polling in background
        pollOperation();
        return;
      }

      // Handle regular transcribed text (not a pending operation)
      let targetChatId = effectiveChatId;
      if (!targetChatId) {
        if (!defaultSkill) {
          setStreamError("Unica Chat skill is not configured. Please contact the administrator.");
          return;
        }

        try {
          const newChat = await createChat({
            workspaceId,
            skillId: defaultSkill.id,
          });
          targetChatId = newChat.id;
          setOverrideChatId(newChat.id);
          handleSelectChat(newChat.id);
        } catch (error) {
          setStreamError(error instanceof Error ? error.message : String(error));
          return;
        }
      }

      // Send the transcribed text as a message
      await streamMessage(targetChatId, transcribed);
    },
    [workspaceId, effectiveChatId, defaultSkill, createChat, handleSelectChat, queryClient, streamMessage],
  );


  const handleOpenTranscript = useCallback(
    async (transcriptId: string) => {
      if (!workspaceId || !transcriptId) {
        return;
      }
      setOpenedTranscriptId(transcriptId);
      setIsTranscriptLoading(true);
      setTranscriptError(null);
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/transcripts/${transcriptId}`, {
          credentials: "include",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || `Failed to load transcript (${response.status})`);
        }
        const transcript = (await response.json()) as Transcript;
        setOpenedTranscript(transcript);
      } catch (error) {
        setTranscriptError(error instanceof Error ? error.message : "Failed to load transcript");
        setOpenedTranscript(null);
      } finally {
        setIsTranscriptLoading(false);
      }
    },
    [workspaceId],
  );

  const handleSaveTranscript = useCallback(async () => {
    if (!workspaceId || !openedTranscriptId) {
      return;
    }
    setIsSavingTranscript(true);
    setSaveTranscriptMessage(null);
    setSaveTranscriptError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/transcripts/${openedTranscriptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fullText: draftTranscriptText }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `Failed to save transcript (${response.status})`);
      }

      const updated = (await response.json()) as Transcript;
      setOpenedTranscript(updated);
      setDraftTranscriptText(updated.fullText ?? "");
      setSaveTranscriptMessage("Сохранено");
    } catch (error) {
      setSaveTranscriptError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTranscript(false);
    }
  }, [workspaceId, openedTranscriptId, draftTranscriptText]);

  const handleCloseTranscript = useCallback(() => {
    setOpenedTranscriptId(null);
    setOpenedTranscript(null);
    setTranscriptError(null);
    setDraftTranscriptText("");
    setSaveTranscriptMessage(null);
    setSaveTranscriptError(null);
  }, []);

  const handleResetTranscript = useCallback(() => {
    if (!openedTranscript) return;
    setDraftTranscriptText(openedTranscript.fullText ?? "");
    setSaveTranscriptMessage(null);
    setSaveTranscriptError(null);
  }, [openedTranscript]);

  const isNewChat = !effectiveChatId;
  const skillLabel = activeSkill?.name ?? activeChat?.skillName ?? "Unica Chat";
  const chatTitle = activeChat?.title ?? null;
  const disableInput = !workspaceId || isStreaming || Boolean(normalizedMessagesError && !isNewChat);
  const isDefaultCreating = creatingSkillId !== null && creatingSkillId === (defaultSkill?.id ?? null);
  const isTranscriptDirty =
    openedTranscript !== null && draftTranscriptText !== (openedTranscript.fullText ?? "");

  const handleRenameChat = useCallback(
    async (title: string) => {
      if (!effectiveChatId || !title.trim()) return;
      await renameChat({ chatId: effectiveChatId, title: title.trim() });
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      await queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
    [effectiveChatId, queryClient, renameChat],
  );

  const applyInlineMarkdown = useCallback(
    (prefix: string, suffix: string = prefix) => {
      const textarea = transcriptTextareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd, value } = textarea;
      const selected = value.slice(selectionStart, selectionEnd);
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const next = `${before}${prefix}${selected}${suffix}${after}`;
      setDraftTranscriptText(next);
      // restore cursor after formatting
      const newPos = selectionStart + prefix.length + selected.length + suffix.length;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      });
    },
    [],
  );

  useEffect(() => {
    document.body.classList.add("chat-scroll-locked");
    return () => {
      document.body.classList.remove("chat-scroll-locked");
    };
  }, []);

  return (
    <div className="flex h-screen min-h-0 bg-muted/20 overflow-hidden">
      <ChatSidebar
        workspaceId={workspaceId}
        selectedChatId={effectiveChatId ?? undefined}
        onSelectChat={handleSelectChat}
        onCreateNewChat={handleCreateNewChat}
        onCreateChatForSkill={handleCreateChatForSkill}
        isCreatingChat={isDefaultCreating}
        creatingSkillId={creatingSkillId}
        className="w-[320px] shrink-0 border-r border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40"
      />
      <div className={cn("flex min-h-0 flex-1 flex-row overflow-hidden", openedTranscriptId && "chat-page--with-transcript")}>
        <section
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden px-4 sm:px-6 lg:px-8 transition-all",
            openedTranscriptId ? "max-w-none px-4" : "max-w-full",
          )}
        >
          <div ref={messagesScrollRef} className="chat-scroll flex-1 overflow-y-auto">
            <div
              className={cn(
                "w-full rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900/80",
                openedTranscriptId ? "" : "mx-auto max-w-[880px]",
              )}
            >
              <ChatMessagesArea
                chatTitle={chatTitle}
                skillName={skillLabel}
                chatId={effectiveChatId}
                messages={visibleMessages}
                isLoading={isMessagesLoading && !isNewChat}
                isNewChat={isNewChat}
                isStreaming={isStreaming}
                isTranscribing={isTranscribing}
                streamError={streamError}
                errorMessage={normalizedMessagesError}
                scrollContainerRef={messagesScrollRef}
                onOpenTranscript={handleOpenTranscript}
                onRenameChat={handleRenameChat}
                messageActions={messageActions}
                messageActionsLoading={skillActionsQuery.isLoading}
                messageActionsError={
                  skillActionsQuery.error instanceof Error ? skillActionsQuery.error.message : null
                }
                onRunMessageAction={async (message, action) => {
                  if (!activeSkill?.id || !workspaceId) return;
                  if (action.inputType === "selection") {
                    // Пока нет выделения в UI сообщений
                    setStreamError("Это действие требует выделения текста сообщения. Поддержка появится позже.");
                    return;
                  }
                  setIsRunningMessageActionId(`${message.id}:${action.id}`);
                  try {
                    const body =
                      action.target === "selection"
                        ? {
                            placement: "chat_message",
                            target: "selection",
                            applyMode: "apply",
                            context: { text: message.content ?? "" },
                          }
                        : {
                            placement: "chat_message",
                            target: "message",
                            applyMode: "apply",
                            context: { messageId: message.id },
                          };
                    const res = await fetch(
                      `/api/skills/${activeSkill.id}/actions/${action.id}/run`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      },
                    );
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      const msg = data?.message || "Не удалось выполнить действие";
                      throw new Error(msg);
                    }
                    const result = await res.json();
                    if (result?.applied) {
                      const changeType = result?.appliedChanges?.type;
                      if (changeType === "message_replace" || changeType === "message_new") {
                        queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveChatId] });
                        setStreamError(null);
                      } else if (changeType === "document") {
                        setStreamError(null);
                        setSaveTranscriptMessage("Создан документ на основе сообщения.");
                      } else {
                        setStreamError(null);
                        setSaveTranscriptMessage("Действие выполнено.");
                      }
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : "Не удалось выполнить действие";
                    setStreamError(msg);
                  } finally {
                    setIsRunningMessageActionId(null);
                  }
                }}
                toolbarActions={toolbarActions}
                toolbarLoadingId={isRunningToolbarActionId}
                onRunToolbarAction={async (action, inputValue) => {
                  if (!activeSkill?.id || !workspaceId) return;
                  if (!inputValue.trim() && action.target === "selection") {
                    setStreamError("Введите текст, с которым нужно выполнить действие.");
                    return;
                  }
                  setIsRunningToolbarActionId(action.id);
                  try {
                    const isConversation = action.target === "conversation";
                    const useApply = action.outputMode === "new_message" || action.outputMode === "document";
                    const body =
                      isConversation
                        ? {
                            placement: "chat_toolbar",
                            target: "conversation",
                            applyMode: useApply ? "apply" : "none",
                            context: { conversationId: effectiveChatId },
                          }
                        : {
                            placement: "chat_toolbar",
                            target: "selection",
                            applyMode: "none",
                            context: { text: inputValue },
                          };
                    const res = await fetch(
                      `/api/skills/${activeSkill.id}/actions/${action.id}/run`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      },
                    );
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      const msg = data?.message || "Не удалось выполнить действие";
                      throw new Error(msg);
                    }
                    const result = await res.json();
                    if (useApply && result?.applied) {
                      if (
                        result?.appliedChanges?.type === "message_new" ||
                        result?.appliedChanges?.type === "message_replace"
                      ) {
                        queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveChatId] });
                        setStreamError(null);
                      } else if (result?.appliedChanges?.type === "document") {
                        setSaveTranscriptMessage("Документ создан на основе диалога.");
                      }
                    } else if (result?.result?.text) {
                      setPendingInput(result.result.text);
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : "Не удалось выполнить действие";
                    setStreamError(msg);
                  } finally {
                    setIsRunningToolbarActionId(null);
                  }
                }}
                onReset={() => handleSelectChat(null)}
              />
            </div>
          </div>
          <div className="border-t border-slate-200 bg-white/95 pb-6 pt-4 dark:border-slate-800 dark:bg-slate-900/70">
            <ChatInput
              onSend={handleSend}
              onTranscribe={handleTranscription}
              disabled={disableInput}
              chatId={effectiveChatId}
              placeholder="Прикрепляйте файлы и задавайте вопросы. Enter — отправить, Shift+Enter — новая строка"
              toolbarActions={toolbarActions}
              toolbarLoadingId={isRunningToolbarActionId}
              onRunToolbarAction={async (action, currentText) => {
                if (!activeSkill?.id || !workspaceId) return;
                if (!currentText.trim() && action.target === "selection") {
                  setStreamError("Введите текст, с которым нужно выполнить действие.");
                  return;
                }
                setIsRunningToolbarActionId(action.id);
                try {
                  const isConversation = action.target === "conversation";
                  const useApply = action.outputMode === "new_message" || action.outputMode === "document";
                  const body =
                    isConversation
                      ? {
                          placement: "chat_toolbar",
                          target: "conversation",
                          applyMode: useApply ? "apply" : "none",
                          context: { conversationId: effectiveChatId },
                        }
                      : {
                          placement: "chat_toolbar",
                          target: "selection",
                          applyMode: "none",
                          context: { text: currentText },
                        };
                  const res = await fetch(
                    `/api/skills/${activeSkill.id}/actions/${action.id}/run`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    },
                  );
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    const msg = data?.message || "Не удалось выполнить действие";
                    throw new Error(msg);
                  }
                  const result = await res.json();
                  if (useApply && result?.applied) {
                    if (
                      result?.appliedChanges?.type === "message_new" ||
                      result?.appliedChanges?.type === "message_replace"
                    ) {
                      queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveChatId] });
                      setStreamError(null);
                    } else if (result?.appliedChanges?.type === "document") {
                      setSaveTranscriptMessage("Документ создан на основе диалога.");
                    }
                  } else if (result?.result?.text) {
                    setPendingInput(result.result.text);
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "Не удалось выполнить действие";
                  setStreamError(msg);
                } finally {
                  setIsRunningToolbarActionId(null);
                }
              }}
            />
          </div>
        </section>

        {openedTranscriptId ? (
          <aside className="flex w-[720px] max-w-[55%] min-w-[420px] flex-col border-l border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Transcript</p>
                <h2 className="text-lg font-semibold line-clamp-1">
                  {openedTranscript?.title || "Audio transcript"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {saveTranscriptMessage ? (
                  <span className="text-xs text-emerald-600">{saveTranscriptMessage}</span>
                ) : null}
                {saveTranscriptError ? (
                  <span className="text-xs text-destructive max-w-[140px] line-clamp-2">
                    {saveTranscriptError}
                  </span>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  title="Сбросить изменения"
                  disabled={isTranscriptLoading || isSavingTranscript || !isTranscriptDirty}
                  onClick={handleResetTranscript}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  disabled={isTranscriptLoading || isSavingTranscript || !isTranscriptDirty}
                  onClick={handleSaveTranscript}
                >
                  {isSavingTranscript ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
                <button
                  className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={handleCloseTranscript}
                  aria-label="Close transcript"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="h-[calc(100vh-80px)] overflow-y-auto px-5 py-4">
              {isTranscriptLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading transcript...
                </div>
              ) : transcriptError ? (
                <p className="text-sm text-destructive">{transcriptError}</p>
                  ) : openedTranscript ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold">Действия</p>
                      {skillActionsQuery.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    {skillActionsQuery.isError ? (
                      <div className="flex items-center justify-between gap-2 text-sm text-destructive">
                        <span>Не удалось загрузить действия.</span>
                        <Button size="sm" variant="outline" onClick={() => skillActionsQuery.refetch()}>
                          Повторить
                        </Button>
                      </div>
                    ) : canvasActions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Для этого навыка нет действий, доступных в холсте.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {canvasActions.map((item) => (
                          <Button
                            key={item.id}
                            variant="outline"
                            className="w-full justify-start"
                            disabled={isRunningActionId === item.id}
                            onClick={async () => {
                              if (!openedTranscriptId || !activeSkill?.id) return;
                              setIsRunningActionId(item.id);
                              setSaveTranscriptError(null);
                              setSaveTranscriptMessage(null);
                              try {
                                let selectionText: string | null = null;
                                let selectionRange: { start: number; end: number } | null = null;
                                const textarea = transcriptTextareaRef.current;
                                if (item.inputType === "selection" && textarea) {
                                  const { selectionStart, selectionEnd, value } = textarea;
                                  if (selectionStart !== selectionEnd) {
                                    selectionText = value.slice(selectionStart, selectionEnd);
                                    selectionRange = { start: selectionStart, end: selectionEnd };
                                  }
                                }
                                if (item.inputType === "selection" && (!selectionText || selectionText.length === 0)) {
                                  setSaveTranscriptError(
                                    "Это действие работает с выделенным текстом. Выделите фрагмент и попробуйте снова.",
                                  );
                                  return;
                                }
                                const body = {
                                  placement: "canvas",
                                  target: item.target,
                                  applyMode: "apply",
                                  context:
                                    item.target === "selection"
                                      ? { text: selectionText }
                                      : {
                                          transcriptId: openedTranscriptId,
                                          selectionText: selectionText ?? undefined,
                                          selectionRange: selectionRange ?? undefined,
                                        },
                                };
                                const response = await fetch(
                                  `/api/skills/${activeSkill.id}/actions/${item.id}/run`,
                                  {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify(body),
                                  },
                                );
                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  const msg = data?.message || "Не удалось выполнить действие";
                                  throw new Error(msg);
                                }
                                const result = await response.json();
                                if (result?.applied) {
                                  // рефетч стенограммы
                                  const transcriptResponse = await fetch(
                                    `/api/workspaces/${workspaceId}/transcripts/${openedTranscriptId}`,
                                  );
                                  if (transcriptResponse.ok) {
                                    const transcript = (await transcriptResponse.json()) as Transcript;
                                    setOpenedTranscript(transcript);
                                    setDraftTranscriptText(transcript.fullText ?? "");
                                  }
                                  const changeType = result?.appliedChanges?.type;
                                  if (changeType === "document") {
                                    setSaveTranscriptMessage("Документ создан на основе действия.");
                                  } else if (changeType === "message_new") {
                                    setSaveTranscriptMessage("Сгенерировано новое сообщение в чате.");
                                    if (effectiveChatId) {
                                      queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveChatId] });
                                    }
                                  } else {
                                    setSaveTranscriptMessage(`Действие «${item.label}» применено`);
                                  }
                                }
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : "Не удалось выполнить действие";
                                setSaveTranscriptError(msg);
                              } finally {
                                setIsRunningActionId(null);
                              }
                            }}
                          >
                            {isRunningActionId === item.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            <span className="truncate">{item.label}</span>
                            <span className="ml-2 text-[11px] text-muted-foreground">
                              {item.outputMode === "replace_text" && "✏️"}
                              {item.outputMode === "new_version" && "📄"}
                              {item.outputMode === "document" && "📁"}
                              {item.outputMode === "new_message" && "💬"}
                            </span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => applyInlineMarkdown("**", "**")}
                      title="Жирный"
                    >
                      <Bold className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => applyInlineMarkdown("*", "*")}
                      title="Курсив"
                    >
                      <Italic className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        const textarea = transcriptTextareaRef.current;
                        if (!textarea) return;
                        const { selectionStart, selectionEnd, value } = textarea;
                        const selected = value.slice(selectionStart, selectionEnd) || "элемент списка";
                        const before = value.slice(0, selectionStart);
                        const after = value.slice(selectionEnd);
                        const linePrefix = selected.startsWith("- ") ? "" : "- ";
                        const next = `${before}${linePrefix}${selected}\n${after}`;
                        setDraftTranscriptText(next);
                        requestAnimationFrame(() => {
                          const pos = before.length + linePrefix.length + selected.length + 1;
                          textarea.focus();
                          textarea.setSelectionRange(pos, pos);
                        });
                      }}
                      title="Маркированный список"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                  <textarea
                    ref={transcriptTextareaRef}
                    value={draftTranscriptText}
                    onChange={(e) => setDraftTranscriptText(e.target.value)}
                    className="h-[70vh] w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm leading-relaxed shadow-inner outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Текст стенограммы..."
                  />
                  {!isTranscriptDirty && saveTranscriptMessage ? (
                    <p className="text-xs text-emerald-600">Изменений нет, текст актуален.</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Transcript not found.</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
