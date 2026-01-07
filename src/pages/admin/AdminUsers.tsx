import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { fetchUsers, updateUser } from "@/services/adminService";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { AdminRole, AppUser } from "@/types/admin";

const pageSize = 10;

export default function AdminUsers() {
  const { canManageUsers, canAssignAdmin } = useAdminAccess();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AdminRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("all");
  const [approvalFilter, setApprovalFilter] = useState<"pending" | "approved" | "rejected" | "all">(
    "all"
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [bulkRole, setBulkRole] = useState<AdminRole>("viewer");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const result = await fetchUsers({
          page,
          pageSize,
          search,
          role: roleFilter,
          status: statusFilter,
          approval: approvalFilter,
        });
        if (cancelled) return;
        setUsers(result.data);
        setTotal(result.total);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load users", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, search, roleFilter, statusFilter, approvalFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const allSelected = useMemo(
    () => users.length > 0 && users.every((user) => selected.has(user.user_id)),
    [users, selected]
  );

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(users.map((user) => user.user_id)));
  };

  const toggleOne = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const runBulk = async (action: "approve" | "deactivate" | "role") => {
    if (!selected.size) return;
    try {
      const ids = Array.from(selected);
      for (const id of ids) {
        if (action === "approve") {
          await updateUser({ userId: id, approval: "approved", status: "active" });
        }
        if (action === "deactivate") {
          await updateUser({ userId: id, status: "inactive" });
        }
        if (action === "role") {
          await updateUser({ userId: id, role: bulkRole });
        }
      }
      toast({ title: "Bulk action completed" });
      setSelected(new Set());
      const result = await fetchUsers({
        page,
        pageSize,
        search,
        role: roleFilter,
        status: statusFilter,
        approval: approvalFilter,
      });
      setUsers(result.data);
      setTotal(result.total);
    } catch (e: any) {
      toast({ title: "Bulk action failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleRowAction = async (user: AppUser, action: "approve" | "reject" | "toggle" | "role") => {
    try {
      if (action === "approve") {
        await updateUser({ userId: user.user_id, approval: "approved", status: "active" });
      }
      if (action === "reject") {
        await updateUser({ userId: user.user_id, approval: "rejected", status: "inactive" });
      }
      if (action === "toggle") {
        await updateUser({
          userId: user.user_id,
          status: user.status === "active" ? "inactive" : "active",
        });
      }
      if (action === "role") {
        await updateUser({ userId: user.user_id, role: user.role });
      }
      toast({ title: "User updated" });
      const result = await fetchUsers({
        page,
        pageSize,
        search,
        role: roleFilter,
        status: statusFilter,
        approval: approvalFilter,
      });
      setUsers(result.data);
      setTotal(result.total);
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">User management</div>
          <div className="text-sm text-slate-500">Approve, activate, and assign roles.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search name or email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="outline" size="sm" onClick={() => setPage(1)}>
            Search
          </Button>
        </div>
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-2 md:grid-cols-4">
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as AdminRole | "all")}
          >
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="viewer">Viewer</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "active" | "inactive" | "all")}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={approvalFilter}
            onChange={(event) =>
              setApprovalFilter(event.target.value as "pending" | "approved" | "rejected" | "all")
            }
          >
            <option value="all">All approvals</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(1)}>
              Apply filters
            </Button>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Bulk actions</span>
          <Button size="sm" variant="outline" disabled={!selected.size || !canManageUsers} onClick={() => runBulk("approve")}>
            Approve selected
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={!selected.size || !canManageUsers}>
                Deactivate selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate selected users?</AlertDialogTitle>
                <AlertDialogDescription>
                  They will lose access until reactivated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => runBulk("deactivate")}>Deactivate</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={bulkRole}
            onChange={(event) => setBulkRole(event.target.value as AdminRole)}
          >
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
            <option value="admin" disabled={!canAssignAdmin}>
              Admin
            </option>
            <option value="owner" disabled={!canAssignAdmin}>
              Owner
            </option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected.size || !canManageUsers || (!canAssignAdmin && ["owner", "admin"].includes(bulkRole))}
            onClick={() => runBulk("role")}
          >
            Assign role
          </Button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(user.user_id)}
                        onCheckedChange={() => toggleOne(user.user_id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {user.full_name ?? "Unnamed"}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={user.role}
                        disabled={!canManageUsers || (!canAssignAdmin && ["owner", "admin"].includes(user.role))}
                        onChange={async (event) => {
                          const nextRole = event.target.value as AdminRole;
                          setUsers((prev) =>
                            prev.map((row) => (row.user_id === user.user_id ? { ...row, role: nextRole } : row))
                          );
                          try {
                            await updateUser({ userId: user.user_id, role: nextRole });
                            toast({ title: "Role updated" });
                          } catch (e: any) {
                            toast({
                              title: "Role update failed",
                              description: e?.message,
                              variant: "destructive",
                            });
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
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          user.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {user.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          user.approval_status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : user.approval_status === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {user.approval_status}
                      </span>
                    </TableCell>
                    <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>{user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : "--"}</TableCell>
                    <TableCell>{user.client?.name ?? "--"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {user.approval_status === "pending" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => handleRowAction(user, "approve")}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleRowAction(user, "reject")}>
                              Reject
                            </Button>
                          </>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => handleRowAction(user, "toggle")}>
                          {user.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/admin/users/${user.user_id}`}>View</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
