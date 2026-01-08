import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  addUserNote,
  fetchAuditLogs,
  fetchUserById,
  fetchUserNotes,
  logAdminAction,
  sendPasswordReset,
  updateUser,
  updateUserProfile,
} from "@/services/adminService";
import { AdminNote, AppUser, AuditLog } from "@/types/admin";
import { toast } from "@/components/ui/use-toast";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export default function AdminUserDetails() {
  const { id } = useParams();
  const { canManageUsers, canAssignAdmin, canImpersonate } = useAdminAccess();
  const [user, setUser] = useState<AppUser | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        setLoading(true);
        const [userData, logs, noteRows] = await Promise.all([
          fetchUserById(id),
          fetchAuditLogs({ entityType: "app_user", entityId: id, limit: 20 }),
          fetchUserNotes(id),
        ]);
        if (cancelled) return;
        setUser(userData);
        setProfileName(userData?.full_name ?? "");
        setProfileEmail(userData?.email ?? "");
        setAuditLogs(logs);
        setNotes(noteRows);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load user", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleUpdate = async (payload: {
    status?: "active" | "inactive";
    approval?: "pending" | "approved" | "rejected";
  }) => {
    if (!user) return;
    try {
      await updateUser({ userId: user.user_id, ...payload });
      toast({ title: "User updated" });
      const fresh = await fetchUserById(user.user_id);
      setUser(fresh);
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleAddNote = async () => {
    if (!user || !noteBody.trim()) return;
    try {
      await addUserNote({ userId: user.user_id, note: noteBody.trim() });
      const updated = await fetchUserNotes(user.user_id);
      setNotes(updated);
      setNoteBody("");
      toast({ title: "Note saved" });
    } catch (e: any) {
      toast({ title: "Could not save note", description: e?.message, variant: "destructive" });
    }
  };

  const handleImpersonate = async () => {
    if (!user) return;
    try {
      await logAdminAction({
        actionType: "impersonate_start",
        entityType: "app_user",
        entityId: user.user_id,
        after: { reason: impersonateReason.trim() || "N/A" },
      });
      toast({ title: "Impersonation logged", description: "Session switching is not wired yet." });
      setImpersonateOpen(false);
      setImpersonateReason("");
    } catch (e: any) {
      toast({ title: "Impersonation failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleProfileSave = async () => {
    if (!user) return;
    try {
      await updateUserProfile({
        userId: user.user_id,
        fullName: profileName.trim() || null,
        email: profileEmail.trim() || null,
      });
      toast({ title: "Profile updated" });
      const fresh = await fetchUserById(user.user_id);
      setUser(fresh);
    } catch (e: any) {
      toast({ title: "Profile update failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;
    try {
      await sendPasswordReset(user.email);
      toast({ title: "Password reset sent", description: `Email sent to ${user.email}` });
    } catch (e: any) {
      toast({ title: "Reset failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleGrantDemo = async () => {
    if (!user) return;
    try {
      await updateUser({ userId: user.user_id, subscriptionPeriod: "demo_7d", subscriptionExpiresAt: null });
      toast({ title: "Demo access granted", description: "7-day demo applied." });
      const fresh = await fetchUserById(user.user_id);
      setUser(fresh);
    } catch (e: any) {
      toast({ title: "Demo update failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">User profile</div>
          <div className="text-sm text-slate-500">Review user status and activity.</div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/users">Back to users</Link>
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : user ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">{user.full_name || "Unnamed"}</div>
                <div className="text-sm text-slate-500">{user.email}</div>
              </div>
              <div className="text-xs text-slate-500">Role: {user.role}</div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs uppercase text-slate-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{user.status}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Approval</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{user.approval_status}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Created</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {new Date(user.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canManageUsers}
                onClick={() => handleUpdate({ approval: "approved", status: "active" })}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManageUsers}
                onClick={() => handleUpdate({ approval: "rejected", status: "inactive" })}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManageUsers}
                onClick={() =>
                  handleUpdate({ status: user.status === "active" ? "inactive" : "active" })
                }
              >
                {user.status === "active" ? "Deactivate" : "Activate"}
              </Button>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={user.role}
                disabled={!canManageUsers || (!canAssignAdmin && ["owner", "admin"].includes(user.role))}
                onChange={async (event) => {
                  const nextRole = event.target.value as AppUser["role"];
                  setUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
                  try {
                    await updateUser({ userId: user.user_id, role: nextRole });
                    toast({ title: "Role updated" });
                  } catch (e: any) {
                    toast({ title: "Role update failed", description: e?.message, variant: "destructive" });
                  }
                }}
              >
                <option value="owner" disabled={!canAssignAdmin}>
                  Owner
                </option>
                <option value="admin" disabled={!canAssignAdmin}>
                  Admin
                </option>
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={!canImpersonate}
                onClick={() => setImpersonateOpen(true)}
              >
                Impersonate
              </Button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-slate-500">Full name</div>
                <Input
                  className="mt-2"
                  value={profileName}
                  disabled={!canManageUsers}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Email</div>
                <Input
                  className="mt-2"
                  value={profileEmail}
                  disabled={!canManageUsers}
                  onChange={(event) => setProfileEmail(event.target.value)}
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!canManageUsers} onClick={handleProfileSave}>
                  Save contact info
                </Button>
                <Button size="sm" variant="outline" disabled={!canManageUsers} onClick={handleResetPassword}>
                  Send password reset
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-slate-500">Subscription period</div>
                <select
                  className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={user.subscription_period || ""}
                  disabled={!canManageUsers}
                  onChange={(event) =>
                    setUser((prev) =>
                      prev ? { ...prev, subscription_period: event.target.value || null } : prev
                    )
                  }
                >
                  <option value="">Not set</option>
                  <option value="demo_7d">Demo (7 days)</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500">Subscription expires</div>
                <input
                  type="date"
                  className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={user.subscription_expires_at || ""}
                  disabled={!canManageUsers}
                  onChange={(event) =>
                    setUser((prev) =>
                      prev ? { ...prev, subscription_expires_at: event.target.value || null } : prev
                    )
                  }
                />
              </div>
              <div className="md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canManageUsers}
                    onClick={async () => {
                      if (!user) return;
                      try {
                        await updateUser({
                          userId: user.user_id,
                          subscriptionPeriod: user.subscription_period || null,
                          subscriptionExpiresAt: user.subscription_expires_at || null,
                        });
                        toast({ title: "Subscription updated" });
                      } catch (e: any) {
                        toast({
                          title: "Update failed",
                          description: e?.message,
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    Save subscription
                  </Button>
                  <Button size="sm" variant="outline" disabled={!canManageUsers} onClick={handleGrantDemo}>
                    Grant 7-day demo
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Company</div>
            <div className="mt-2 text-sm text-slate-500">
              {user.client?.name || "No client linked"}
            </div>
            <div className="mt-4 text-xs text-slate-400">
              Last login: {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "--"}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">User not found.</div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Admin notes</div>
          <div className="mt-3 space-y-3">
            <Textarea
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              placeholder="Add a private note about this user..."
            />
            <Button size="sm" variant="outline" disabled={!canManageUsers || !noteBody.trim()} onClick={handleAddNote}>
              Save note
            </Button>
            <div className="space-y-2 text-sm text-slate-600">
              {notes.length ? (
                notes.map((note) => (
                  <div key={note.id} className="rounded-lg border p-2">
                    <div className="text-xs text-slate-500">
                      {note.author?.full_name || note.author?.email || "Admin"} at{" "}
                      {new Date(note.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm text-slate-900">{note.note}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">No notes yet.</div>
              )}
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Audit trail</div>
          <div className="mt-3">
            {auditLogs.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium text-slate-900">{log.action_type}</TableCell>
                      <TableCell className="text-slate-500">{log.entity_type}</TableCell>
                      <TableCell className="text-slate-500">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-sm text-slate-500">No audit entries yet.</div>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate user</DialogTitle>
            <DialogDescription>
              Enter a reason for auditing. Impersonation will be logged.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={impersonateReason}
            onChange={(event) => setImpersonateReason(event.target.value)}
            placeholder="Reason for impersonation..."
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImpersonateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImpersonate} disabled={!impersonateReason.trim() || !canImpersonate}>
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
