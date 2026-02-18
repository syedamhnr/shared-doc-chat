import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations, Conversation } from "@/hooks/useChat";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquarePlus,
  MessageSquare,
  Trash2,
  MoreHorizontal,
  ShieldCheck,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

export function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}: ConversationSidebarProps) {
  const { user, isAdmin, signOut } = useAuth();
  const { conversations, deleteConversation } = useConversations();
  const navigate = useNavigate();

  const groupByDate = (convos: Conversation[]) => {
    const today: Conversation[] = [];
    const week: Conversation[] = [];
    const older: Conversation[] = [];
    const now = Date.now();

    convos.forEach((c) => {
      const diff = now - new Date(c.updated_at).getTime();
      if (diff < 86_400_000) today.push(c);
      else if (diff < 7 * 86_400_000) week.push(c);
      else older.push(c);
    });

    return { today, week, older };
  };

  const { today, week, older } = groupByDate(conversations);

  const ConvoGroup = ({ label, items }: { label: string; items: Conversation[] }) => {
    if (!items.length) return null;
    return (
      <div className="mb-2">
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          {label}
        </p>
        {items.map((c) => (
          <SidebarMenuItem key={c.id} className="group/item list-none">
            <SidebarMenuButton
              onClick={() => onSelectConversation(c.id)}
              className={cn(
                "w-full justify-between rounded-lg px-3 py-2 text-sm",
                activeConversationId === c.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="ml-1 hidden shrink-0 rounded p-0.5 hover:bg-sidebar-border group-hover/item:flex">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="right" className="w-40">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => deleteConversation(c.id)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </div>
    );
  };

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      {/* Header */}
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar-primary">
              <MessageSquare className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-sidebar-foreground">DocChat</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onNewConversation}
            className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
            title="New conversation"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
      </SidebarHeader>

      {/* Conversations list */}
      <SidebarContent className="chat-scroll overflow-y-auto px-2 py-3">
        <SidebarMenu>
          {conversations.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-sidebar-foreground/50">
              No conversations yet.
              <br />Start a new one!
            </p>
          )}
          <ConvoGroup label="Today" items={today} />
          <ConvoGroup label="This week" items={week} />
          <ConvoGroup label="Older" items={older} />
        </SidebarMenu>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border px-2 py-2">
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => navigate("/admin")}
          >
            <ShieldCheck className="h-4 w-4 text-sidebar-primary" />
            Admin Panel
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-primary/20">
                <User className="h-3.5 w-3.5 text-sidebar-primary" />
              </div>
              <span className="min-w-0 flex-1 truncate text-left text-xs">
                {user?.email}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-48">
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
