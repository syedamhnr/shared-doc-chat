import { useEffect, useRef, useState } from "react";
import { Message, Citation } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import { Bot, User, ChevronDown, ChevronUp } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
}

function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="mt-1 flex w-full flex-col items-start rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="font-semibold text-primary">Source {index + 1}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </div>
      {open && (
        <p className="mt-1.5 text-muted-foreground leading-relaxed">{citation.excerpt}</p>
      )}
    </button>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-muted border border-border"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-foreground" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn("flex max-w-[75%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm bg-card border border-border text-card-foreground"
          )}
        >
          {message.content}
        </div>

        {/* Citations */}
        {!isUser && message.citations.length > 0 && (
          <div className="w-full space-y-1 px-1">
            {message.citations.map((c, i) => (
              <CitationCard key={c.chunk_id ?? i} citation={c} index={i} />
            ))}
          </div>
        )}

        <span className="px-1 text-[10px] text-muted-foreground">
          {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  isThinking: boolean;
}

export function MessageList({ messages, isThinking }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <div className="chat-scroll flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Ask anything</h2>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Your answers will be grounded in the shared knowledge source with cited excerpts.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isThinking && (
          <div className="flex gap-3">
            <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted border border-border">
              <Bot className="h-4 w-4 text-foreground" />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
              <div className="flex gap-1.5 items-center h-5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
