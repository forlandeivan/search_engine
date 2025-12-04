import { useState, useEffect, useCallback } from "react";
import { X, Save, RotateCcw, Loader2, MoreVertical, Circle } from "lucide-react";
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
  transcriptId: string;
  skillId?: string;
  initialTabId?: string | null;
  onClose: () => void;
};

export function TranscriptCanvas({
  workspaceId,
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
  const { mutate: updateTranscript, isPending } = useUpdateTranscript(
    workspaceId
  );

  const { data: actions } = useSkillActions(workspaceId, skillId || "");
  const { mutate: runAction } = useRunSkillAction(workspaceId);

  const [tabs, setTabs] = useState<CanvasTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("original");
  const [initializedTab, setInitializedTab] = useState(false);

  useEffect(() => {
    const text = transcript?.fullText ?? "";
    if (tabs.length === 0) {
      setTabs([
        {
          id: "original",
          title: "Исходный",
          content: text,
          originalContent: text,
          isLoading: false,
          type: "original",
          hasChanges: false,
        },
      ]);
    } else if (transcript) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === "original"
            ? {
                ...tab,
                content: tab.hasChanges ? tab.content : text,
                originalContent: text,
              }
            : tab
        )
      );
    }
  }, [transcript?.fullText]);

  // Инициализация активного таба с учётом initialTabId или дефолтного таба транскрипта
  useEffect(() => {
    const preferredTabId = initialTabId ?? transcript?.defaultViewActionId ?? null;
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
                : tab
            )
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
      }
    );
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
    if (!skillId || !activeTab) return;

    const sourceText = tabs.find((t) => t.id === "original")?.content || activeTab.content;
    
    if (!sourceText.trim()) {
      toast({
        title: "Ошибка",
        description: "Текст стенограммы пуст",
        variant: "destructive",
      });
      return;
    }

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTab.id ? { ...tab, isLoading: true } : tab
      )
    );

    runAction(
      {
        skillId,
        actionId,
        placement: "canvas",
        target: "transcript",
        selectionText: sourceText,
      },
      {
        onSuccess: (result) => {
          const outputText = result.result?.text || result.output;
          if (outputText) {
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === activeTab.id
                  ? {
                      ...tab,
                      content: outputText,
                      hasChanges: outputText !== tab.originalContent,
                      isLoading: false,
                    }
                  : tab
              )
            );
            toast({
              title: "Текст обновлён",
              description: `Действие "${label}" применено`,
            });
          } else {
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === activeTab.id ? { ...tab, isLoading: false } : tab
              )
            );
            toast({
              title: "Выполнено",
              description: result.ui?.effectiveLabel || label,
            });
          }
        },
        onError: (error) => {
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id ? { ...tab, isLoading: false } : tab
            )
          );
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

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);

    runAction(
      {
        skillId,
        actionId,
        placement: "canvas",
        target: "transcript",
        selectionText: sourceText,
      },
      {
        onSuccess: (result) => {
          const outputText = result.result?.text || result.output || "";
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === newTabId
                ? {
                    ...tab,
                    content: outputText,
                    originalContent: outputText,
                    isLoading: false,
                  }
                : tab
            )
          );
          toast({
            title: "Готово",
            description: `Результат "${label}" получен`,
          });
        },
        onError: (error) => {
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
    if (tabId === "original") return;
    
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (tabToClose?.hasChanges) {
      const confirmed = window.confirm("В этом табе есть несохранённые изменения. Закрыть?");
      if (!confirmed) return;
    }

    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId("original");
    }
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
    <div className="flex h-full flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80">
      {/* Header with title and close button */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
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
      <div className="flex items-center gap-1 border-b border-slate-200 px-6 dark:border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTabId === tab.id
                ? "text-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
            data-testid={`tab-${tab.id}`}
          >
            {tab.title}
            {tab.hasChanges && (
              <Circle className="h-2 w-2 fill-amber-400 text-amber-400" />
            )}
            {tab.isLoading && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {tab.type === "action_result" && !tab.isLoading && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                className="ml-1 rounded p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"
                aria-label="Закрыть таб"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            {activeTabId === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Tab toolbar */}
          <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-6 py-2 dark:border-slate-800">
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
            {isLoading && tabs.length === 0 ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground h-full">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка стенограммы...
              </div>
            ) : activeTab.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10">
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
              className="flex-1 resize-none border-0 focus-visible:ring-0 p-4 bg-slate-50 dark:bg-slate-800/50"
              disabled={activeTab.isLoading}
              data-testid="textarea-content"
            />
          </div>
        </div>
      )}
    </div>
  );
}
