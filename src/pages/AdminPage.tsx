import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Link2,
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
  const [googleConnected, setGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [docUrl, setDocUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const fetchStatus = async () => {
    const { data } = await supabase.from("sync_status").select("*").single();
    if (data) setSyncStatus(data as SyncStatus);

    const { data: token } = await supabase
      .from("google_tokens")
      .select("id")
      .maybeSingle();
    setGoogleConnected(!!token);
  };

  useEffect(() => {
    if (!isAdmin) { navigate("/"); return; }
    fetchStatus();

    // Realtime sync_status updates
    const channel = supabase
      .channel("sync-status-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_status" }, fetchStatus)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleConnectGoogle = async () => {
    if (!docUrl.trim()) {
      toast({ title: "Enter a Google Doc URL first", variant: "destructive" });
      return;
    }
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-oauth-init`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ doc_url: docUrl }),
        }
      );
      if (!res.ok) throw new Error("Failed to start OAuth flow");
      const { auth_url } = await res.json();
      window.location.href = auth_url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      // Friendly message if function not yet deployed
      toast({
        title: "Google OAuth not yet configured",
        description: "Deploy the google-oauth-init edge function to enable this. " + msg,
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncNow = async () => {
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
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Admin Panel</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">

        {/* Sync Status Card */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Knowledge Source Status</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sync status</span>
              <StatusBadge status={syncStatus?.status ?? "idle"} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Google Drive</span>
              <div className="flex items-center gap-1.5 text-sm">
                {googleConnected ? (
                  <>
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-primary">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Not connected</span>
                  </>
                )}
              </div>
            </div>
            {syncStatus?.doc_title && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Document</span>
                <span className="text-sm font-medium">{syncStatus.doc_title}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Indexed chunks</span>
              <span className="text-sm font-medium tabular-nums">{syncStatus?.chunk_count ?? 0}</span>
            </div>
            {syncStatus?.last_synced_at && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last synced</span>
                <span className="text-sm tabular-nums">
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

        {/* Connect Google Drive Card */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Connect Google Drive</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Paste the URL of the Google Doc that will serve as the shared knowledge source for all users.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="docUrl">Google Doc URL</Label>
              <Input
                id="docUrl"
                placeholder="https://docs.google.com/document/d/…"
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleConnectGoogle}
                disabled={connecting || !docUrl.trim()}
                className="gap-2"
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                {googleConnected ? "Re-connect Google" : "Connect Google Drive"}
              </Button>
              {googleConnected && (
                <Button
                  variant="outline"
                  onClick={handleSyncNow}
                  disabled={syncing}
                  className="gap-2"
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Sync Now
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Instructions */}
        <section className="rounded-2xl border border-border bg-muted/40 p-6">
          <h2 className="mb-3 text-base font-semibold">Setup Instructions</h2>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Share your Google Doc with anyone with the link (View access).</li>
            <li>Paste the Doc URL above and click <strong>Connect Google Drive</strong>.</li>
            <li>Complete the OAuth consent screen — this grants read access for sync.</li>
            <li>Click <strong>Sync Now</strong> to index the document. Users can then ask questions.</li>
            <li>Re-sync any time you update the document.</li>
          </ol>
        </section>

      </main>
    </div>
  );
}
