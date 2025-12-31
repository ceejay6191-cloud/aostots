import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/hooks/useProjects";
import { STATUS_COLORS, STATUS_LABELS, type ProjectStatus } from "@/types/project";
import { format } from "date-fns";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export function ProjectsCards({
  statusFilter,
  query,
}: {
  statusFilter?: ProjectStatus;
  query?: string;
}) {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();

  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.client_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, statusFilter, query]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  if (!filtered.length) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No projects found.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {filtered.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">{p.name}</div>
              <div className="mt-1 text-sm text-muted-foreground truncate">
                {p.client_name || "No client"}
              </div>
            </div>
            <Badge variant={STATUS_COLORS[p.status] as any}>{STATUS_LABELS[p.status]}</Badge>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="text-muted-foreground">Value</div>
            <div className="text-right font-medium">
              ${Number(p.total_sales || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>

            <div className="text-muted-foreground">Created</div>
            <div className="text-right">
              {p.created_at ? format(new Date(p.created_at), "MMM d, yyyy") : "-"}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => navigate(`/projects/${p.id}`)}>
              Open
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
