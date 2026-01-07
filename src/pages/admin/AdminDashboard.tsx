import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDashboardData, searchUsersAndClients } from "@/services/adminService";
import { AppUser, Client, DashboardMetrics, DashboardTrends } from "@/types/admin";
import { ArrowUpRight } from "lucide-react";

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="flex h-full flex-col justify-between rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-slate-900">{value}</div>
      {accent ? <div className="mt-1 text-xs text-emerald-600">{accent}</div> : null}
    </Card>
  );
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2">
      {data.map((item) => (
        <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
          <div
            className="w-full rounded-md bg-slate-900/80"
            style={{ height: `${Math.max(12, (item.value / max) * 120)}px` }}
          />
          <div className="text-[10px] text-slate-500">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<AppUser[]>([]);
  const [overdueClients, setOverdueClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchUsers, setSearchUsers] = useState<AppUser[]>([]);
  const [searchClients, setSearchClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const dashboard = await fetchDashboardData();
        if (cancelled) return;
        setMetrics(dashboard.metrics);
        setTrends(dashboard.trends);
        setPendingApprovals(dashboard.pendingApprovals);
        setOverdueClients(dashboard.overdueClients);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!searchTerm.trim()) {
      setSearchUsers([]);
      setSearchClients([]);
      return;
    }
    (async () => {
      const result = await searchUsersAndClients(searchTerm.trim());
      if (cancelled) return;
      setSearchUsers(result.users);
      setSearchClients(result.clients);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchTerm]);

  const kpis = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: "Total users", value: metrics.totalUsers.toLocaleString() },
      { label: "Active users", value: metrics.activeUsers.toLocaleString() },
      { label: "Pending approvals", value: metrics.pendingApprovals.toLocaleString() },
      { label: "Paying customers", value: metrics.payingCustomers.toLocaleString() },
      { label: "Overdue invoices", value: metrics.overdueInvoices.toLocaleString() },
      { label: "Total MRR", value: `$${metrics.totalMRR.toLocaleString()}` },
    ];
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Admin dashboard</div>
          <div className="text-sm text-slate-500">Monitor approvals, billing, and team activity.</div>
        </div>
        <div className="flex w-full max-w-md items-center gap-2">
          <Input
            placeholder="Search users or clients..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <Button variant="outline" size="sm">
            Search
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">New users per week</div>
              <div className="text-xs text-slate-500">Last 10 weeks</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-4">{trends ? <BarChart data={trends.newUsers} /> : null}</div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Paid vs unpaid</div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Paid</span>
              <span>{trends?.paidVsUnpaid.paid ?? 0}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-emerald-500"
                style={{
                  width: trends
                    ? `${(trends.paidVsUnpaid.paid /
                        Math.max(1, trends.paidVsUnpaid.paid + trends.paidVsUnpaid.unpaid)) *
                        100}%`
                    : "0%",
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Unpaid</span>
              <span>{trends?.paidVsUnpaid.unpaid ?? 0}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-rose-500"
                style={{
                  width: trends
                    ? `${(trends.paidVsUnpaid.unpaid /
                        Math.max(1, trends.paidVsUnpaid.paid + trends.paidVsUnpaid.unpaid)) *
                        100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Overdue aging</div>
          <div className="mt-4 space-y-2">
            {trends?.overdueBuckets.map((bucket) => (
              <div key={bucket.label} className="flex items-center justify-between text-xs text-slate-500">
                <span>{bucket.label} days</span>
                <span className="font-semibold text-slate-900">{bucket.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
          <div className="text-sm font-semibold text-slate-900">Action needed</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Pending approvals</div>
              <div className="mt-2 space-y-2">
                {pendingApprovals.length ? (
                  pendingApprovals.map((user) => (
                    <div key={user.user_id} className="flex items-center justify-between rounded-lg border p-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {user.full_name ?? "Unnamed"}
                        </div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                        Pending
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-500">No pending approvals.</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Overdue reminders</div>
              <div className="mt-2 space-y-2">
                {overdueClients.length ? (
                  overdueClients.map((client) => (
                    <div key={client.id} className="flex items-center justify-between rounded-lg border p-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{client.name}</div>
                        <div className="text-xs text-slate-500">{client.billing_email}</div>
                      </div>
                      <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-semibold text-rose-700">
                        Overdue
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-500">No overdue reminders.</div>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {searchTerm.trim() ? (
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Search results</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Users</div>
              <div className="mt-2 space-y-2">
                {searchUsers.length ? (
                  searchUsers.map((user) => (
                    <div key={user.user_id} className="rounded-lg border p-2 text-sm text-slate-700">
                      <div className="font-medium text-slate-900">{user.full_name ?? "Unnamed"}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-500">No matching users.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Clients</div>
              <div className="mt-2 space-y-2">
                {searchClients.length ? (
                  searchClients.map((client) => (
                    <div key={client.id} className="rounded-lg border p-2 text-sm text-slate-700">
                      <div className="font-medium text-slate-900">{client.name}</div>
                      <div className="text-xs text-slate-500">{client.billing_email}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-500">No matching clients.</div>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
