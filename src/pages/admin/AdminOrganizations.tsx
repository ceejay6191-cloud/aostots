import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createOrganizationByEmail, fetchOrganizations } from "@/services/adminService";
import { Organization } from "@/types/admin";
import { toast } from "@/components/ui/use-toast";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export default function AdminOrganizations() {
  const { role } = useAdminAccess();
  const isAdmin = role === "owner" || role === "admin";
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchOrganizations();
        if (!cancelled) setOrganizations(data);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load organizations", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = organizations.filter((org) => {
    if (!search.trim()) return true;
    return org.name.toLowerCase().includes(search.trim().toLowerCase());
  });

  const handleCreate = async () => {
    if (!isAdmin) return;
    const name = createName.trim();
    const owner = ownerEmail.trim();
    const billing = billingEmail.trim();
    if (!name || !owner) return;
    try {
      setCreating(true);
      await createOrganizationByEmail({
        name,
        ownerEmail: owner,
        billingEmail: billing || null,
      });
      setCreateName("");
      setOwnerEmail("");
      setBillingEmail("");
      const refreshed = await fetchOrganizations();
      setOrganizations(refreshed);
      toast({ title: "Organization created" });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Organizations</div>
          <div className="text-sm text-slate-500">Manage client accounts and subscriptions.</div>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search orgs..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="outline" size="sm">
            Filter
          </Button>
        </div>
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Create organization</div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <Input
            placeholder="Organization name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            disabled={!isAdmin}
          />
          <Input
            placeholder="Owner email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            disabled={!isAdmin}
          />
          <Input
            placeholder="Billing email (optional)"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            disabled={!isAdmin}
          />
          <Button
            onClick={handleCreate}
            disabled={!isAdmin || !createName.trim() || !ownerEmail.trim() || creating}
          >
            {creating ? "Creating..." : "Create org"}
          </Button>
        </div>
        {!isAdmin ? (
          <div className="mt-2 text-xs text-slate-500">Only admins can create organizations.</div>
        ) : null}
      </Card>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
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
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium text-slate-900">{org.name}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                        org.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : org.status === "trialing"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {org.status}
                    </span>
                  </TableCell>
                  <TableCell>{org.tags.length ? org.tags.join(", ") : "--"}</TableCell>
                  <TableCell>{new Date(org.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/organizations/${org.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
