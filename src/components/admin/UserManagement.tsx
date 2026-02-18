import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, ShieldCheck, ShieldOff, Loader2, Search, X } from "lucide-react";

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  isAdmin: boolean;
}

export function UserManagement() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all profiles
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .order("email");

      if (profilesErr) throw profilesErr;

      // Fetch all admin roles
      const { data: adminRoles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (rolesErr) throw rolesErr;

      const adminSet = new Set((adminRoles ?? []).map((r) => r.user_id));

      setUsers(
        (profiles ?? []).map((p) => ({
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          isAdmin: adminSet.has(p.id),
        }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load users";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const toggleAdmin = async (targetUser: UserRow) => {
    if (targetUser.id === currentUser?.id) {
      toast({ title: "You can't change your own role", variant: "destructive" });
      return;
    }
    setToggling(targetUser.id);
    try {
      if (targetUser.isAdmin) {
        // Demote: remove admin role
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", targetUser.id)
          .eq("role", "admin");
        if (error) throw error;
        toast({ title: `${targetUser.email ?? "User"} demoted from admin.` });
      } else {
        // Promote: insert admin role
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: targetUser.id, role: "admin" });
        if (error) throw error;
        toast({ title: `${targetUser.email ?? "User"} promoted to admin.` });
      }
      await fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (u.full_name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">User Management</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Manage registered users and their admin privileges.
      </p>

      {/* Search */}
      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {search ? "No users match your search." : "No users found."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">User</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {u.full_name && (
                        <span className="font-medium text-foreground">{u.full_name}</span>
                      )}
                      <span className={u.full_name ? "text-xs text-muted-foreground" : "text-foreground"}>
                        {u.email ?? "—"}
                      </span>
                      {u.id === currentUser?.id && (
                        <span className="text-xs text-muted-foreground italic">(you)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.isAdmin ? (
                      <Badge variant="default" className="gap-1.5">
                        <ShieldCheck className="h-3 w-3" />
                        Admin
                      </Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant={u.isAdmin ? "outline" : "default"}
                      disabled={toggling === u.id || u.id === currentUser?.id}
                      onClick={() => toggleAdmin(u)}
                      className="gap-1.5"
                    >
                      {toggling === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : u.isAdmin ? (
                        <ShieldOff className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {u.isAdmin ? "Demote" : "Promote"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} user{filtered.length !== 1 ? "s" : ""} shown
        {search ? ` matching "${search}"` : ""}
      </p>
    </section>
  );
}
