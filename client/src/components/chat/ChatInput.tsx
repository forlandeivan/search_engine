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
    <div className="mx-auto w-full max-w-[880px] pb-14">
      <div className="rounded-[28px] border border-slate-200 bg-white/95 px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900/90 sm:px-5 sm:py-4">
        <div className="flex items-end gap-3">
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
            className="min-h-[52px] flex-1 resize-none border-none bg-transparent px-0 py-0 text-base leading-6 focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="input-chat-message"
          />
          <Button
            type="button"
            aria-label="Отправить сообщение"
            title="Отправить сообщение"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full shadow-md"
            onClick={handleSend}
            disabled={isSendDisabled}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">Shift + Enter — новая строка</p>
    </div>
  );
}
