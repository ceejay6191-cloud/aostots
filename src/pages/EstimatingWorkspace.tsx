import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

/**
 * Estimating (MVP)
 * - Spreadsheet-like editable table
 * - Persists per project in localStorage
 * - Can import aggregated quantities from Takeoff (if Takeoff persistence exists)
 *
 * NOTE: This is intentionally client-only persistence so you can iterate on UI/UX
 * before wiring Supabase tables for estimates and takeoff_items.
 */

type Unit = "ea" | "m" | "m²" | "ft" | "ft²" | "ls";

type EstimateRow = {
  id: string;
  code: string; // cost code / division
  description: string;
  unit: Unit;
  qty: number;
  rate: number;
  markupPct: number; // 0-100
};

function safeId() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(v: string) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function lsKey(projectId: string) {
  return `aostot:estimate:${projectId}`;
}

type TakeoffAggregate = {
  count: number;
  linePx: number;
  measurePx: number;
  areaPx2: number;
  // If takeoff stored calibrated totals, these may exist:
  lineMeters?: number;
  measureMeters?: number;
  areaM2?: number;
};

function readTakeoffAggregate(projectId: string): TakeoffAggregate | null {
  // This key can be adjusted later to match your Takeoff persistence.
  // We try a few common variants to avoid breaking if you renamed it.
  const keys = [
    `aostot:takeoff:${projectId}`,
    `aostot:takeoffItems:${projectId}`,
    `aostot:takeoff:items:${projectId}`,
    `aostot:takeoff_items:${projectId}`,
  ];

  for (const k of keys) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);

      // Expected shape: { items: TakeoffItem[] } OR TakeoffItem[]
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(items)) continue;

      let count = 0;
      let linePx = 0;
      let measurePx = 0;
      let areaPx2 = 0;

      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        if (it.kind === "count" && it.p) count += 1;
        if ((it.kind === "line" || it.kind === "measure") && it.a && it.b) {
          const dx = it.a.x - it.b.x;
          const dy = it.a.y - it.b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (it.kind === "line") linePx += d;
          if (it.kind === "measure") measurePx += d;
        }
        if (it.kind === "area" && Array.isArray(it.pts) && it.pts.length >= 3) {
          // shoelace
          let sum = 0;
          for (let i = 0; i < it.pts.length; i++) {
            const j = (i + 1) % it.pts.length;
            sum += it.pts[i].x * it.pts[j].y - it.pts[j].x * it.pts[i].y;
          }
          areaPx2 += Math.abs(sum) / 2;
        }
      }

      return { count, linePx, measurePx, areaPx2 };
    } catch {
      // ignore and try next key
    }
  }

  return null;
}

export function EstimatingWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();

  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(lsKey(projectId));
    if (!raw) {
      setRows([
        {
          id: safeId(),
          code: "01",
          description: "Preliminaries / Mobilization",
          unit: "ls",
          qty: 1,
          rate: 0,
          markupPct: 0,
        },
      ]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as EstimateRow[];
      if (Array.isArray(parsed)) setRows(parsed);
    } catch {
      // ignore
    }
  }, [projectId]);

  // Persist
  useEffect(() => {
    localStorage.setItem(lsKey(projectId), JSON.stringify(rows));
  }, [projectId, rows]);

  const totals = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + r.qty * r.rate, 0);
    const total = rows.reduce((s, r) => s + r.qty * r.rate * (1 + r.markupPct / 100), 0);
    return { subtotal, total };
  }, [rows]);

  function addRow(afterId?: string) {
    const next: EstimateRow = {
      id: safeId(),
      code: "",
      description: "",
      unit: "ea",
      qty: 0,
      rate: 0,
      markupPct: 0,
    };

    if (!afterId) {
      setRows((p) => [...p, next]);
      setSelectedId(next.id);
      return;
    }

    setRows((p) => {
      const idx = p.findIndex((x) => x.id === afterId);
      if (idx < 0) return [...p, next];
      const copy = [...p];
      copy.splice(idx + 1, 0, next);
      return copy;
    });
    setSelectedId(next.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setRows((p) => p.filter((r) => r.id !== selectedId));
    setSelectedId(null);
  }

  function importFromTakeoff() {
    const agg = readTakeoffAggregate(projectId);
    if (!agg) {
      toast({
        title: "No takeoff data found",
        description:
          "Takeoff quantities are not persisted yet. Next step is to persist takeoff items per project, then import here.",
      });
      return;
    }

    // Add a small set of starter lines based on the aggregate.
    const nextLines: EstimateRow[] = [];

    if (agg.count > 0) {
      nextLines.push({
        id: safeId(),
        code: "06",
        description: "Counts (imported)",
        unit: "ea",
        qty: agg.count,
        rate: 0,
        markupPct: 0,
      });
    }

    if (agg.areaPx2 > 0) {
      nextLines.push({
        id: safeId(),
        code: "09",
        description: "Areas (imported) – requires scale conversion",
        unit: "m²",
        qty: 0,
        rate: 0,
        markupPct: 0,
      });
    }

    if (agg.measurePx > 0 || agg.linePx > 0) {
      nextLines.push({
        id: safeId(),
        code: "08",
        description: "Lengths (imported) – requires scale conversion",
        unit: "m",
        qty: 0,
        rate: 0,
        markupPct: 0,
      });
    }

    if (!nextLines.length) {
      toast({ title: "Nothing to import", description: "No takeoff items were detected." });
      return;
    }

    setRows((p) => [...p, ...nextLines]);
    toast({ title: "Imported", description: "Added estimate lines from takeoff aggregates." });
  }

  return (
    <div className="h-full w-full">
      <Card className="h-full w-full overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Estimating</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Spreadsheet-like estimate. Totals are calculated live.
              </div>
            </div>

            {!embedded ? (
              <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
                Back
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => addRow(selectedId ?? undefined)}>
              Add line
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSelected} disabled={!selectedId}>
              Delete
            </Button>
            <Button size="sm" variant="outline" onClick={importFromTakeoff}>
              Import from Takeoff
            </Button>

            <div className="ml-auto flex items-center gap-2 text-sm">
              <Badge variant="outline">Subtotal: {money(totals.subtotal)}</Badge>
              <Badge variant="secondary">Total: {money(totals.total)}</Badge>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="h-[calc(100%-96px)] overflow-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[140px_1fr_120px_120px_120px_120px] gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground">
              <div>Code</div>
              <div>Description</div>
              <div className="text-right">Unit</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Rate</div>
              <div className="text-right">Amount</div>
            </div>

            {rows.map((r) => {
              const amount = r.qty * r.rate * (1 + r.markupPct / 100);
              const isSel = r.id === selectedId;

              return (
                <button
                  key={r.id}
                  type="button"
                  className={[
                    "grid w-full grid-cols-[140px_1fr_120px_120px_120px_120px] gap-2 border-b px-4 py-2 text-left hover:bg-muted/20",
                    isSel ? "bg-muted/30" : "bg-background",
                  ].join(" ")}
                  onClick={() => setSelectedId(r.id)}
                >
                  <Input
                    value={r.code}
                    onChange={(e) =>
                      setRows((p) => p.map((x) => (x.id === r.id ? { ...x, code: e.target.value } : x)))
                    }
                    className="h-8"
                  />

                  <Input
                    value={r.description}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === r.id ? { ...x, description: e.target.value } : x))
                      )
                    }
                    className="h-8"
                  />

                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-right"
                    value={r.unit}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === r.id ? { ...x, unit: e.target.value as Unit } : x))
                      )
                    }
                  >
                    <option value="ea">ea</option>
                    <option value="m">m</option>
                    <option value="m²">m²</option>
                    <option value="ft">ft</option>
                    <option value="ft²">ft²</option>
                    <option value="ls">ls</option>
                  </select>

                  <Input
                    inputMode="decimal"
                    value={String(r.qty)}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === r.id ? { ...x, qty: clamp(toNumber(e.target.value), 0, 1e9) } : x))
                      )
                    }
                    className="h-8 text-right"
                  />

                  <Input
                    inputMode="decimal"
                    value={String(r.rate)}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === r.id ? { ...x, rate: clamp(toNumber(e.target.value), 0, 1e9) } : x))
                      )
                    }
                    className="h-8 text-right"
                  />

                  <div className="flex h-8 items-center justify-end text-sm font-medium">
                    {money(amount)}
                  </div>
                </button>
              );
            })}

            <div className="p-4 text-xs text-muted-foreground">
              Next: assemblies, cost database, drag-fill, multi-select, and Supabase persistence.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function EstimatingWorkspace() {
  const { projectId } = useParams();
  if (!projectId) return null;

  return (
    <AppLayout fullWidth>
      <div className="h-[calc(100vh-72px)]">
        <EstimatingWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
