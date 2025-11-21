import { useCallback, useState } from "react";
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

  return (
    <div className="border-t bg-white/90 px-6 py-4 dark:bg-slate-950/60">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? "Введите сообщение и нажмите Enter"}
        disabled={disabled}
        rows={3}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
          }
        }}
        className="resize-none"
        data-testid="input-chat-message"
      />
      <div className="mt-3 flex justify-end">
        <Button
          onClick={handleSend}
          disabled={disabled || value.trim().length === 0}
          data-testid="button-send-message"
        >
          Отправить
        </Button>
      </div>
    </div>
  );
}
