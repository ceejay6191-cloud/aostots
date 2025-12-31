import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects, useUpdateProjectStatus } from "@/hooks/useProjects";
import { STATUS_LABELS, STATUS_COLORS, type ProjectStatus, type Project } from "@/types/project";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Trash2, ArrowUpRight } from "lucide-react";

interface ProjectsTableProps {
  statusFilter?: ProjectStatus;
  query?: string;
}

function matchesQuery(p: Project, q: string) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return (
    p.name.toLowerCase().includes(t) ||
    (p.client_name ?? "").toLowerCase().includes(t)
  );
}

export function ProjectsTable({ statusFilter, query }: ProjectsTableProps) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { data: projects = [], isLoading } = useProjects();
  const updateStatus = useUpdateProjectStatus();

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query ?? sp.get("q") ?? "";
    return projects
      .filter((p) => (statusFilter ? p.status === statusFilter : true))
      .filter((p) => matchesQuery(p, q));
  }, [projects, statusFilter, query, sp]);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected]
  );

  useEffect(() => {
    // Clear selection when filters change (prevents accidental bulk actions)
    setSelected({});
  }, [statusFilter, query, sp]);

  function toggleAll() {
    if (!filtered.length) return;
    const allSelected = filtered.every((p) => selected[p.id]);
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const p of filtered) next[p.id] = true;
      setSelected(next);
    }
  }

  async function bulkSetStatus(next: ProjectStatus) {
    const ids = selectedIds;
    if (!ids.length) return;
    const ok = window.confirm(`Set status to "${STATUS_LABELS[next]}" for ${ids.length} project(s)?`);
    if (!ok) return;

    // Sequential to keep it simple and reliable (can optimize later)
    for (const id of ids) {
      await updateStatus.mutateAsync({ id, status: next });
    }
    setSelected({});
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border">
        <div className="p-4">
          <Skeleton className="h-8 w-1/3" />
        </div>
        <div className="p-4 pt-0 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!filtered.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No projects found.
      </div>
    );
  }

  const allSelected = filtered.length > 0 && filtered.every((p) => selected[p.id]);

  return (
    <div className="space-y-3">
      {/* Bulk actions bar */}
      {selectedIds.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> selected
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("active")}>
              Set Active
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("bidding")}>
              Set Bidding
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("won")}>
              Set Won
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkSetStatus("lost")}>
              Set Lost
            </Button>

            {/* Placeholder for delete bulk - wire to Supabase later if desired */}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                window.alert("Bulk delete is not enabled yet. If you want it, I will wire it to Supabase with a confirmation step.");
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => toggleAll()}
                  aria-label={allSelected ? "Clear selection" : "Select all"}
                />
              </TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead className="text-right w-[64px]">...</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtered.map((project) => (
              <TableRow key={project.id} className={cn(selected[project.id] ? "bg-muted/30" : "")}>
                <TableCell>
                  <Checkbox
                    checked={!!selected[project.id]}
                    onCheckedChange={(v) =>
                      setSelected((prev) => ({ ...prev, [project.id]: Boolean(v) }))
                    }
                    aria-label={`Select ${project.name}`}
                  />
                </TableCell>

                <TableCell className="font-medium">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    {project.name}
                  </button>
                </TableCell>

                <TableCell className="text-muted-foreground">{project.client_name || "-"}</TableCell>

                <TableCell>
                  <Badge variant={STATUS_COLORS[project.status] as any}>
                    {STATUS_LABELS[project.status]}
                  </Badge>
                </TableCell>

                <TableCell className="text-right font-medium">
                  ${Number(project.total_sales || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </TableCell>

                <TableCell className="text-right text-muted-foreground">
                  {project.created_at ? format(new Date(project.created_at), "MMM d, yyyy") : "-"}
                </TableCell>

                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/50"
                        aria-label="Row actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}`)}>
                        <ArrowUpRight className="mr-2 h-4 w-4" />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Move to</DropdownMenuLabel>
                      {(
                        [
                          ["active", "Active"],
                          ["bidding", "Bidding"],
                          ["won", "Won"],
                          ["lost", "Lost"],
                        ] as const
                      ).map(([s, label]) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => updateStatus.mutate({ id: project.id, status: s })}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => {
                          window.alert(
                            "Delete is not enabled yet. If you want it, I will wire it to Supabase with a confirmation step."
                          );
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
