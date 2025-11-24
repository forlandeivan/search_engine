import { useCallback, useState } from "react";
import { Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type ChatInputProps = {
  onSend: (message: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
};

export default function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    setValue("");
    await onSend(trimmed);
  }, [disabled, onSend, value]);

  const isSendDisabled = disabled || value.trim().length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 sm:p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder ?? "Напишите сообщение и нажмите Enter"}
            disabled={disabled}
            rows={3}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            className="min-h-[64px] flex-1 resize-none border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="input-chat-message"
          />
          <Button
            type="button"
            aria-label="Отправить сообщение"
            title="Отправить сообщение"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            onClick={handleSend}
            disabled={isSendDisabled}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Shift + Enter — новая строка</p>
    </div>
  );
}
