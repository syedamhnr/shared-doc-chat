import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";
import { useConversations, useMessages } from "@/hooks/useChat";
import { useToast } from "@/hooks/use-toast";

export default function ChatPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const { createConversation } = useConversations();
  const { messages, addMessage } = useMessages(activeId);
  const { toast } = useToast();

  const handleNewConversation = async () => {
    const id = await createConversation();
    if (id) setActiveId(id);
  };

  const handleSelectConversation = (id: string) => {
    setActiveId(id);
  };

  const handleSend = async (text: string) => {
    // Ensure we have an active conversation
    let convId = activeId;
    if (!convId) {
      convId = await createConversation();
      if (!convId) return;
      setActiveId(convId);
    }

    // Optimistically add the user message (also sets title)
    const titleForConvo = text.length > 50 ? text.slice(0, 50) + "…" : text;
    await addMessage("user", text, [], messages.length === 0 ? titleForConvo : undefined);

    setIsThinking(true);
    try {
      // Call the /chat edge function (to be built next)
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ question: text, conversation_id: convId }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Chat API error");
      }

      const { answer, citations } = await res.json();
      await addMessage("assistant", answer, citations ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      // Show a friendly placeholder if the edge function hasn't been deployed yet
      if (msg.includes("404") || msg.includes("Failed to fetch") || msg.includes("function")) {
        await addMessage(
          "assistant",
          "⚙️ The AI backend function hasn't been deployed yet. Build the `/chat` edge function to get real answers!",
          []
        );
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setIsThinking(false);
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
          <MessageList messages={messages} isThinking={isThinking} />

          {/* Input */}
          <ChatInput
            onSend={handleSend}
            loading={isThinking}
          />
        </div>
      </div>
    </SidebarProvider>
  );
}
