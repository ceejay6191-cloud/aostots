import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types/project";
import { normalizePipelineStatus } from "@/types/project";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { AlertTriangle, ArrowRight } from "lucide-react";

function daysSince(iso: string) {
  try {
    return Math.max(0, differenceInCalendarDays(new Date(), parseISO(iso)));
  } catch {
    return 0;
  }
}

export function AlertsPanel({
  projects,
  staleBidDays = 14,
  followUpDays = 7,
}: {
  projects: Project[];
  staleBidDays?: number;
  followUpDays?: number;
}) {
  const navigate = useNavigate();

  const alerts = useMemo(() => {
    const bidding = projects.filter((p) => normalizePipelineStatus(p.status) === "bidding");

    // Use updated_at as a proxy for last activity; fallback to created_at.
    const staleBids = bidding
      .map((p) => ({
        p,
        age: daysSince(p.updated_at || p.created_at),
      }))
      .filter((x) => x.age >= staleBidDays)
      .sort((a, b) => b.age - a.age)
      .slice(0, 5);

    const overdueFollowUps = bidding
      .map((p) => ({
        p,
        age: daysSince(p.updated_at || p.created_at),
      }))
      .filter((x) => x.age >= followUpDays)
      .sort((a, b) => b.age - a.age)
      .slice(0, 5);

    return { staleBids, overdueFollowUps };
  }, [projects, staleBidDays, followUpDays]);

  const hasAny = alerts.staleBids.length > 0 || alerts.overdueFollowUps.length > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Alerts
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Stale bids and overdue follow-ups (based on time since last project update).
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/projects?status=bidding")}>
          View bidding <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {!hasAny ? (
        <div className="mt-4 text-sm text-muted-foreground">No alerts right now.</div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">Stale bids</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Bidding projects with no updates for {staleBidDays}+ days.
            </div>
            <div className="mt-3 space-y-2">
              {alerts.staleBids.length === 0 ? (
                <div className="text-sm text-muted-foreground">None</div>
              ) : (
                alerts.staleBids.map(({ p, age }) => (
                  <button
                    key={p.id}
                    className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.client_name || "No client"}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs font-medium">{age}d</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">Overdue follow-ups</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Bidding projects needing follow-up after {followUpDays}+ days without updates.
            </div>
            <div className="mt-3 space-y-2">
              {alerts.overdueFollowUps.length === 0 ? (
                <div className="text-sm text-muted-foreground">None</div>
              ) : (
                alerts.overdueFollowUps.map(({ p, age }) => (
                  <button
                    key={p.id}
                    className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.client_name || "No client"}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs font-medium">{age}d</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
