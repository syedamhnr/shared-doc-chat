import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Database,
} from "lucide-react";

interface SyncStatus {
  id: string;
  last_synced_at: string | null;
  doc_title: string | null;
  chunk_count: number;
  status: string;
  error_message: string | null;
}

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [kbContent, setKbContent] = useState("");
  const [charCount, setCharCount] = useState(0);

  const fetchStatus = async () => {
    const { data } = await supabase.from("sync_status").select("*").single();
    if (data) setSyncStatus(data as SyncStatus);
  };

  useEffect(() => {
    if (!isAdmin) { navigate("/"); return; }
    fetchStatus();

    const channel = supabase
      .channel("sync-status-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_status" }, fetchStatus)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleSync = async () => {
    if (!kbContent.trim()) {
      toast({ title: "Knowledge base content is empty", variant: "destructive" });
      return;
    }
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-doc`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ content: kbContent }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Sync failed");
      }
      const { chunk_count } = await res.json();
      toast({ title: `Sync complete! ${chunk_count} chunks indexed.` });
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      toast({ title: "Sync failed", description: msg, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      idle:    { label: "Idle",     icon: <Clock className="h-3 w-3" />,         variant: "secondary" },
      syncing: { label: "Syncing",  icon: <RefreshCw className="h-3 w-3 animate-spin" />, variant: "default" },
      error:   { label: "Error",    icon: <XCircle className="h-3 w-3" />,       variant: "destructive" },
      done:    { label: "Synced",   icon: <CheckCircle2 className="h-3 w-3" />,  variant: "default" },
    };
    const s = map[status] ?? map.idle;
    return (
      <Badge variant={s.variant} className="gap-1.5">
        {s.icon}
        {s.label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Admin Panel</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">

        {/* Status Card */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Knowledge Base Status</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sync status</span>
              <StatusBadge status={syncStatus?.status ?? "idle"} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Indexed chunks</span>
              <span className="text-sm font-medium tabular-nums">{syncStatus?.chunk_count ?? 0}</span>
            </div>
            {syncStatus?.last_synced_at && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last synced</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {new Date(syncStatus.last_synced_at).toLocaleString()}
                </span>
              </div>
            )}
            {syncStatus?.error_message && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{syncStatus.error_message}</p>
              </div>
            )}
          </div>
        </section>

        {/* Knowledge Base Editor */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Knowledge Base Content</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Paste or type the content you want the AI to use when answering questions. Click <strong>Sync</strong> to index it.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="kbContent">Content</Label>
                <span className="text-xs text-muted-foreground">{charCount.toLocaleString()} characters</span>
              </div>
              <Textarea
                id="kbContent"
                placeholder="Paste your knowledge base content here — FAQs, documentation, product info, etc."
                value={kbContent}
                onChange={(e) => {
                  setKbContent(e.target.value);
                  setCharCount(e.target.value.length);
                }}
                className="min-h-[320px] resize-y font-mono text-sm"
              />
            </div>
            <Button
              onClick={handleSync}
              disabled={syncing || !kbContent.trim()}
              className="gap-2"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? "Syncing…" : "Sync Knowledge Base"}
            </Button>
          </div>
        </section>

        {/* How it works */}
        <section className="rounded-2xl border border-border bg-muted/40 p-6">
          <h2 className="mb-3 text-base font-semibold">How it works</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Paste any text content — docs, FAQs, product info — into the editor above.</li>
            <li>Click <strong>Sync Knowledge Base</strong>. The content is split into chunks and embedded.</li>
            <li>When users ask questions, the AI retrieves the most relevant chunks and answers with citations.</li>
            <li>Re-sync any time you update the content.</li>
          </ol>
        </section>

      </main>
    </div>
  );
}
