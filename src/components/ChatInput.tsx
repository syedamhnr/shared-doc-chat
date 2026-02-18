import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizonal, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ChatInput({ onSend, disabled, loading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="border-t border-border bg-background/80 px-4 py-4 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl">
        <div className="relative flex items-end gap-0 rounded-2xl border border-input bg-card shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder="Message…  (Enter to send, Shift+Enter for newline)"
            disabled={disabled || loading}
            rows={1}
            className="max-h-48 min-h-[52px] flex-1 resize-none border-0 bg-transparent py-3.5 pl-4 pr-14 text-sm shadow-none focus-visible:ring-0"
          />
          <Button
            onClick={handleSend}
            disabled={!value.trim() || disabled || loading}
            size="icon"
            className="absolute bottom-2 right-2 h-9 w-9 shrink-0 rounded-xl"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <SendHorizonal className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Answers are grounded in your CSV data. Verify important information.
        </p>
      </div>
    </div>
  );
}
