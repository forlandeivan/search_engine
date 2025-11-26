import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
import { Loader2, MoreVertical, Hash, Plus } from "lucide-react";

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
  } = useSkills({ enabled: Boolean(workspaceId) });
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

  const skillsBlock = useMemo(() => {
    if (!workspaceId) {
      return <p className="text-sm text-muted-foreground">Выберите рабочее пространство, чтобы увидеть навыки.</p>;
    }

    if (isSkillsLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем навыки…
        </div>
      );
    }

    if (workspaceSkills.length === 0) {
      return <p className="text-sm text-muted-foreground">Пока нет доступных навыков.</p>;
    }

    return (
      <ul className="space-y-1">
        {workspaceSkills.map((skill) => (
          <li
            key={skill.id}
            className="group flex items-center rounded-lg border border-transparent px-2 py-1 text-sm transition hover:border-slate-200 hover:bg-white dark:hover:bg-slate-900/80"
          >
            <span className="flex-1 truncate" title={skill.name}>
              {skill.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 shrink-0 rounded-full opacity-0 transition group-hover:opacity-100",
                creatingSkillId === skill.id && "opacity-100",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onCreateChatForSkill?.(skill.id);
              }}
              disabled={!workspaceId || creatingSkillId === skill.id}
              aria-label={`Новый чат по навыку ${skill.name}`}
            >
              {creatingSkillId === skill.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </li>
        ))}
      </ul>
    );
  }, [workspaceId, workspaceSkills, isSkillsLoading, creatingSkillId, onCreateChatForSkill]);

  const sidebarContent = useMemo(() => {
    if (!workspaceId) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Чтобы работать с чатами, выберите рабочее пространство.
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем чаты…
        </div>
      );
    }

    if (chats.length === 0) {
      return (
        <div className="p-4 text-sm text-muted-foreground">
          Пока нет диалогов. Создайте новый чат, чтобы начать.
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-1 px-2 py-1">
          {chats.map((chat) => (
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
      </div>
    );
  }, [
    workspaceId,
    chats,
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
    <aside className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-white/70 p-3 dark:bg-slate-900/40", className)}>
      <div className="space-y-1.5">
        <Button asChild variant="ghost" className="justify-start text-sm py-2 px-2">
          <Link href="/skills">Управление навыками</Link>
        </Button>
        <Button
          size="sm"
          className="h-9 w-full"
          onClick={onCreateNewChat}
          disabled={!workspaceId || isCreatingChat}
          data-testid="button-new-chat"
        >
          {isCreatingChat ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Создаём…
            </span>
          ) : (
            "Новый чат"
          )}
        </Button>
        <div className="space-y-0.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Навыки {isSkillsFetching ? "…" : null}
          </div>
          {skillsBlock}
        </div>
      </div>

      <Separator className="my-3" />

      <div className="space-y-1.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по чатам…"
          className="h-8 text-sm"
        />
        {isFetching && !isLoading && (
          <p className="text-xs text-muted-foreground">Обновляем историю…</p>
        )}
      </div>

      <div className="mt-3 flex flex-1 min-h-0 flex-col">
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
  const updatedAt = chat.updatedAt
    ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true, locale: ru })
    : null;

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-2 rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition hover:bg-white/90 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900",
        isActive && "border-primary bg-primary/10 dark:bg-primary/20",
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
            />
          </form>
        ) : (
          <>
            <p className="truncate text-sm font-medium leading-tight">{chat.title || "Без названия"}</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="flex flex-1 min-w-0 items-center gap-1 truncate text-[11px] uppercase tracking-wide">
                <Hash className="h-3 w-3 shrink-0" />
                <span className="truncate">{chat.skillName ?? "Навык"}</span>
              </span>
              {updatedAt && (
                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/80">· {updatedAt}</span>
              )}
            </div>
          </>
        )}
      </div>
      {!isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground transition hover:text-foreground"
              onClick={(event) => event.stopPropagation()}
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
            >
              Переименовать
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
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
