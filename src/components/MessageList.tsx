import { useEffect, useRef, useState } from "react";
import { Message, Citation } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import { Bot, User, ChevronDown, ChevronUp, TableIcon, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";

interface CitationCardProps {
  citation: Citation;
}

function CitationCard({ citation }: CitationCardProps) {
  const [open, setOpen] = useState(false);
  const label = citation.row_number ? `Row ${citation.row_number}` : `Source ${citation.reference ?? ""}`;

  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="mt-1 flex w-full flex-col items-start rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TableIcon className="h-3 w-3 text-primary" />
          <span className="font-semibold text-primary">{label}</span>
          {citation.similarity !== undefined && (
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
              {citation.similarity}% match
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </div>
      {open && (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{citation.excerpt}</p>
      )}
    </button>
  );
}

function AssistantContent({ content }: { content: string }) {
  const components: Components = {
    // Paragraphs
    p({ children }) {
      return <p className="mb-3 last:mb-0 text-sm leading-relaxed">{children}</p>;
    },
    // Headings
    h1({ children }) {
      return <h1 className="mb-3 mt-4 text-lg font-bold first:mt-0">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>;
    },
    // Lists
    ul({ children }) {
      return <ul className="mb-3 ml-4 list-disc space-y-1 text-sm last:mb-0">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm last:mb-0">{children}</ol>;
    },
    li({ children }) {
      return <li className="leading-relaxed">{children}</li>;
    },
    // Blockquote
    blockquote({ children }) {
      return (
        <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground last:mb-0">
          {children}
        </blockquote>
      );
    },
    // Horizontal rule
    hr() {
      return <hr className="my-3 border-border" />;
    },
    // Strong / em
    strong({ children }) {
      return <strong className="font-semibold text-foreground">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
    // Tables (GFM)
    table({ children }) {
      return (
        <div className="mb-3 overflow-x-auto rounded-lg border border-border last:mb-0">
          <table className="w-full text-sm">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead className="bg-muted/50">{children}</thead>;
    },
    tr({ children }) {
      return <tr className="border-b border-border/50 last:border-0">{children}</tr>;
    },
    th({ children }) {
      return <th className="px-3 py-2 text-left font-medium text-foreground">{children}</th>;
    },
    td({ children }) {
      return <td className="px-3 py-2 text-muted-foreground">{children}</td>;
    },
    // Links
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {children}
        </a>
      );
    },
    // Inline code
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const isBlock = Boolean(match);
      const codeString = String(children).replace(/\n$/, "");

      // Citation pill: [Row N]
      if (!isBlock && /^\[Row \d+\]$/.test(codeString)) {
        return (
          <span className="rounded bg-primary/15 px-1 py-0.5 text-xs font-semibold text-primary">
            {codeString}
          </span>
        );
      }

      if (isBlock) {
        return (
          <div className="mb-3 overflow-hidden rounded-lg border border-border last:mb-0">
            <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {match![1]}
              </span>
              <CodeCopyButton code={codeString} />
            </div>
            <SyntaxHighlighter
              style={oneDark}
              language={match![1]}
              PreTag="div"
              customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: "0.78rem",
                lineHeight: "1.6",
                padding: "1rem",
                background: "hsl(var(--card))",
              }}
              codeTagProps={{ style: { fontFamily: "var(--font-mono, monospace)" } }}
            >
              {codeString}
            </SyntaxHighlighter>
          </div>
        );
      }

      // Inline code
      return (
        <code
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    },
  };

  // Pre-process: highlight [Row N] citations not wrapped in backticks
  const processed = content.replace(/\[Row (\d+)\]/g, "`[Row $1]`");

  return (
    <div className="prose-sm prose-neutral max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}

function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy code"}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all",
        "text-muted-foreground hover:text-foreground",
        copied && "text-primary"
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-all",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        copied && "text-primary"
      )}
    >
      {copied
        ? <Check className="h-3.5 w-3.5" />
        : <Copy className="h-3.5 w-3.5" />}
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary"
            : "border border-border bg-card"
        )}
      >
        {isUser
          ? <User className="h-4 w-4 text-primary-foreground" />
          : <Bot className="h-4 w-4 text-foreground" />}
      </div>

      {/* Content */}
      <div className={cn("flex max-w-[78%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-border bg-card text-card-foreground"
          )}
        >
          {isUser
            ? <p className="text-sm leading-relaxed">{message.content}</p>
            : <AssistantContent content={message.content} />}
        </div>

        {/* Bottom row: copy button (assistant only) + timestamp */}
        <div className={cn("flex items-center gap-1 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
          {!isUser && <CopyButton text={message.content} />}
          <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {/* Citations */}
        {!isUser && message.citations.length > 0 && (
          <div className="w-full space-y-1 px-1">
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Retrieved rows
            </p>
            {message.citations.map((c, i) => (
              <CitationCard key={c.chunk_id ?? i} citation={c} />
            ))}
          </div>
        )}
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
    <div className="chat-scroll flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">How can I help?</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Ask any question about your data. I'll retrieve the most relevant rows and answer with citations.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isThinking && (
          <div className="flex gap-3">
            <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card">
              <Bot className="h-4 w-4 text-foreground" />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
              <div className="flex h-5 items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
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
