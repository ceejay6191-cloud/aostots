import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import {
  fetchOrganizations,
  fetchSubscriptions,
  previewProration,
  updateOrgSubscriptionStatus,
} from "@/services/adminService";
import { Organization, OrgSubscription, Plan, ProrationPreview } from "@/types/admin";
import { useAdminAccess } from "@/hooks/useAdminAccess";

const todayString = () => new Date().toISOString().slice(0, 10);
const pageSize = 10;

export default function AdminSubscriptions() {
  const { canEditBilling } = useAdminAccess();
  const [subscriptions, setSubscriptions] = useState<OrgSubscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrgSubscription["status"]>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [sortBy, setSortBy] = useState<"renewal" | "mrr" | "status">("renewal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [actionOpen, setActionOpen] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionTarget, setActionTarget] = useState<{
    subscription: OrgSubscription;
    status: OrgSubscription["status"];
  } | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ProrationPreview | null>(null);
  const [previewPlanId, setPreviewPlanId] = useState("");
  const [previewEffectiveDate, setPreviewEffectiveDate] = useState(todayString());
  const [previewSubscription, setPreviewSubscription] = useState<OrgSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgsResult = await fetchOrganizations();
        if (!cancelled) setOrganizations(orgsResult);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load organizations", description: e?.message, variant: "destructive" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const trimmedSearch = search.trim().toLowerCase();
        const orgIds =
          trimmedSearch.length === 0
            ? undefined
            : organizations
                .filter((org) => org.name.toLowerCase().includes(trimmedSearch))
                .map((org) => org.id);

        if (trimmedSearch.length > 0 && orgIds && orgIds.length === 0) {
          if (!cancelled) {
            setSubscriptions([]);
            setTotal(0);
            setLoading(false);
          }
          return;
        }

        const subsResult = await fetchSubscriptions({
          page,
          pageSize,
          status: statusFilter,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          orgIds,
          sortBy,
          sortDir,
        });
        if (cancelled) return;
        setSubscriptions(subsResult.subscriptions);
        setPlans(subsResult.plans);
        setTotal(subsResult.total);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load subscriptions", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, statusFilter, dateFrom, dateTo, search, organizations, reloadKey, sortBy, sortDir]);

  const orgNameById = useMemo(() => {
    const map = new Map<string, string>();
    organizations.forEach((org) => map.set(org.id, org.name));
    return map;
  }, [organizations]);

  const planById = useMemo(() => {
    const map = new Map<string, Plan>();
    plans.forEach((plan) => map.set(plan.id, plan));
    return map;
  }, [plans]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openPreview = (subscription: OrgSubscription) => {
    setPreviewSubscription(subscription);
    setPreviewPlanId(subscription.plan_id);
    setPreviewEffectiveDate(todayString());
    setPreviewData(null);
    setPreviewOpen(true);
  };

  const runPreview = async () => {
    if (!previewSubscription || !previewPlanId) return;
    try {
      setPreviewLoading(true);
      const data = await previewProration({
        orgId: previewSubscription.org_id,
        newPlanId: previewPlanId,
        effectiveDate: previewEffectiveDate,
      });
      setPreviewData(data);
    } catch (e: any) {
      toast({ title: "Proration preview failed", description: e?.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openAction = (subscription: OrgSubscription, status: OrgSubscription["status"]) => {
    setActionTarget({ subscription, status });
    setActionReason("");
    setActionOpen(true);
  };

  const applyStatus = async () => {
    if (!actionTarget) return;
    try {
      await updateOrgSubscriptionStatus({
        subscriptionId: actionTarget.subscription.id,
        status: actionTarget.status,
      });
      toast({ title: "Subscription updated" });
      setReloadKey((prev) => prev + 1);
      setActionOpen(false);
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Subscriptions</div>
          <div className="text-sm text-slate-500">Manage subscription lifecycle and proration previews.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search orgs..."
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={sortBy}
            onChange={(event) => {
              setPage(1);
              setSortBy(event.target.value as typeof sortBy);
            }}
          >
            <option value="renewal">Sort by renewal</option>
            <option value="mrr">Sort by MRR</option>
            <option value="status">Sort by status</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={sortDir}
            onChange={(event) => {
              setPage(1);
              setSortDir(event.target.value as typeof sortDir);
            }}
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.target.value);
            }}
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as typeof statusFilter);
            }}
          >
            <option value="all">All statuses</option>
            <option value="trialing">Trialing</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="paused">Paused</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
      </div>

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
                <TableHead>Plan</TableHead>
                <TableHead>Entitlements</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Trial end</TableHead>
                <TableHead>Period start</TableHead>
                <TableHead>Renewal</TableHead>
                <TableHead>MRR</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => {
                const plan = sub.plan || planById.get(sub.plan_id);
                const entitlements = plan?.entitlements_json || {};
                const entitlementKeys = Object.keys(entitlements).filter((key) => Boolean(entitlements[key]));
                const shownEntitlements = entitlementKeys.slice(0, 3);
                return (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium text-slate-900">
                      <Link className="hover:underline" to={`/admin/organizations/${sub.org_id}`}>
                        {orgNameById.get(sub.org_id) || sub.org_id}
                      </Link>
                    </TableCell>
                    <TableCell>{plan?.name || "--"}</TableCell>
                    <TableCell>
                      {shownEntitlements.length ? (
                        <div className="flex flex-wrap gap-1">
                          {shownEntitlements.map((key) => (
                            <span
                              key={key}
                              className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600"
                            >
                              {key}
                            </span>
                          ))}
                          {entitlementKeys.length > shownEntitlements.length && (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                              +{entitlementKeys.length - shownEntitlements.length}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                        {sub.status}
                      </span>
                    </TableCell>
                    <TableCell>{sub.billing_cycle}</TableCell>
                    <TableCell>{sub.trial_end_at || "--"}</TableCell>
                    <TableCell>{sub.current_period_start || "--"}</TableCell>
                    <TableCell>{sub.current_period_end || sub.trial_end_at || "--"}</TableCell>
                    <TableCell>${sub.mrr.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEditBilling}
                          onClick={() => openPreview(sub)}
                        >
                          Proration
                        </Button>
                        {(sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEditBilling}
                            onClick={() => openAction(sub, "paused")}
                          >
                            Pause
                          </Button>
                        )}
                        {(sub.status === "paused" || sub.status === "canceled") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEditBilling}
                            onClick={() => openAction(sub, "active")}
                          >
                            Reactivate
                          </Button>
                        )}
                        {sub.status !== "canceled" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!canEditBilling}
                            onClick={() => openAction(sub, "canceled")}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <div>
          Page {page} of {totalPages} | {total} total
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proration preview</DialogTitle>
            <DialogDescription>Estimate credits and charges before changing plans.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-xs uppercase text-slate-500">New plan</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={previewPlanId}
                onChange={(event) => setPreviewPlanId(event.target.value)}
              >
                <option value="">Select plan</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} (${plan.price_monthly}/mo)
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase text-slate-500">Effective date</div>
              <Input
                type="date"
                value={previewEffectiveDate}
                onChange={(event) => setPreviewEffectiveDate(event.target.value)}
              />
            </div>

            {previewData ? (
              <Card className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Current plan</span>
                  <span className="font-semibold text-slate-900">{previewData.current_plan}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>New plan</span>
                  <span className="font-semibold text-slate-900">{previewData.new_plan}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Period</span>
                  <span className="font-semibold text-slate-900">
                    {previewData.period_start} - {previewData.period_end}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Credit</span>
                  <span className="font-semibold text-emerald-700">${previewData.credit.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Charge</span>
                  <span className="font-semibold text-rose-700">${previewData.charge.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total due</span>
                  <span className="font-semibold text-slate-900">${previewData.total_due.toLocaleString()}</span>
                </div>
              </Card>
            ) : (
              <div className="rounded-xl border border-dashed p-3 text-xs text-slate-500">
                Run preview to see estimated proration.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button onClick={runPreview} disabled={previewLoading || !previewPlanId}>
              {previewLoading ? "Calculating..." : "Run preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>
              {actionTarget
                ? `You're about to set this subscription to "${actionTarget.status}".`
                : "Confirm subscription update."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs uppercase text-slate-500">Reason</div>
            <Textarea
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder="Add a short reason for this change."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={applyStatus}
              disabled={!actionReason.trim() || !canEditBilling}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
