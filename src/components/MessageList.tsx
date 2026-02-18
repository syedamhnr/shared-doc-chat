import { useEffect, useRef, useState } from "react";
import { Message, Citation } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import { Bot, User, ChevronDown, ChevronUp, TableIcon, Copy, Check, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";

// ── Row Preview Sheet ──────────────────────────────────────────────────────────

/**
 * Parse a CSV-row excerpt into ordered key/value pairs.
 * Handles multiple formats:
 *   - Newline-separated:  "Key: Value\nKey2: Value2"
 *   - Semicolon-separated: "Key: Value; Key2: Value2"
 *   - Comma-separated:    "Key: Value, Key2: Value2"
 */
function parseExcerpt(excerpt: string): Array<{ key: string; value: string }> {
  // Determine the delimiter: prefer newline, then semicolons, then commas
  let segments: string[];
  if (excerpt.includes("\n")) {
    segments = excerpt.split("\n");
  } else if (/;\s*\w[^:]*:/.test(excerpt)) {
    // Semicolon-separated "Key: Value; Key2: Value2"
    segments = excerpt.split(";");
  } else {
    // Comma-separated — only split on commas followed by a "Word:"
    segments = excerpt.split(/,(?=\s*[A-Za-z][^:]*:)/);
  }

  return segments
    .map((seg) => {
      const colonIdx = seg.indexOf(":");
      if (colonIdx === -1) return null;
      const key = seg.slice(0, colonIdx).trim();
      const value = seg.slice(colonIdx + 1).trim();
      if (!key) return null;
      return { key, value };
    })
    .filter((pair): pair is { key: string; value: string } => pair !== null);
}

interface RowPreviewSheetProps {
  citation: Citation | null;
  onClose: () => void;
}

function RowPreviewSheet({ citation, onClose }: RowPreviewSheetProps) {
  if (!citation) return null;
  const label = citation.row_number ? `Row ${citation.row_number}` : `Source ${citation.reference ?? ""}`;
  const pairs = parseExcerpt(citation.excerpt);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <TableIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">{label}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pairs.length > 0 ? (
            <dl className="space-y-3">
              {pairs.map(({ key, value }, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                  <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="text-sm text-foreground break-words">
                    {value || <span className="italic text-muted-foreground">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            // Fallback: show raw excerpt in a mono block
            <pre className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {citation.excerpt}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

// ── Citation Card ─────────────────────────────────────────────────────────────

interface CitationCardProps {
  citation: Citation;
  onPreview: (citation: Citation) => void;
}

function CitationCard({ citation, onPreview }: CitationCardProps) {
  const [open, setOpen] = useState(false);
  const label = citation.row_number ? `Row ${citation.row_number}` : `Source ${citation.reference ?? ""}`;

  return (
    <div className="mt-1 rounded-lg border border-border/60 bg-muted/40 text-xs transition-colors hover:bg-muted">
      {/* Main row: label + preview button + toggle */}
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => onPreview(citation)}
          className="flex items-center gap-1.5 text-left"
        >
          <TableIcon className="h-3 w-3 text-primary shrink-0" />
          <span className="font-semibold text-primary hover:underline underline-offset-2">{label}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onPreview(citation)}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            View data
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground hover:text-foreground"
            title={open ? "Collapse" : "Expand excerpt"}
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {open && (() => {
        const pairs = parseExcerpt(citation.excerpt);
        const first = pairs[0];
        return (
          <div className="border-t border-border/40 px-3 pb-2 pt-1.5">
            {first ? (
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground/60">{first.key}: </span>
                {first.value}
              </p>
            ) : (
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {citation.excerpt}
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
}


function AssistantContent({
  content,
  citations = [],
  onPreview,
}: {
  content: string;
  citations?: Citation[];
  onPreview?: (c: Citation) => void;
}) {
  // Map row numbers to their citation objects for quick lookup
  const citationByRow = new Map<number, Citation>();
  citations.forEach((c) => {
    if (c.row_number !== undefined) citationByRow.set(c.row_number, c);
  });

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
    // Inline code — handles citation pills AND fenced code blocks
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const isBlock = Boolean(match);
      const codeString = String(children).replace(/\n$/, "");

      // Clickable citation pill: [Row N]
      const rowMatch = /^\[Row (\d+)\]$/.exec(codeString);
      if (!isBlock && rowMatch) {
        const rowNum = parseInt(rowMatch[1], 10);
        const linkedCitation = citationByRow.get(rowNum);
        const isClickable = Boolean(linkedCitation && onPreview);
        return (
          <button
            type="button"
            onClick={isClickable ? () => onPreview!(linkedCitation!) : undefined}
            className={cn(
              "rounded bg-primary/15 px-1 py-0.5 text-xs font-semibold text-primary",
              isClickable && "cursor-pointer hover:bg-primary/25 transition-colors underline underline-offset-2"
            )}
            title={isClickable ? `Preview ${codeString}` : undefined}
          >
            {codeString}
          </button>
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

  // Pre-process: wrap [Row N] citations so the code renderer catches them
  // Add a zero-width space between adjacent pills to prevent markdown from
  // treating "`[Row 9]``[Row 10]`" as a single code span with an embedded backtick.
  const processed = content
    .replace(/\[Row (\d+)\]/g, "`[Row $1]`")
    .replace(/`(\s*)`/g, "` `");

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

function MessageBubble({
  message,
  onPreview,
}: {
  message: Message;
  onPreview: (c: Citation) => void;
}) {
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
            : <AssistantContent content={message.content} citations={message.citations} onPreview={onPreview} />}
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
              <CitationCard key={c.chunk_id ?? i} citation={c} onPreview={onPreview} />
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
  /** Token-by-token content being streamed right now */
  streamingContent?: string;
  streamingCitations?: Citation[];
  isStreaming?: boolean;
}

export function MessageList({
  messages,
  isThinking,
  streamingContent = "",
  streamingCitations = [],
  isStreaming = false,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, streamingContent]);

  const showEmpty = messages.length === 0 && !isThinking && !isStreaming;

  return (
    <>
      <RowPreviewSheet citation={previewCitation} onClose={() => setPreviewCitation(null)} />

      <div className="chat-scroll flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
          {showEmpty && (
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
            <MessageBubble key={m.id} message={m} onPreview={setPreviewCitation} />
          ))}

          {/* Live streaming bubble */}
          {isStreaming && (
            <div className="group flex gap-3">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                <Bot className="h-4 w-4 text-foreground" />
              </div>
              <div className="flex max-w-[78%] flex-col gap-1">
                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-card-foreground">
                  {streamingContent ? (
                    <>
                      <AssistantContent
                        content={streamingContent}
                        citations={streamingCitations}
                        onPreview={setPreviewCitation}
                      />
                      {/* Blinking cursor */}
                      <span className="inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-foreground/60 ml-0.5" />
                    </>
                  ) : (
                    /* Thinking dots while waiting for first token */
                    <div className="flex h-5 items-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Citations preview while streaming */}
                {streamingCitations.length > 0 && (
                  <div className="w-full space-y-1 px-1">
                    <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Retrieved rows
                    </p>
                    {streamingCitations.map((c, i) => (
                      <CitationCard key={c.chunk_id ?? i} citation={c} onPreview={setPreviewCitation} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legacy thinking indicator */}
          {isThinking && !isStreaming && (
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
    </>
  );
}


