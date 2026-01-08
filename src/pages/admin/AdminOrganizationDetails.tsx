import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addOrgNote, fetchOrganizationDetail, fetchOrgNotes } from "@/services/adminService";
import { Organization, OrgMembership, OrgSubscription, PaymentMethod, Plan } from "@/types/admin";
import { toast } from "@/components/ui/use-toast";
import { getEntitlementLimit, isFeatureEnabled } from "@/lib/entitlements";
import { Textarea } from "@/components/ui/textarea";

export default function AdminOrganizationDetails() {
  const { id } = useParams();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [subscription, setSubscription] = useState<OrgSubscription | null>(null);
  const [members, setMembers] = useState<OrgMembership[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notes, setNotes] = useState<{ id: string; note: string; created_at: string }[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        setLoading(true);
        const [data, noteRows] = await Promise.all([fetchOrganizationDetail(id), fetchOrgNotes(id)]);
        if (cancelled) return;
        setOrganization(data.organization);
        setSubscription(data.subscription);
        setMembers(data.memberships);
        setPaymentMethods(data.paymentMethods);
        setPlans(data.plans);
        setNotes(noteRows);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load organization", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!organization) {
    return (
      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-500">Organization not found.</div>
      </Card>
    );
  }

  const plan = subscription?.plan ?? plans.find((p) => p.id === subscription?.plan_id) ?? null;
  const featureKeys = ["takeoff_tools_enabled", "estimating_module_enabled", "proposal_export_enabled"];
  const limitKeys = ["max_projects", "max_documents", "storage_limit_gb"];

  const handleAddNote = async () => {
    if (!organization || !noteBody.trim()) return;
    try {
      await addOrgNote({ orgId: organization.id, note: noteBody.trim() });
      const updated = await fetchOrgNotes(organization.id);
      setNotes(updated);
      setNoteBody("");
      toast({ title: "Note saved" });
    } catch (e: any) {
      toast({ title: "Could not save note", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold text-slate-900">{organization.name}</div>
          <div className="text-sm text-slate-500">{organization.billing_email ?? "No billing email"}</div>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/organizations">Back to orgs</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
          <div className="text-sm font-semibold text-slate-900">Organization profile</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm text-slate-600">
            <div>
              <div className="text-xs uppercase text-slate-500">Status</div>
              <div className="font-semibold text-slate-900">{organization.status}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Created</div>
              <div className="font-semibold text-slate-900">
                {new Date(organization.created_at).toLocaleDateString()}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Address</div>
              <div className="font-semibold text-slate-900">{organization.address ?? "--"}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Tags</div>
              <div className="font-semibold text-slate-900">
                {organization.tags.length ? organization.tags.join(", ") : "--"}
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Subscription snapshot</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <div>Plan: <span className="font-semibold text-slate-900">{plan?.name ?? "--"}</span></div>
            <div>Status: <span className="font-semibold text-slate-900">{subscription?.status ?? "--"}</span></div>
            <div>Billing: <span className="font-semibold text-slate-900">{subscription?.billing_cycle ?? "--"}</span></div>
            <div>Renewal: <span className="font-semibold text-slate-900">{subscription?.current_period_end ?? "--"}</span></div>
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Members</div>
        <div className="mt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">
                      {member.user?.full_name ?? "User"}
                    </div>
                    <div className="text-xs text-slate-500">{member.user?.email ?? "--"}</div>
                  </TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{new Date(member.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Admin notes</div>
        <div className="mt-3 space-y-3">
          <Textarea
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="Add a private note about this organization..."
          />
          <Button size="sm" variant="outline" disabled={!noteBody.trim()} onClick={handleAddNote}>
            Save note
          </Button>
          <div className="space-y-2 text-sm text-slate-600">
            {notes.length ? (
              notes.map((note) => (
                <div key={note.id} className="rounded-lg border p-2">
                  <div className="text-xs text-slate-500">{new Date(note.created_at).toLocaleString()}</div>
                  <div className="text-sm text-slate-900">{note.note}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">No notes yet.</div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Entitlements</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {plan?.entitlements_json
              ? Object.entries(plan.entitlements_json).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span>{key}</span>
                    <span className="font-semibold text-slate-900">{String(value)}</span>
                  </div>
                ))
              : "No entitlements defined."}
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Feature gating preview</div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div>
              <div className="text-xs uppercase text-slate-500">Features</div>
              <div className="mt-2 space-y-1">
                {featureKeys.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span>{key}</span>
                    <span className="font-semibold text-slate-900">
                      {isFeatureEnabled(plan?.entitlements_json, key) ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Usage limits</div>
              <div className="mt-2 space-y-1">
                {limitKeys.map((key) => (
                  <div key={key} className="flex items-center justify-between">
                    <span>{key}</span>
                    <span className="font-semibold text-slate-900">
                      {getEntitlementLimit(plan?.usage_limits_json, key) ?? "--"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Payment methods</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {paymentMethods.length ? (
              paymentMethods.map((pm) => (
                <div key={pm.id} className="flex items-center justify-between rounded-lg border p-2">
                  <span>{pm.brand} **** {pm.last4}</span>
                  <span className="text-xs text-slate-500">
                    {pm.exp_month}/{pm.exp_year}
                  </span>
                </div>
              ))
            ) : (
              <div>No payment methods on file.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
