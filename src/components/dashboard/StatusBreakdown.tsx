import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/types/project";

type StatsShape = Partial<{
  // current funnel
  active: number;
  bidding: number;
  won: number;
  lost: number;

  // legacy
  templates: number;
  estimating: number;
  preliminaries: number;
  accepted: number;
}>;

export function StatusBreakdown({ stats }: { stats: StatsShape }) {
  // Prefer current funnel fields if available; fall back to legacy fields.
  const active = typeof stats.active === "number" ? stats.active : (stats.templates ?? 0);
  const bidding =
    typeof stats.bidding === "number"
      ? stats.bidding
      : (stats.estimating ?? 0) + (stats.preliminaries ?? 0);
  const won = typeof stats.won === "number" ? stats.won : (stats.accepted ?? 0);
  const lost = typeof stats.lost === "number" ? stats.lost : 0;

  const statuses = [
    { key: "active", count: active, badge: "outline" as const },
    { key: "bidding", count: bidding, badge: "outline" as const },
    { key: "won", count: won, badge: "outline" as const },
    { key: "lost", count: lost, badge: "outline" as const },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium">Projects by status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {statuses.map((s) => (
          <div key={s.key} className="flex items-center justify-between">
            <Badge variant={s.badge}>{STATUS_LABELS[s.key as any] ?? s.key}</Badge>
            <div className="text-sm font-medium">{s.count}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
