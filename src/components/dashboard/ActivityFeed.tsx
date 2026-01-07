import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useProjects } from "@/hooks/useProjects";

const db = supabase as any;

type ActivityRow = {
  id: string;
  project_id: string;
  action: string;
  entity_type: string | null;
  meta: any;
  created_at: string;
  actor_id: string;
};

function formatAction(row: ActivityRow) {
  switch (row.action) {
    case "takeoff_updated":
      return "Updated takeoff";
    case "estimating_takeoff_rename":
      return "Renamed takeoff item";
    default:
      return row.action.replace(/_/g, " ");
  }
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  if (!isFinite(d)) return "";
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

export function ActivityFeed() {
  const { data: projects = [] } = useProjects();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await db
          .from("project_activity")
          .select("id,project_id,action,entity_type,meta,created_at,actor_id")
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) throw error;
        if (!cancelled) setRows((data ?? []) as ActivityRow[]);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Activity</div>
        <div className="text-xs text-muted-foreground">Takeoff &amp; Estimating</div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.map((row) => {
            const meta = row.meta ?? {};
            const actor = meta.actorName ?? "Team member";
            const projectName = projectNameById.get(row.project_id) ?? "Project";
            const detail =
              row.action === "takeoff_updated"
                ? meta.documentName || "Takeoff"
                : meta.name || row.entity_type || "Update";
            return (
              <div key={row.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{formatAction(row)}</div>
                  <div className="text-xs text-muted-foreground">
                    {actor} · {projectName} · {detail}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{timeAgo(row.created_at)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 text-sm text-muted-foreground">No recent activity yet.</div>
      )}
    </Card>
  );
}
