import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChats, useDeleteChat, useRenameChat } from "@/hooks/useChats";
import type { ChatSummary } from "@/types/chat";
import { Loader2, MoreVertical, Hash } from "lucide-react";

type ChatSidebarProps = {
  workspaceId?: string;
  selectedChatId?: string;
  onSelectChat: (chatId: string | null) => void;
  onCreateNewChat: () => void;
};

export default function ChatSidebar({
  workspaceId,
  selectedChatId,
  onSelectChat,
  onCreateNewChat,
}: ChatSidebarProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { chats, isLoading, isFetching } = useChats(workspaceId, debouncedSearch);
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
          Загружаем чаты...
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
      <ScrollArea className="flex-1">
        <div className="space-y-1 pr-2">
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
      </ScrollArea>
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
    <aside className="flex w-[320px] flex-col border-r bg-white/70 p-4 dark:bg-slate-900/40">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Чат</p>
          <h2 className="text-base font-semibold">Мои диалоги</h2>
        </div>
        <Button
          size="sm"
          onClick={onCreateNewChat}
          disabled={!workspaceId}
          data-testid="button-new-chat"
        >
          Новый чат
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по названию..."
        />
        {isFetching && !isLoading && (
          <p className="text-xs text-muted-foreground">Обновляем список...</p>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col space-y-4">
        {sidebarContent}
        <Button asChild variant="ghost" className="justify-start text-sm">
          <Link href="/skills">Управление навыками</Link>
        </Button>
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
    ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true })
    : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition hover:bg-white dark:border-slate-800 dark:hover:bg-slate-900",
        isActive && "border-primary bg-primary/5 dark:bg-primary/10",
      )}
      onClick={() => {
        if (!isEditing) {
          onSelect();
        }
      }}
    >
      <div className="flex-1">
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
            <p className="font-medium leading-tight">{chat.title || "Без названия"}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {chat.skillName ?? "навык"}
              </span>
              {updatedAt && <span>• {updatedAt}</span>}
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
              className="h-8 w-8 opacity-0 transition group-hover:opacity-100"
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
