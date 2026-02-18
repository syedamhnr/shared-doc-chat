import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";
import { useConversations, useMessages, Citation } from "@/hooks/useChat";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function ChatPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  // The live streaming text for the current assistant turn (empty = not streaming)
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const { createConversation, refresh: refreshConversations } = useConversations();
  const { messages, addMessage, refresh: refreshMessages } = useMessages(activeId);
  const { toast } = useToast();

  const handleNewConversation = async () => {
    const id = await createConversation();
    if (id) setActiveId(id);
  };

  const handleSelectConversation = (id: string) => {
    setActiveId(id);
    setStreamingContent("");
    setStreamingCitations([]);
    setIsStreaming(false);
  };

  const handleSend = async (text: string) => {
    // Ensure we have an active conversation
    let convId = activeId;
    if (!convId) {
      convId = await createConversation();
      if (!convId) return;
      setActiveId(convId);
    }

    // Persist & display user message; set conversation title on first message
    const titleForConvo = text.length > 50 ? text.slice(0, 50) + "…" : text;
    const isFirstMessage = messages.length === 0;
    await addMessage("user", text, [], isFirstMessage ? titleForConvo : undefined, convId);
    if (isFirstMessage) refreshConversations();

    // Begin streaming
    setStreamingContent("");
    setStreamingCitations([]);
    setIsStreaming(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ question: text, conversation_id: convId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const status = resp.status;
        if (status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
        if (status === 402) throw new Error("AI usage limit reached. Please add credits.");
        throw new Error((err as { error?: string }).error ?? "Chat API error");
      }

      if (!resp.body) throw new Error("No response body");

      // ── SSE token-by-token reader ──────────────────────────────────────────
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let done = false;
      let accumulated = "";

      while (!done) {
        const { done: chunkDone, value } = await reader.read();
        if (chunkDone) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIdx);
          textBuffer = textBuffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.trim() === "" || line.startsWith(":")) continue;

          // Custom citations event sent before streaming begins
          if (line.startsWith("event: citations")) continue;
          if (line.startsWith("data: ") && textBuffer.startsWith("{\"0\"") === false) {
            const jsonStr = line.slice(6).trim();

            // Citations preamble event
            if (textBuffer === "" && jsonStr.startsWith("[")) {
              try {
                const parsed = JSON.parse(jsonStr) as Citation[];
                setStreamingCitations(parsed);
              } catch { /* not JSON array */ }
              continue;
            }

            if (jsonStr === "[DONE]") { done = true; break; }

            try {
              const parsed = JSON.parse(jsonStr);

              // Handle citations event (array)
              if (Array.isArray(parsed)) {
                setStreamingCitations(parsed);
                continue;
              }

              const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (delta) {
                accumulated += delta;
                setStreamingContent(accumulated);
              }
            } catch {
              // Incomplete JSON — put line back and wait for more
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }
      }

      // Flush any remaining buffer
      if (textBuffer.trim()) {
        for (const raw of textBuffer.split("\n")) {
          if (!raw || raw.startsWith(":")) continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              setStreamingCitations(parsed);
            } else {
              const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (delta) {
                accumulated += delta;
                setStreamingContent(accumulated);
              }
            }
          } catch { /* ignore partial */ }
        }
      }

      // The edge function already persisted the message; just refresh local state
      await refreshMessages();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setStreamingContent("");
      setStreamingCitations([]);
      setIsStreaming(false);
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <ConversationSidebar
          activeConversationId={activeId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Topbar */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
            <SidebarTrigger />
            <span className="text-sm font-medium text-muted-foreground">
              {activeId ? "Conversation" : "DocChat"}
            </span>
          </header>

          {/* Messages */}
          <MessageList
            messages={messages}
            isThinking={false}
            streamingContent={streamingContent}
            streamingCitations={streamingCitations}
            isStreaming={isStreaming}
          />

          {/* Input */}
          <ChatInput onSend={handleSend} loading={isStreaming} />
        </div>
      </div>
    </SidebarProvider>
  );
}
