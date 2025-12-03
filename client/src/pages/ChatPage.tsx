import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessagesArea from "@/components/chat/ChatMessagesArea";
import ChatInput from "@/components/chat/ChatInput";
import { TranscriptCanvas } from "@/components/chat/TranscriptCanvas";
import { useChats, useChatMessages, useCreateChat, sendChatMessageLLM } from "@/hooks/useChats";
import { useSkills } from "@/hooks/useSkills";
import type { ChatMessage } from "@/types/chat";

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

  const {
    messages: fetchedMessages,
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
  } = useChatMessages(effectiveChatId ?? undefined, workspaceId || undefined);

  const [localChatId, setLocalChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [openTranscriptId, setOpenTranscriptId] = useState<string | null>(null);

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
    const deduped = base.filter(
      (message) =>
        !localMessages.some(
          (local) =>
            local.role === message.role &&
            local.content.trim() === (message.content ?? "").trim(),
        ),
    );
    return [...deduped, ...localMessages];
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
    async (transcribedText: string) => {
      if (!workspaceId) return;
      setIsTranscribing(true);

      if (!transcribedText.startsWith('__PENDING_OPERATION:')) {
        setIsTranscribing(false);
        return;
      }

      const parts = transcribedText.substring('__PENDING_OPERATION:'.length).split(':');
      const operationId = parts[0];
      const fileName = parts[1] ? decodeURIComponent(parts[1]) : 'audio';

      let targetChatId = effectiveChatId;
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
          setStreamError(error instanceof Error ? error.message : String(error));
          setIsTranscribing(false);
          return;
        }
      }

      if (targetChatId) {
        const audioMessageTime = new Date();
        const audioMessage: ChatMessage = {
          id: `local-audio-${Date.now()}`,
          chatId: targetChatId,
          role: 'user',
          content: fileName,
          metadata: {
            type: 'audio',
            fileName,
          },
          createdAt: audioMessageTime.toISOString(),
        };
        const placeholderId = `local-transcript-${Date.now()}`;
        const placeholderMessage: ChatMessage = {
          id: placeholderId,
          chatId: targetChatId,
          role: 'assistant',
          content: '',
          metadata: {
            type: 'transcript',
            transcriptId: placeholderId,
            transcriptStatus: 'processing',
          },
          createdAt: new Date(audioMessageTime.getTime() + 1000).toISOString(),
        };
        setLocalChatId(targetChatId);
        setLocalMessages((prev) => [...prev, audioMessage, placeholderMessage]);

        const pollOperation = async () => {
          let attempts = 0;
          const maxAttempts = 600;

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
                        msg.id === placeholderId
                          ? {
                              ...msg,
                              content: completeData.message.content,
                              metadata: completeData.message.metadata,
                            }
                          : msg,
                      ),
                    );
                  } else {
                    setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderId));
                    await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                  }
                } else {
                  setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderId));
                  await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
                }
                return;
              }

              if (status.status === 'failed') {
                setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderId));
                setStreamError(status.error || 'Транскрибация не удалась. Попробуйте снова.');
                return;
              }

              attempts += 1;
            } catch (error) {
              console.error('[ChatPage] Poll error:', error);
              attempts += 1;
            }
          }

          setLocalMessages((prev) => prev.filter((msg) => msg.id !== placeholderId));
          setStreamError('Транскрибация заняла слишком много времени. Попробуйте снова.');
        };

        await pollOperation();
      }
      setIsTranscribing(false);
    },
    [activeChat?.skillId, activeSkill?.id, createChat, defaultSkill?.id, effectiveChatId, handleSelectChat, queryClient, workspaceId],
  );

const isNewChat = !effectiveChatId;
  const skillLabel = activeSkill?.name ?? activeChat?.skillName ?? "Unica Chat";
  const chatTitle = activeChat?.title ?? null;
  const disableInput = !workspaceId || isStreaming || Boolean(normalizedMessagesError && !isNewChat);
  const isDefaultCreating = creatingSkillId !== null && creatingSkillId === (defaultSkill?.id ?? null);

  useEffect(() => {
    document.body.classList.add("chat-scroll-locked");
    return () => {
      document.body.classList.remove("chat-scroll-locked");
    };
  }, []);

  return (
    <div className="flex h-screen min-h-0 bg-muted/20 overflow-hidden">
      {/*
        Layout plan:
        - keep the root full-height; next row splits into two fixed columns (sidebar + main).
        - TODO: move overflow-y from the page body onto each column for independent scrolls.
      */}
      <div className="flex h-full min-h-0 flex-1">
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
        {/*
          NOTE:
          - Right now the scrollable area for the conversation lives inside the white card below.
            Because that card has `max-w-[880px]`/`mx-auto`, the scrollbar ends up in the middle of the screen.
          - Target behaviour (ChatGPT-like) is to let this <section> (full width of the right column)
            own the vertical overflow, so the scrollbar hugs the browser edge while the card remains centred.
          - Keep this in mind when moving overflow logic in the next step.
        */}
        <section className={cn(
          "flex min-h-0 flex-1 overflow-hidden",
          openTranscriptId ? "flex-row" : "flex-col"
        )}>
          <div className="flex flex-col overflow-hidden flex-1 min-w-0">
            <div
              ref={messagesScrollRef}
              className="chat-scroll flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8"
            >
              <div className="mx-auto w-full max-w-[880px] rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900/80">
                <ChatMessagesArea
                  chatTitle={chatTitle}
                  skillName={skillLabel}
                  messages={visibleMessages}
                  isLoading={isMessagesLoading && !isNewChat}
                  isNewChat={isNewChat}
                  isStreaming={isStreaming}
                  isTranscribing={isTranscribing}
                  streamError={streamError}
                  errorMessage={normalizedMessagesError}
                  scrollContainerRef={messagesScrollRef}
                  onReset={() => handleSelectChat(null)}
                  onOpenTranscript={setOpenTranscriptId}
                />
              </div>
            </div>
            <div className="border-t border-slate-200 bg-white/95 pb-6 pt-4 px-4 sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-slate-900/70">
              <ChatInput
                onSend={handleSend}
                onTranscribe={handleTranscription}
                disabled={disableInput}
                chatId={effectiveChatId ?? null}
                placeholder={isNewChat ? "Ask something..." : "Type a message and press Enter"}
              />
            </div>
          </div>
          {openTranscriptId && (
            <div className="flex-1 min-w-0 overflow-hidden">
              <TranscriptCanvas
                workspaceId={workspaceId}
                transcriptId={openTranscriptId}
                onClose={() => setOpenTranscriptId(null)}
              />
            </div>
          )}
        </section>
      </div>
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




