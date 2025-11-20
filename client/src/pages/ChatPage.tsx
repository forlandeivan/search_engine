import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ChatSidebar from "@/components/chat/ChatSidebar";
import { useLocation } from "wouter";

type ChatPageParams = {
  workspaceId?: string;
  chatId?: string;
};

type ChatPageProps = {
  params?: ChatPageParams;
};

export default function ChatPage({ params }: ChatPageProps) {
  const workspaceId = params?.workspaceId ?? "";
  const chatId = params?.chatId ?? "";
  const [, navigate] = useLocation();

  const hasActiveChat = Boolean(chatId);

  const handleSelectChat = (nextChatId: string | null) => {
    if (!workspaceId) {
      return;
    }
    if (nextChatId) {
      navigate(`/workspaces/${workspaceId}/chat/${nextChatId}`);
    } else {
      navigate(`/workspaces/${workspaceId}/chat`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex h-full">
        <ChatSidebar
          workspaceId={workspaceId}
          selectedChatId={chatId}
          onSelectChat={handleSelectChat}
          onCreateNewChat={() => handleSelectChat(null)}
        />
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
