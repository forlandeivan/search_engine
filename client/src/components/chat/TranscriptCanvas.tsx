import { useState, useEffect, useCallback } from "react";
import { X, Save, RotateCcw, Loader2, Circle, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranscript, useUpdateTranscript } from "@/hooks/useTranscript";
import { useSkillActions, useRunSkillAction } from "@/hooks/useSkillActions";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateCanvasDocument,
  useCanvasDocumentsByTranscript,
  useDeleteCanvasDocument,
  useUpdateCanvasDocument,
  useDuplicateCanvasDocument,
} from "@/hooks/useCanvasDocuments";

type CanvasTab = {
  id: string;
  title: string;
  content: string;
  originalContent: string;
  isLoading: boolean;
  type: "original" | "action_result";
  actionId?: string;
  hasChanges: boolean;
};

type TranscriptCanvasProps = {
  workspaceId: string;
  chatId: string;
  transcriptId: string;
  skillId?: string;
  initialTabId?: string | null;
  onClose: () => void;
};

export function TranscriptCanvas({
  workspaceId,
  chatId,
  transcriptId,
  skillId,
  initialTabId = null,
  onClose,
}: TranscriptCanvasProps) {
  const { toast } = useToast();
  const { data: transcript, isLoading, isError } = useTranscript(
    workspaceId,
    transcriptId
  );
  const { data: canvasDocuments, isLoading: isDocsLoading } = useCanvasDocumentsByTranscript(transcriptId);
  const { mutate: updateTranscript, isPending } = useUpdateTranscript(
    workspaceId
  );

  const { data: actions } = useSkillActions(workspaceId, skillId || "");
  const { mutate: runAction } = useRunSkillAction(workspaceId);
  const { mutateAsync: createCanvasDocument } = useCreateCanvasDocument();
  const { mutateAsync: deleteCanvasDocument } = useDeleteCanvasDocument();
  const { mutateAsync: updateCanvasDocument } = useUpdateCanvasDocument();
  const { mutateAsync: duplicateCanvasDocument } = useDuplicateCanvasDocument();

  const [tabs, setTabs] = useState<CanvasTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("original");
  const [initializedTab, setInitializedTab] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!transcript) return;
    const text = transcript.fullText ?? "";

    const docTabs =
      canvasDocuments?.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        originalContent: doc.content,
        isLoading: false,
        type: "action_result" as const,
        actionId: doc.actionId ?? undefined,
        hasChanges: false,
      })) ?? [];

    setTabs((prev) => {
      const existingMap = new Map(prev.map((t) => [t.id, t]));
      const originalExisting = existingMap.get("original");
      const originalTab: CanvasTab = originalExisting
        ? {
            ...originalExisting,
            content: originalExisting.hasChanges ? originalExisting.content : text,
            originalContent: text,
          }
        : {
            id: "original",
            title: "Исходный",
            content: text,
            originalContent: text,
            isLoading: false,
            type: "original",
            hasChanges: false,
          };

      const nextTabs: CanvasTab[] = [originalTab];
      for (const dt of docTabs) {
        const existing = existingMap.get(dt.id);
        nextTabs.push(
          existing
            ? {
                ...existing,
                content: existing.hasChanges ? existing.content : dt.content,
                originalContent: dt.originalContent,
                type: "action_result",
                actionId: dt.actionId,
                isLoading: false,
              }
            : dt,
        );
      }
      return nextTabs;
    });
  }, [transcript?.id, transcript?.fullText, canvasDocuments]);

  // Инициализация активного таба с учётом initialTabId или дефолтного таба транскрипта
  useEffect(() => {
    let preferredTabId = initialTabId ?? transcript?.defaultViewId ?? null;
    if (!preferredTabId && transcript?.defaultViewActionId) {
      const tabByAction = tabs.find((t) => t.actionId === transcript.defaultViewActionId);
      if (tabByAction) {
        preferredTabId = tabByAction.id;
      }
    }

    if (!initializedTab && preferredTabId && tabs.some((t) => t.id === preferredTabId)) {
      setActiveTabId(preferredTabId);
      setInitializedTab(true);
    } else if (!initializedTab && tabs.length > 0) {
      setActiveTabId((prev) => (prev ? prev : "original"));
      setInitializedTab(true);
    }
  }, [initializedTab, initialTabId, transcript?.defaultViewActionId, tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  const canvasActions = (actions ?? []).filter(
    (item) =>
      item.skillAction?.enabled &&
      item.skillAction?.enabledPlacements.includes("canvas") &&
      item.action.target === "transcript"
  );

  const documentActions = canvasActions.filter(
    (item) => item.action.outputMode === "document"
  );
  const replaceActions = canvasActions.filter(
    (item) => item.action.outputMode !== "document"
  );

  const updateTabContent = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              content,
              hasChanges: content !== tab.originalContent,
            }
          : tab
      )
    );
  }, []);

  const handleSave = async () => {
    if (!activeTab) return;
    
    if (!activeTab.content.trim()) {
      toast({
        title: "Ошибка",
        description: "Текст стенограммы не может быть пустым",
        variant: "destructive",
      });
      return;
    }

    // Сохраняем оригинал в Transcript, остальные вкладки — в CanvasDocument
    if (activeTab.id === "original") {
      updateTranscript(
        { transcriptId, fullText: activeTab.content.trim() },
        {
          onSuccess: (updatedTranscript) => {
            const newText = updatedTranscript.fullText || "";
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === activeTab.id
                  ? {
                      ...tab,
                      content: newText,
                      originalContent: newText,
                      hasChanges: false,
                    }
                  : tab.id === "original"
                  ? {
                      ...tab,
                      originalContent: newText,
                      content: tab.hasChanges ? tab.content : newText,
                    }
                  : tab,
              ),
            );
            toast({
              title: "Сохранено",
              description: "Стенограмма успешно обновлена",
            });
          },
          onError: (error) => {
            toast({
              title: "Ошибка",
              description:
                error instanceof Error ? error.message : "Не удалось сохранить",
              variant: "destructive",
            });
          },
        },
      );
    } else {
      try {
        await updateCanvasDocument({
          id: activeTab.id,
          content: activeTab.content.trim(),
        });
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id
              ? { ...tab, originalContent: activeTab.content.trim(), hasChanges: false }
              : tab,
          ),
        );
        toast({ title: "Сохранено", description: "Документ холста обновлён" });
      } catch (error) {
        toast({
          title: "Ошибка",
          description: error instanceof Error ? error.message : "Не удалось сохранить документ",
          variant: "destructive",
        });
      }
    }
  };

  const handleReset = () => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTab.id
          ? { ...tab, content: tab.originalContent, hasChanges: false }
          : tab
      )
    );
    toast({
      description: "Изменения отменены",
    });
  };

  const handleRunReplaceAction = (actionId: string, label: string) => {
    if (!skillId) return;

    console.log("[TranscriptCanvas] handleRunReplaceAction - START", {
      actionId,
      label,
      skillId,
      transcriptId,
      activeTabId,
    });

    // Always use original transcript text as source
    const sourceText = tabs.find((t) => t.id === "original")?.content || "";
    
    if (!sourceText.trim()) {
      toast({
        title: "Ошибка",
        description: "Исходный текст пуст",
        variant: "destructive",
      });
      return;
    }

    // Always create a new tab for manual actions (never modify original)
    const newTabId = `action-${actionId}-${Date.now()}`;
    const newTab: CanvasTab = {
      id: newTabId,
      title: label,
      content: "",
      originalContent: "",
      isLoading: true,
      type: "action_result",
      actionId,
      hasChanges: false,
    };

    console.log("[TranscriptCanvas] handleRunReplaceAction - Creating temp tab", {
      newTabId,
      sourceTextLength: sourceText.length,
    });

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);

    runAction(
      {
        skillId,
        actionId,
        placement: "canvas",
        target: "transcript",
        selectionText: sourceText,
        transcriptId,
      },
      {
        onSuccess: (result) => {
          const outputText = result.text || "";
          console.log("[TranscriptCanvas] handleRunReplaceAction - Action SUCCESS", {
            actionId,
            outputTextLength: outputText.length,
            hasOutput: !!outputText,
          });

          if (outputText) {
            // Save as canvas document in DB (same as handleRunDocumentAction)
            createCanvasDocument(
              {
                chatId,
                transcriptId,
                skillId,
                actionId,
                type: "derived",
                title: label,
                content: outputText,
              },
              {
                onSuccess: ({ document }) => {
                  console.log("[TranscriptCanvas] handleRunReplaceAction - Document saved", {
                    documentId: document.id,
                    newTabId,
                  });

                  setTabs((prev) => {
                    // Check if the tab still exists (user might have closed it during loading)
                    const tabExists = prev.some((tab) => tab.id === newTabId);
                    if (!tabExists) {
                      console.log("[TranscriptCanvas] handleRunReplaceAction - Tab was closed during execution, skipping update");
                      return prev;
                    }
                    
                    return prev.map((tab) =>
                      tab.id === newTabId
                        ? {
                            ...tab,
                            id: document.id,
                            content: outputText,
                            originalContent: outputText,
                            hasChanges: false,
                            isLoading: false,
                          }
                        : tab
                    );
                  });
                  
                  setActiveTabId(document.id);
                  
                  toast({
                    title: "Готово",
                    description: `Действие "${label}" выполнено`,
                  });
                },
                onError: (error) => {
                  console.error("[TranscriptCanvas] handleRunReplaceAction - Failed to save document", error);
                  setTabs((prev) => prev.filter((tab) => tab.id !== newTabId));
                  setActiveTabId("original");
                  toast({
                    title: "Ошибка",
                    description: error instanceof Error ? error.message : "Не удалось сохранить документ",
                    variant: "destructive",
                  });
                },
              }
            );
          } else {
            console.log("[TranscriptCanvas] handleRunReplaceAction - No output text, removing tab");
            setTabs((prev) => prev.filter((tab) => tab.id !== newTabId));
            setActiveTabId("original");
            toast({
              title: "Выполнено",
              description: result.ui?.effectiveLabel || label,
            });
          }
        },
        onError: (error) => {
          console.error("[TranscriptCanvas] handleRunReplaceAction - Action FAILED", error);
          setTabs((prev) => prev.filter((tab) => tab.id !== newTabId));
          setActiveTabId("original");
          toast({
            title: "Ошибка",
            description: error instanceof Error ? error.message : "Не удалось выполнить действие",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRunDocumentAction = (actionId: string, label: string) => {
    if (!skillId) return;

    console.log("[TranscriptCanvas] handleRunDocumentAction - START", {
      actionId,
      label,
      skillId,
      transcriptId,
      activeTabId,
    });

    const sourceText = tabs.find((t) => t.id === "original")?.content || "";
    
    if (!sourceText.trim()) {
      toast({
        title: "Ошибка",
        description: "Исходный текст пуст",
        variant: "destructive",
      });
      return;
    }

    const newTabId = `action-${actionId}-${Date.now()}`;
    const newTab: CanvasTab = {
      id: newTabId,
      title: label,
      content: "",
      originalContent: "",
      isLoading: true,
      type: "action_result",
      actionId,
      hasChanges: false,
    };

    console.log("[TranscriptCanvas] handleRunDocumentAction - Creating temp tab", {
      newTabId,
      sourceTextLength: sourceText.length,
    });

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);

    runAction(
      {
        skillId,
        actionId,
        placement: "canvas",
        target: "transcript",
        selectionText: sourceText,
        transcriptId,
      },
      {
        onSuccess: (result) => {
        console.log("[TranscriptCanvas] handleRunDocumentAction - Action SUCCESS", {
          actionId,
          hasResult: !!result,
          resultKeys: result ? Object.keys(result) : [],
        });

        const outputText = result.text || "";
        console.log("[TranscriptCanvas] handleRunDocumentAction - Creating canvas document", {
          outputTextLength: outputText.length,
          chatId,
          transcriptId,
          skillId,
          actionId,
        });

        createCanvasDocument(
          {
            chatId,
            transcriptId,
            skillId,
            actionId,
            type: "derived",
            title: label,
            content: outputText,
          },
          {
            onSuccess: ({ document }) => {
              console.log("[TranscriptCanvas] handleRunDocumentAction - Document saved", {
                documentId: document.id,
                newTabId,
              });

              setTabs((prev) => {
                // Check if the tab still exists (user might have closed it during loading)
                const tabExists = prev.some((tab) => tab.id === newTabId);
                if (!tabExists) {
                  console.log("[TranscriptCanvas] handleRunDocumentAction - Tab was closed during execution, skipping update");
                  return prev;
                }
                
                return prev.map((tab) =>
                  tab.id === newTabId
                    ? {
                        ...tab,
                        id: document.id,
                        content: outputText,
                        originalContent: outputText,
                        isLoading: false,
                      }
                    : tab
                );
              });
              
              // Only set active tab if it wasn't closed
              setActiveTabId((currentActiveId) => {
                const tabStillExists = tabs.some((t) => t.id === newTabId);
                return tabStillExists ? document.id : currentActiveId;
              });
              
              toast({
                title: "Готово",
                description: `Результат "${label}" сохранён`,
              });
            },
            onError: (error) => {
              console.error("[TranscriptCanvas] handleRunDocumentAction - Failed to save document", error);
              setTabs((prev) => prev.filter((tab) => tab.id !== newTabId));
              setActiveTabId("original");
              toast({
                title: "Ошибка",
                description: error instanceof Error ? error.message : "Не удалось сохранить документ",
                variant: "destructive",
              });
            },
          }
        );
      },
      onError: (error) => {
        console.error("[TranscriptCanvas] handleRunDocumentAction - Action FAILED", error);
        setTabs((prev) => prev.filter((tab) => tab.id !== newTabId));
        setActiveTabId("original");
        toast({
            title: "Ошибка",
            description: error instanceof Error ? error.message : "Не удалось выполнить действие",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCloseTab = (tabId: string) => {
    console.log("[TranscriptCanvas] handleCloseTab - START", {
      tabId,
      activeTabId,
      tabsCount: tabs.length,
      isOriginal: tabId === "original",
    });

    if (tabId === "original") return;

    const tabToClose = tabs.find((t) => t.id === tabId);
    
    console.log("[TranscriptCanvas] handleCloseTab - Tab to close", {
      tabId,
      found: !!tabToClose,
      hasChanges: tabToClose?.hasChanges,
      idStartsWithAction: tabToClose?.id.startsWith("action-"),
    });

    if (tabToClose?.hasChanges) {
      const confirmed = window.confirm("В этом табе есть несохранённые изменения. Закрыть?");
      if (!confirmed) {
        console.log("[TranscriptCanvas] handleCloseTab - User cancelled");
        return;
      }
    }

    if (!tabToClose?.id || tabToClose.id.startsWith("action-")) {
      // локальная вкладка без сохранённого документа (fallback)
      console.log("[TranscriptCanvas] handleCloseTab - Removing local tab (not saved in DB)", { tabId });
      setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
      if (activeTabId === tabId) {
        setActiveTabId("original");
      }
      return;
    }

    console.log("[TranscriptCanvas] handleCloseTab - Deleting canvas document from DB", { tabId });
    deleteCanvasDocument(tabToClose.id, {
      onSuccess: () => {
        console.log("[TranscriptCanvas] handleCloseTab - Document deleted successfully", { tabId });
        setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
        if (activeTabId === tabId) {
          setActiveTabId("original");
        }
        toast({ description: "Документ удалён" });
      },
      onError: (error) => {
        console.error("[TranscriptCanvas] handleCloseTab - Failed to delete document", { tabId, error });
        toast({
          title: "Ошибка",
          description: error instanceof Error ? error.message : "Не удалось удалить документ",
          variant: "destructive",
        });
      },
    });
  };

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-destructive">Не удалось загрузить стенограмму</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      {/* Header with title and close button */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold">Транскрипция аудиофайла</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Закрыть холст"
          data-testid="button-close-canvas"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTabId === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid={`tab-${tab.id}`}
          >
            {tab.title}
            {tab.hasChanges && (
              <Circle className="h-2 w-2 fill-amber-400 text-amber-400" />
            )}
            {tab.isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {activeTabId === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          onClick={async () => {
            try {
              const { document } = await createCanvasDocument({
                chatId,
                transcriptId,
                type: "text",
                title: "Новый документ",
                content: "",
              });
              const newTab: CanvasTab = {
                id: document.id,
                title: document.title,
                content: document.content,
                originalContent: document.content,
                isLoading: false,
                type: "action_result",
                actionId: document.actionId ?? undefined,
                hasChanges: false,
              };
              setTabs((prev) => [...prev, newTab]);
              setActiveTabId(document.id);
            } catch (error) {
              toast({
                title: "Ошибка",
                description: error instanceof Error ? error.message : "Не удалось создать документ",
                variant: "destructive",
              });
            }
          }}
        >
          +
        </Button>
      </div>
      {contextMenu && (
        <DropdownMenu open onOpenChange={(open) => !open && setContextMenu(null)}>
          <DropdownMenuContent
            className="w-48"
            side="right"
            align="start"
            sideOffset={0}
            alignOffset={0}
            style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x }}
          >
            <DropdownMenuItem
              onClick={() => {
                const tab = tabs.find((t) => t.id === contextMenu.tabId);
                if (!tab || tab.id === "original") {
                  setContextMenu(null);
                  return;
                }
                const nextTitle = window.prompt("Название вкладки", tab.title);
                if (!nextTitle || !nextTitle.trim()) {
                  setContextMenu(null);
                  return;
                }
                updateCanvasDocument(
                  { id: tab.id, title: nextTitle.trim() },
                  {
                    onSuccess: ({ document }) => {
                      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, title: document.title } : t)));
                    },
                    onError: (error) => {
                      toast({
                        title: "Ошибка",
                        description: error instanceof Error ? error.message : "Не удалось переименовать вкладку",
                        variant: "destructive",
                      });
                    },
                  },
                );
                setContextMenu(null);
              }}
            >
              Переименовать
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const targetTab = tabs.find((t) => t.id === contextMenu.tabId);
                if (!targetTab || targetTab.id === "original") {
                  setContextMenu(null);
                  return;
                }
                try {
                  const { document } = await duplicateCanvasDocument({
                    id: targetTab.id,
                    title: `${targetTab.title}${targetTab.title.includes("копия") ? "" : " (копия)"}`,
                  });
                  const newTab: CanvasTab = {
                    id: document.id,
                    title: document.title,
                    content: document.content,
                    originalContent: document.content,
                    isLoading: false,
                    type: "action_result",
                    actionId: document.actionId ?? undefined,
                    hasChanges: false,
                  };
                  setTabs((prev) => [...prev, newTab]);
                  setActiveTabId(document.id);
                } catch (error) {
                  toast({
                    title: "Ошибка",
                    description: error instanceof Error ? error.message : "Не удалось дублировать вкладку",
                    variant: "destructive",
                  });
                } finally {
                  setContextMenu(null);
                }
              }}
            >
              Дублировать
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                handleCloseTab(contextMenu.tabId);
                setContextMenu(null);
              }}
            >
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Tab content */}
      {activeTab && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Tab toolbar */}
          <div className="flex items-center justify-end gap-2 border-b border-border px-6 py-2">
            {/* Actions dropdown for replace actions */}
            {skillId && replaceActions.length > 0 && activeTab.id === "original" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={activeTab.isLoading || isLoading}
                    data-testid="button-canvas-actions"
                  >
                    {activeTab.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MoreVertical className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Заменить текст</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {replaceActions.map((item) => (
                    <DropdownMenuItem
                      key={item.action.id}
                      onClick={() => handleRunReplaceAction(item.action.id, item.ui.effectiveLabel)}
                      disabled={activeTab.isLoading}
                      data-testid={`action-replace-${item.action.id}`}
                    >
                      {item.ui.effectiveLabel}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Document actions dropdown - always available on original tab */}
            {skillId && documentActions.length > 0 && activeTab.id === "original" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                    data-testid="button-document-actions"
                  >
                    + Действие
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Создать документ</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {documentActions.map((item) => (
                    <DropdownMenuItem
                      key={item.action.id}
                      onClick={() => handleRunDocumentAction(item.action.id, item.ui.effectiveLabel)}
                      data-testid={`action-document-${item.action.id}`}
                    >
                      {item.ui.effectiveLabel}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* All actions in one dropdown for action result tabs */}
            {skillId && canvasActions.length > 0 && activeTab.type === "action_result" && !activeTab.isLoading && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={activeTab.isLoading}
                    data-testid="button-tab-actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Действия</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {canvasActions.map((item) => (
                    <DropdownMenuItem
                      key={item.action.id}
                      onClick={() => {
                        if (item.action.outputMode === "document") {
                          handleRunDocumentAction(item.action.id, item.ui.effectiveLabel);
                        } else {
                          handleRunReplaceAction(item.action.id, item.ui.effectiveLabel);
                        }
                      }}
                      data-testid={`action-tab-${item.action.id}`}
                    >
                      {item.ui.effectiveLabel}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!activeTab.hasChanges || isPending || isLoading || activeTab.isLoading}
              className="gap-2"
              data-testid="button-reset"
            >
              <RotateCcw className="h-4 w-4" />
              Отменить
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!activeTab.hasChanges || isPending || isLoading || activeTab.isLoading}
              className="gap-2"
              data-testid="button-save"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Сохранить
            </Button>
          </div>

          {/* Tab content area */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-6 py-4 relative">
            {(isLoading && tabs.length === 0) || isDocsLoading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground h-full">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка стенограммы...
              </div>
            ) : activeTab.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Выполняется действие...</p>
                </div>
              </div>
            ) : null}
            <Textarea
              value={activeTab.content}
              onChange={(e) => updateTabContent(activeTab.id, e.target.value)}
              placeholder="Текст стенограммы..."
              className="flex-1 resize-none border-0 focus-visible:ring-0 p-4 bg-muted"
              disabled={activeTab.isLoading}
              data-testid="textarea-content"
            />
          </div>
        </div>
      )}
    </div>
  );
}
