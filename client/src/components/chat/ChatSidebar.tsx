import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChats, useDeleteChat, useRenameChat } from "@/hooks/useChats";
import { useSkills } from "@/hooks/useSkills";
import type { ChatSummary } from "@/types/chat";
import {
  Loader2,
  MoreVertical,
  PenLine,
  Search,
  X,
  Cpu,
  Wand2,
  FileText,
  Briefcase,
  Grid2X2,
  Mic,
  ChevronDown,
  Plus,
  Archive,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ChatSidebarProps = {
  workspaceId?: string;
  selectedChatId?: string;
  onSelectChat: (chatId: string | null) => void;
  onCreateNewChat: () => void;
  isCreatingChat?: boolean;
  onCreateChatForSkill?: (skillId: string) => void;
  creatingSkillId?: string | null;
  className?: string;
};

const skillIcons: Record<string, typeof Cpu> = {
  "Управление навыками": Cpu,
  "Анализ судебного дела": Wand2,
  "Подготовка судебных решений": FileText,
  "Судебное делопроизводство": Briefcase,
  "Техподдержка ГАС Правосудие": Grid2X2,
  "Транскрибация": Mic,
};

export default function ChatSidebar({
  workspaceId,
  selectedChatId,
  onSelectChat,
  onCreateNewChat,
  isCreatingChat = false,
  onCreateChatForSkill,
  creatingSkillId = null,
  className,
}: ChatSidebarProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { chats, isLoading, isFetching } = useChats(workspaceId, debouncedSearch);
  const {
    skills: workspaceSkills,
    isLoading: isSkillsLoading,
    isFetching: isSkillsFetching,
  } = useSkills({ workspaceId: workspaceId ?? null, enabled: Boolean(workspaceId) });
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const { renameChat, isRenaming } = useRenameChat({
    onSuccess: () => {
      setEditingChatId(null);
      setEditingTitle("");
    },
  });
  const { deleteChat, isDeleting } = useDeleteChat({
    onSuccess: () => {
      if (selectedChatId && selectedChatId === editingChatId) {
        onSelectChat(null);
      }
    },
  });

  const handleRenameSubmit = useCallback(async () => {
    if (!editingChatId) {
      return;
    }
    const trimmed = editingTitle.trim();
    if (!trimmed || trimmed.length === 0) {
      return;
    }
    await renameChat({ chatId: editingChatId, title: trimmed });
  }, [editingChatId, editingTitle, renameChat]);

  const handleDelete = useCallback(
    async (chat: ChatSummary) => {
      if (!workspaceId) {
        return;
      }
      const confirmed = window.confirm(`Удалить чат «${chat.title || "Без названия"}»?`);
      if (!confirmed) {
        return;
      }
      await deleteChat({ chatId: chat.id, workspaceId });
      if (selectedChatId === chat.id) {
        onSelectChat(null);
      }
      if (editingChatId === chat.id) {
        setEditingChatId(null);
        setEditingTitle("");
      }
    },
    [deleteChat, workspaceId, onSelectChat, selectedChatId, editingChatId],
  );

  const customSkills = useMemo(() => {
    return workspaceSkills.filter(
      (skill) => !(skill.isSystem && skill.systemKey === "UNICA_CHAT") && skill.status !== "archived",
    );
  }, [workspaceSkills]);

  const skillsBlock = useMemo(() => {
    if (!workspaceId) {
      return null;
    }

    if (isSkillsLoading) {
      return (
        <div className="flex items-center gap-2 px-6 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем навыки…
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        <Link href="/skills">
          <div
            className="flex cursor-pointer items-center gap-2 px-6 py-5 hover:bg-slate-100 dark:hover:bg-slate-800"
            data-testid="link-manage-skills"
          >
            <Cpu className="h-6 w-6 text-slate-400" />
            <span className="text-base font-medium text-slate-900 dark:text-slate-100">
              Управление навыками
            </span>
          </div>
        </Link>

        {customSkills.map((skill) => {
          const Icon = skillIcons[skill.name || ""] || Wand2;
          return (
            <div
              key={skill.id}
              className="group flex cursor-pointer items-center gap-2 px-6 py-5 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => onCreateChatForSkill?.(skill.id)}
              data-testid={`skill-${skill.id}`}
            >
              <Icon className="h-6 w-6 text-slate-400" />
              <span className="flex-1 text-base font-medium text-slate-900 dark:text-slate-100">
                {skill.name}
              </span>
              {creatingSkillId === skill.id ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              ) : (
                <Plus className="invisible h-5 w-5 text-slate-400 group-hover:visible" />
              )}
            </div>
          );
        })}
      </div>
    );
  }, [workspaceId, customSkills, isSkillsLoading, creatingSkillId, onCreateChatForSkill]);

  const activeChats = useMemo(() => chats.filter((c) => c.status !== "archived"), [chats]);

  const sidebarContent = useMemo(() => {
    if (!workspaceId) {
      return (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          Чтобы работать с чатами, выберите рабочее пространство.
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем чаты…
        </div>
      );
    }

    if (activeChats.length === 0) {
      return (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          Пока нет диалогов. Создайте новый чат, чтобы начать.
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeChats.map((chat) => (
          <ChatSidebarItem
            key={chat.id}
            chat={chat}
            isActive={chat.id === selectedChatId}
            isEditing={editingChatId === chat.id}
            editingTitle={editingTitle}
            isMutating={isRenaming || isDeleting}
            onStartRename={() => {
              setEditingChatId(chat.id);
              setEditingTitle(chat.title ?? "");
            }}
            onEditingChange={setEditingTitle}
            onSubmitRename={handleRenameSubmit}
            onCancelRename={() => {
              setEditingChatId(null);
              setEditingTitle("");
            }}
            onDelete={() => handleDelete(chat)}
            onSelect={() => onSelectChat(chat.id)}
          />
        ))}
      </div>
    );
  }, [
    workspaceId,
    activeChats,
    isLoading,
    selectedChatId,
    editingChatId,
    editingTitle,
    handleRenameSubmit,
    handleDelete,
    onSelectChat,
    isRenaming,
    isDeleting,
  ]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
        className
      )}
      data-testid="chat-sidebar"
    >
      <div className="flex items-center justify-between gap-4 border-b border-slate-300 px-6 py-5 dark:border-slate-700">
        <h1
          className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100"
          data-testid="text-sidebar-title"
        >
          AI-ассистент
        </h1>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full border-slate-300 dark:border-slate-600"
          onClick={onCreateNewChat}
          disabled={!workspaceId || isCreatingChat}
          data-testid="button-new-chat"
        >
          {isCreatingChat ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <PenLine className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          )}
        </Button>
      </div>

      <div className="border-b border-slate-300 dark:border-slate-700">
        {skillsBlock}
      </div>

      <div className="flex flex-col gap-2 px-5 pb-2 pt-4">
        <div className="relative">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск..."
            className="h-10 rounded-full border-slate-300 bg-white pl-4 pr-10 text-base dark:border-slate-600 dark:bg-slate-800"
            data-testid="input-search-chats"
          />
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
        </div>
        {isFetching && !isLoading && (
          <p className="px-1 text-xs text-muted-foreground">Обновляем историю…</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-4">
        <h2
          className="text-lg font-semibold text-slate-900 dark:text-slate-100"
          data-testid="text-history-title"
        >
          История
        </h2>
        <ChevronDown className="h-6 w-6 text-slate-400" />
      </div>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {sidebarContent}
      </div>
    </aside>
  );
}

function ChatSidebarItem({
  chat,
  isActive,
  isEditing,
  editingTitle,
  isMutating,
  onStartRename,
  onEditingChange,
  onSubmitRename,
  onCancelRename,
  onDelete,
  onSelect,
}: {
  chat: ChatSummary;
  isActive: boolean;
  isEditing: boolean;
  editingTitle: string;
  isMutating: boolean;
  onStartRename: () => void;
  onEditingChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const isArchived = chat.status === "archived" || chat.skillStatus === "archived";

  return (
    <div
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2 px-6 py-3 text-left transition-colors",
        isActive
          ? "border-r-4 border-[#1269a2] bg-indigo-50 dark:bg-indigo-950/30"
          : "hover:bg-slate-100 dark:hover:bg-slate-800"
      )}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isEditing) {
          onSelect();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !isEditing) {
          onSelect();
        }
      }}
      data-testid={`chat-item-${chat.id}`}
    >
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitRename();
            }}
          >
            <Input
              value={editingTitle}
              autoFocus
              disabled={isMutating}
              onChange={(event) => onEditingChange(event.target.value)}
              onBlur={onSubmitRename}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onCancelRename();
                }
            }}
            className="h-8"
            data-testid="input-rename-chat"
          />
        </form>
      ) : (
          <div className="flex items-center gap-2">
            {isArchived ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Archive className="h-4 w-4 text-amber-600" aria-label="Архивный чат" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Чат архивирован</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            <p
              className={cn(
                "truncate text-base font-medium",
                isArchived ? "text-muted-foreground" : "text-slate-900 dark:text-slate-100"
              )}
              data-testid={`text-chat-title-${chat.id}`}
            >
              {chat.title || "Без названия"}
            </p>
          </div>
        )}
      </div>
      {!isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="invisible h-7 w-7 shrink-0 text-muted-foreground transition group-hover:visible hover:text-foreground"
              onClick={(event) => event.stopPropagation()}
              data-testid={`button-chat-menu-${chat.id}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                onStartRename();
              }}
              data-testid={`button-rename-chat-${chat.id}`}
            >
              Переименовать
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              data-testid={`button-delete-chat-${chat.id}`}
            >
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}


function useDebouncedValue<T>(value: T, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debouncedValue;
}
