import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
}

export interface Citation {
  chunk_id: string;
  chunk_index: number;
  excerpt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toCitations = (raw: any): Citation[] => {
  if (!Array.isArray(raw)) return [];
  return raw as Citation[];
};

export function useConversations() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetch = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      toast({ title: "Error loading conversations", variant: "destructive" });
    } else {
      setConversations(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetch();

    const channel = supabase
      .channel("conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, fetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const createConversation = async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New conversation" })
      .select()
      .single();
    if (error) {
      toast({ title: "Error creating conversation", variant: "destructive" });
      return null;
    }
    await fetch();
    return data.id;
  };

  const deleteConversation = async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    await fetch();
  };

  const renameConversation = async (id: string, title: string) => {
    await supabase.from("conversations").update({ title }).eq("id", id);
    await fetch();
  };

  return { conversations, loading, createConversation, deleteConversation, renameConversation, refresh: fetch };
}

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const fetch = async () => {
    if (!conversationId) { setMessages([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMessages((data ?? []).map((m) => ({
      ...m,
      role: m.role as "user" | "assistant",
      citations: toCitations(m.citations),
    })));
    setLoading(false);
  };

  useEffect(() => {
    fetch();

    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, fetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const addMessage = async (role: "user" | "assistant", content: string, citations: Citation[] = [], conversationTitle?: string) => {
    if (!conversationId || !user) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await supabase
      .from("messages")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ conversation_id: conversationId, user_id: user.id, role, content, citations: citations as any })
      .select()
      .single();
    if (data) {
      const msg: Message = {
        ...data,
        role: data.role as "user" | "assistant",
        citations: toCitations(data.citations),
      };
      setMessages((prev) => [...prev, msg]);
    }
    // Update conversation title from first user message
    if (role === "user" && conversationTitle) {
      await supabase.from("conversations").update({ title: conversationTitle, updated_at: new Date().toISOString() }).eq("id", conversationId);
    }
    return data;
  };

  return { messages, loading, addMessage, refresh: fetch };
}
