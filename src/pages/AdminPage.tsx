import { useState, useEffect, useRef } from "react";
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
  Upload,
  FileSpreadsheet,
  X,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");

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

  const parseCsvPreview = (text: string) => {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) { setPreview(null); return; }
    const parse = (line: string): string[] => {
      const result: string[] = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQ = !inQ; }
        else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
        else { cur += ch; }
      }
      result.push(cur.trim());
      return result;
    };
    const headers = parse(lines[0]);
    const rows = lines.slice(1, 6).map(parse); // show first 5 rows
    setPreview({ headers, rows });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Please upload a CSV file", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      parseCsvPreview(text);
    };
    reader.readAsText(file);
  };

  const handlePasteChange = (text: string) => {
    setCsvText(text);
    parseCsvPreview(text);
  };

  const clearFile = () => {
    setCsvText("");
    setFileName(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSync = async () => {
    if (!csvText.trim()) {
      toast({ title: "No CSV content to sync", variant: "destructive" });
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
          body: JSON.stringify({ csv: csvText, source_label: fileName ?? "pasted-csv" }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Sync failed");
      }
      const { chunk_count, row_count } = await res.json() as { chunk_count: number; row_count: number };
      toast({ title: `Sync complete! ${row_count} rows → ${chunk_count} chunks indexed.` });
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
      idle:    { label: "Idle",     icon: <Clock className="h-3 w-3" />,                              variant: "secondary" },
      syncing: { label: "Syncing",  icon: <RefreshCw className="h-3 w-3 animate-spin" />,            variant: "default" },
      error:   { label: "Error",    icon: <XCircle className="h-3 w-3" />,                           variant: "destructive" },
      done:    { label: "Synced",   icon: <CheckCircle2 className="h-3 w-3 text-primary-foreground" />, variant: "default" },
    };
    const s = map[status] ?? map.idle;
    return <Badge variant={s.variant} className="gap-1.5">{s.icon}{s.label}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
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
            {syncStatus?.doc_title && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Source</span>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                  {syncStatus.doc_title}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Indexed rows</span>
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

        {/* CSV Upload / Paste Card */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">CSV Knowledge Source</h2>
          </div>
          <p className="mb-5 text-sm text-muted-foreground">
            Upload or paste a CSV exported from Google Sheets. The first row must be headers.
            Each data row becomes a searchable chunk.
          </p>

          {/* Tab switcher */}
          <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1 w-fit">
            {(["upload", "paste"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); clearFile(); }}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "upload" ? "Upload File" : "Paste CSV"}
              </button>
            ))}
          </div>

          {activeTab === "upload" ? (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
              {!fileName ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/60"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Click to upload CSV</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">or drag and drop</p>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-primary" />
                  <span className="flex-1 truncate text-sm font-medium">{fileName}</span>
                  <button onClick={clearFile} className="rounded p-1 hover:bg-muted">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Paste CSV content</Label>
              <Textarea
                placeholder={"name,age,city\nAlice,30,NYC\nBob,25,LA"}
                value={csvText}
                onChange={(e) => handlePasteChange(e.target.value)}
                className="min-h-[180px] resize-y font-mono text-xs"
              />
            </div>
          )}

          {/* Preview table */}
          {preview && (
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/50 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview — {preview.headers.length} columns · showing first {preview.rows.length} rows
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                      {preview.headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{ri + 1}</td>
                        {preview.headers.map((_, ci) => (
                          <td key={ci} className="px-3 py-2 text-foreground max-w-[200px] truncate">{row[ci] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Button
            onClick={handleSync}
            disabled={syncing || !csvText.trim()}
            className="mt-4 gap-2"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
        </section>

        {/* How it works */}
        <section className="rounded-2xl border border-border bg-muted/40 p-6">
          <h2 className="mb-3 text-base font-semibold">How it works</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Export your Google Sheet as <strong>File → Download → CSV</strong>.</li>
            <li>Upload the file or paste the CSV above. The first row must contain column headers.</li>
            <li>Click <strong>Sync Now</strong>. Each row is converted to a text chunk and embedded.</li>
            <li>Users can then ask questions — the AI retrieves the most relevant rows and cites them as <strong>[Row 12]</strong>.</li>
            <li>Re-sync any time you update the sheet.</li>
          </ol>
        </section>

      </main>
    </div>
  );
}
