import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDashboardData } from "@/services/adminService";
import { DashboardMetrics, DashboardTrends } from "@/types/admin";

export default function AdminAnalytics() {
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchDashboardData();
        if (!cancelled) {
          setTrends(data.trends);
          setMetrics(data.metrics);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const exportCsv = () => {
    if (!trends || !metrics) return;
    const rows = [
      ["Metric", "Value"],
      ["Paid customers", String(trends.paidVsUnpaid.paid)],
      ["Unpaid customers", String(trends.paidVsUnpaid.unpaid)],
      ["Active subscriptions", String(metrics.activeSubscriptions)],
      ["Trials active", String(metrics.trialsActive)],
      ["Trials expiring (7d)", String(metrics.trialsExpiringSoon)],
      ["Failed payments", String(metrics.failedPayments)],
      ["Delinquent accounts", String(metrics.delinquentAccounts)],
      ...trends.overdueBuckets.map((bucket) => [
        `Overdue ${bucket.label} days`,
        String(bucket.value),
      ]),
    ];
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aostots-analytics.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Analytics</div>
          <div className="text-sm text-slate-500">Subscription health and revenue risk signals.</div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!trends || !metrics}>
          Export CSV
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Paid vs unpaid</div>
            <div className="mt-3 text-sm text-slate-500">
              Paid: {trends?.paidVsUnpaid.paid ?? 0} | Unpaid: {trends?.paidVsUnpaid.unpaid ?? 0}
            </div>
            <div className="mt-4 h-2 rounded-full bg-slate-100">
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
          </Card>
          <Card className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Overdue aging buckets</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              {trends?.overdueBuckets.map((bucket) => (
                <div key={bucket.label} className="flex items-center justify-between">
                  <span>{bucket.label} days</span>
                  <span className="font-semibold text-slate-900">{bucket.value}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Subscription health</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Active subscriptions</span>
                <span className="font-semibold text-slate-900">{metrics?.activeSubscriptions ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Trials active</span>
                <span className="font-semibold text-slate-900">{metrics?.trialsActive ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Trials expiring (7d)</span>
                <span className="font-semibold text-slate-900">{metrics?.trialsExpiringSoon ?? 0}</span>
              </div>
            </div>
          </Card>
          <Card className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Revenue risk</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Failed payments</span>
                <span className="font-semibold text-slate-900">{metrics?.failedPayments ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Delinquent accounts</span>
                <span className="font-semibold text-slate-900">{metrics?.delinquentAccounts ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total MRR</span>
                <span className="font-semibold text-slate-900">
                  ${metrics?.totalMRR.toLocaleString() ?? "0"}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
