import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatPageParams = {
  workspaceId?: string;
  chatId?: string;
};

type ChatPageProps = {
  params?: ChatPageParams;
};

type PlaceholderChat = {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
};

const placeholderChats: PlaceholderChat[] = [
  {
    id: "preview-1",
    title: "Unica Chat",
    preview: "Обсуждение по умолчанию для системного навыка.",
    timestamp: "Сегодня, 10:15",
  },
  {
    id: "preview-2",
    title: "Маркетинговые материалы",
    preview: "Планы по обновлению презентации и FAQ.",
    timestamp: "Вчера, 18:02",
  },
  {
    id: "preview-3",
    title: "Техническая поддержка",
    preview: "Вопрос по новому релизу.",
    timestamp: "15 ноя, 09:47",
  },
];

export default function ChatPage({ params }: ChatPageProps) {
  const workspaceId = params?.workspaceId ?? "";
  const chatId = params?.chatId ?? "";

  const hasActiveChat = Boolean(chatId);

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex h-full">
        <ChatSidebarPlaceholder workspaceId={workspaceId} activeChatId={chatId} />
        <section className="flex flex-1 flex-col">
          {hasActiveChat ? (
            <ExistingChatPlaceholder chatId={chatId} />
          ) : (
            <NewChatPlaceholder workspaceId={workspaceId} />
          )}
        </section>
      </div>
    </div>
  );
}

function ChatSidebarPlaceholder({
  workspaceId,
  activeChatId,
}: {
  workspaceId?: string;
  activeChatId?: string;
}) {
  return (
    <aside className="w-[320px] border-r bg-white/60 p-4 dark:bg-slate-900/40">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Мои диалоги</h2>
        <Button size="sm" variant="outline" className="text-xs">
          Новый чат
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Workspace: {workspaceId || "не выбран"}
      </p>
      <div className="mt-4 space-y-2">
        {placeholderChats.map((chat) => (
          <PlaceholderChatCard
            key={chat.id}
            chat={chat}
            isActive={chat.id === activeChatId}
          />
        ))}
      </div>
    </aside>
  );
}

function PlaceholderChatCard({
  chat,
  isActive,
}: {
  chat: PlaceholderChat;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white/80 p-3 text-left transition hover:bg-white dark:bg-slate-900/40",
        isActive && "border-primary bg-primary/5"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="font-medium">{chat.title}</p>
        <span className="text-[11px] text-muted-foreground">{chat.timestamp}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{chat.preview}</p>
    </div>
  );
}

function NewChatPlaceholder({ workspaceId }: { workspaceId?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Workspace: {workspaceId || "не выбран"}</p>
        <h1 className="text-2xl font-semibold">Начните новый диалог</h1>
        <p className="text-muted-foreground">
          По умолчанию будет использоваться системный навык Unica Chat. Вы сможете выбрать другой навык и увидеть историю, как только начнёте переписку.
        </p>
      </div>

      <div className="w-full max-w-2xl space-y-3 rounded-xl border bg-white p-6 text-left shadow-sm dark:bg-slate-900/40">
        <p className="text-sm font-medium">Навык: Unica Chat</p>
        <Textarea rows={4} placeholder="Напишите первый вопрос..." />
        <div className="flex justify-end">
          <Button disabled>Отправить</Button>
        </div>
      </div>
    </div>
  );
}

function ExistingChatPlaceholder({ chatId }: { chatId: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-white/80 px-6 py-4 dark:bg-slate-900/40">
        <p className="text-sm text-muted-foreground">Чат</p>
        <h1 className="text-xl font-semibold">История беседы #{chatId}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
        Здесь будет история выбранного диалога и поток сообщений.
      </div>
    </div>
  );
}
