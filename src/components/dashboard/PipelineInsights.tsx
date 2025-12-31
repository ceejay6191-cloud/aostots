import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types/project";
import { normalizePipelineStatus } from "@/types/project";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowRight } from "lucide-react";

function daysBetween(aIso: string, bIso: string) {
  try {
    const a = parseISO(aIso);
    const b = parseISO(bIso);
    return Math.max(0, differenceInCalendarDays(b, a));
  } catch {
    return 0;
  }
}

export function PipelineInsights({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();

  const metrics = useMemo(() => {
    const by = { active: 0, bidding: 0, won: 0, lost: 0 };

    let decidedWon = 0;
    let decidedLost = 0;

    let bidDurationSum = 0;
    let bidDurationN = 0;

    for (const p of projects) {
      const s = normalizePipelineStatus(p.status);
      by[s]++;

      if (s === "won" || s === "lost") {
        // Best available without a dedicated status-changed timestamp:
        // created_at -> updated_at (updated_at changes when the record is edited).
        bidDurationSum += daysBetween(p.created_at, p.updated_at || p.created_at);
        bidDurationN++;
        if (s === "won") decidedWon++;
        else decidedLost++;
      }
    }

    const decidedTotal = decidedWon + decidedLost;
    const winRate = decidedTotal > 0 ? (decidedWon / decidedTotal) * 100 : 0;

    // Funnel conversion rates (simple)
    const activeToBidding = by.active > 0 ? (by.bidding / by.active) * 100 : 0;
    const biddingToWon = by.bidding > 0 ? (by.won / by.bidding) * 100 : 0;

    const avgBidDays = bidDurationN > 0 ? bidDurationSum / bidDurationN : 0;

    return {
      by,
      winRate,
      avgBidDays,
      activeToBidding,
      biddingToWon,
    };
  }, [projects]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Pipeline insights</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Win-rate and cycle-time are computed from project history (uses created_at → updated_at until we add a dedicated status timeline).
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/projects?status=bidding")}>
          Review pipeline <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Win-rate</div>
          <div className="mt-1 text-2xl font-semibold">{Math.round(metrics.winRate)}%</div>
          <div className="mt-1 text-xs text-muted-foreground">Won / (Won + Lost)</div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Average bid duration</div>
          <div className="mt-1 text-2xl font-semibold">{metrics.avgBidDays.toFixed(1)}d</div>
          <div className="mt-1 text-xs text-muted-foreground">Created → Updated (Won/Lost)</div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Conversion funnel</div>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Active → Bidding</span>
              <span className="font-medium">{Math.round(metrics.activeToBidding)}%</span>
            </div>
            <div className="h-2 w-full rounded bg-muted">
              <div
                className="h-2 rounded bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, metrics.activeToBidding))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span>Bidding → Won</span>
              <span className="font-medium">{Math.round(metrics.biddingToWon)}%</span>
            </div>
            <div className="h-2 w-full rounded bg-muted">
              <div
                className="h-2 rounded bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, metrics.biddingToWon))}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
