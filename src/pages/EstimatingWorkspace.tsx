import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

type EstLine = {
  id: string;
  code: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
};

export type EstimatingStats = {
  nonemptyLines: number;
  targetLines: number;
  total: number;
};

function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function clampPct(v: number) {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function readLines(projectId: string): EstLine[] {
  try {
    const raw = localStorage.getItem(`aostot:estimating:lines:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}
function writeLines(projectId: string, lines: EstLine[]) {
  try {
    localStorage.setItem(`aostot:estimating:lines:${projectId}`, JSON.stringify(lines));
  } catch {
    // ignore
  }
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function EstimatingWorkspaceContent({
  projectId,
  embedded,
  onStats,
  targetLines = 10,
}: {
  projectId: string;
  embedded?: boolean;
  onStats?: (s: EstimatingStats) => void;
  targetLines?: number; // used for estimating_pct calculation
}) {
  const qc = useQueryClient();

  const [lines, setLines] = useState<EstLine[]>(() => readLines(projectId));
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  // Keep storage key aligned if project changes
  useEffect(() => {
    setLines(readLines(projectId));
    setSelectedIds({});
  }, [projectId]);

  // Persist to localStorage
  useEffect(() => {
    writeLines(projectId, lines);
  }, [projectId, lines]);

  const subtotal = useMemo(() => {
    return lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  }, [lines]);

  const total = subtotal;

  const nonemptyLines = useMemo(() => {
    return lines.filter((l) => {
      const hasDesc = (l.description || "").trim().length > 0;
      const hasQty = Number(l.qty) > 0;
      const hasRate = Number(l.rate) > 0;
      return hasDesc || hasQty || hasRate;
    }).length;
  }, [lines]);

  // Emit stats upward for progress bars
  useEffect(() => {
    onStats?.({ nonemptyLines, targetLines, total });
  }, [nonemptyLines, targetLines, total, onStats]);

  // Debounced save total_sales to projects (ONLY column we touch)
  const saveTimer = useRef<number | null>(null);
  const lastSavedTotal = useRef<number | null>(null);

  useEffect(() => {
    if (!projectId) return;

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        if (lastSavedTotal.current === total) return;
        lastSavedTotal.current = total;

        const { error } = await supabase
          .from("projects")
          .update({ total_sales: total })
          .eq("id", projectId);

        if (error) throw error;

        await qc.invalidateQueries({ queryKey: ["project", projectId] });
        await qc.invalidateQueries({ queryKey: ["projects"] });
      } catch (e: any) {
        toast({
          title: "Failed to update total sales",
          description: e?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    }, 650);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, projectId]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: uid(),
        code: String(p.length + 1).padStart(2, "0"),
        description: "",
        unit: "ls",
        qty: 1,
        rate: 0,
      },
    ]);
  }

  function deleteSelected() {
    const ids = new Set(Object.keys(selectedIds).filter((k) => selectedIds[k]));
    if (ids.size === 0) return;
    setLines((p) => p.filter((l) => !ids.has(l.id)));
    setSelectedIds({});
  }

  function importFromTakeoff() {
    toast({
      title: "Import from Takeoff",
      description: "Next step: map takeoff items to estimate lines (we can do this after takeoff persistence).",
    });
  }

  const containerClass = embedded ? "h-full" : "";

  const pct = clampPct((nonemptyLines / Math.max(1, targetLines)) * 100);

  return (
    <div className={containerClass}>
      <Card className={embedded ? "h-full border-0 shadow-none" : "p-4"}>
        <div className={embedded ? "p-4" : ""}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">Estimating</div>
              <div className="text-sm text-muted-foreground">
                Spreadsheet-like estimate. Totals are calculated live.{" "}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                  BOQ completion: {pct}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums">
                Subtotal: ${money(subtotal)}
              </div>
              <div className="rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums font-semibold">
                Total: ${money(total)}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={addLine}>Add line</Button>
            <Button variant="outline" onClick={deleteSelected}>
              Delete
            </Button>
            <Button variant="outline" onClick={importFromTakeoff}>
              Import from Takeoff
            </Button>
          </div>

          <div className="mt-4 overflow-auto rounded-xl border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-[44px] px-3 py-3 text-xs font-semibold text-muted-foreground"></th>
                  <th className="w-[120px] px-3 py-3 text-xs font-semibold text-muted-foreground">Code</th>
                  <th className="min-w-[420px] px-3 py-3 text-xs font-semibold text-muted-foreground">Description</th>
                  <th className="w-[120px] px-3 py-3 text-xs font-semibold text-muted-foreground">Unit</th>
                  <th className="w-[120px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Qty</th>
                  <th className="w-[140px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Rate</th>
                  <th className="w-[160px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={7}>
                      No estimate lines yet.
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => {
                    const amount = (Number(l.qty) || 0) * (Number(l.rate) || 0);
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!selectedIds[l.id]}
                            onChange={(e) => setSelectedIds((p) => ({ ...p, [l.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={l.code}
                            onChange={(e) => setLines((p) => p.map((x) => (x.id === l.id ? { ...x, code: e.target.value } : x)))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={l.description}
                            onChange={(e) =>
                              setLines((p) => p.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={l.unit}
                            onChange={(e) => setLines((p) => p.map((x) => (x.id === l.id ? { ...x, unit: e.target.value } : x)))}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            value={l.qty}
                            onChange={(e) =>
                              setLines((p) =>
                                p.map((x) => (x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            value={l.rate}
                            onChange={(e) =>
                              setLines((p) =>
                                p.map((x) => (x.id === l.id ? { ...x, rate: Number(e.target.value) } : x))
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          ${money(amount)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Next: assemblies, cost database, drag-fill, multi-select, and Supabase persistence (versions/audit trail) once schema is ready.
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function EstimatingWorkspace() {
  // Standalone page use (if you route directly here)
  // You likely wrap this via ProjectDetails; keep this for safety.
  return (
    <div className="p-4">
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Open this workspace via a project to load projectId.</div>
      </Card>
    </div>
  );
}
