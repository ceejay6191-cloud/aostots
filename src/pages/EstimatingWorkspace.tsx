import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

type EstimateSheetRow = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type EstimateRow = {
  id: string;
  sheet_id: string;
  owner_id: string;
  row_index: number;
  code: string | null;
  description: string;
  uom: string;
  qty_source: "manual" | "takeoff";
  qty_manual: number | null;
  unit_cost: number;
  markup_pct: number;
  meta: any;
  created_at: string;
  updated_at: string;
};

type TakeoffItem = {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  kind: string;
  layer_id: string | null;
  quantity: number | null;
  uom: string | null;
};

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error("Not signed in");
  return uid;
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function EstimatingWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: sheet } = useQuery({
    queryKey: ["estimate-sheet", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estimate_sheets")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EstimateSheetRow | null;
    },
  });

  // Create default sheet if missing
  useEffect(() => {
    (async () => {
      if (!projectId) return;
      if (sheet) return;

      try {
        const uid = await requireUserId();
        const { error } = await supabase.from("estimate_sheets").insert({
          project_id: projectId,
          owner_id: uid,
          name: "Estimate",
        });
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: ["estimate-sheet", projectId] });
      } catch (e: any) {
        toast({ title: "Failed to create estimate sheet", description: e?.message, variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sheet?.id]);

  const sheetId = sheet?.id ?? null;

  const { data: rows = [] } = useQuery({
    queryKey: ["estimate-rows", sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estimate_rows")
        .select("*")
        .eq("sheet_id", sheetId)
        .order("row_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EstimateRow[];
    },
  });

  const { data: takeoffItems = [] } = useQuery({
    queryKey: ["takeoff-items-project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("takeoff_items")
        .select("id,project_id,document_id,page_number,kind,layer_id,quantity,uom")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as TakeoffItem[];
    },
  });

  const upsertRow = useMutation({
    mutationFn: async (row: Partial<EstimateRow> & { id: string }) => {
      const { error } = await supabase
        .from("estimate_rows")
        .update({
          code: row.code ?? null,
          description: row.description ?? "",
          uom: row.uom ?? "ea",
          qty_source: row.qty_source ?? "manual",
          qty_manual: row.qty_manual ?? null,
          unit_cost: row.unit_cost ?? 0,
          markup_pct: row.markup_pct ?? 0,
          meta: row.meta ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["estimate-rows", sheetId] });
      await qc.invalidateQueries({ queryKey: ["estimate-sheet", projectId] });
    },
  });

  const addRow = useMutation({
    mutationFn: async () => {
      if (!sheetId) throw new Error("Missing estimate sheet");
      const uid = await requireUserId();
      const nextIndex = (rows?.length ?? 0) + 1;
      const { error } = await supabase.from("estimate_rows").insert({
        sheet_id: sheetId,
        owner_id: uid,
        row_index: nextIndex,
        description: "",
        uom: "ea",
        qty_source: "manual",
        qty_manual: 0,
        unit_cost: 0,
        markup_pct: 0,
        meta: { link: { kind: "count", layer_id: null } },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["estimate-rows", sheetId] });
    },
    onError: (e: any) => {
      toast({ title: "Failed to add row", description: e?.message, variant: "destructive" });
    },
  });

  const deleteRow = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase.from("estimate_rows").delete().eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["estimate-rows", sheetId] });
    },
  });

  const computed = useMemo(() => {
    const byKindLayer = new Map<string, number>();
    for (const it of takeoffItems) {
      const k = `${it.kind}::${it.layer_id ?? ""}`;
      byKindLayer.set(k, (byKindLayer.get(k) ?? 0) + num(it.quantity));
    }

    const out = rows.map((r) => {
      const link = r.meta?.link as { kind?: string; layer_id?: string | null } | undefined;
      const takeoffQty =
        r.qty_source === "takeoff" && link?.kind
          ? byKindLayer.get(`${link.kind}::${link.layer_id ?? ""}`) ?? 0
          : 0;

      const qty = r.qty_source === "takeoff" ? takeoffQty : num(r.qty_manual);
      const unitCost = num(r.unit_cost);
      const markupPct = num(r.markup_pct);
      const subtotal = qty * unitCost;
      const total = subtotal * (1 + markupPct / 100);
      return { row: r, qty, subtotal, total };
    });

    const grandTotal = out.reduce((s, x) => s + x.total, 0);
    return { rows: out, grandTotal };
  }, [rows, takeoffItems]);

  return (
    <div className="w-full h-full">
      <Card className="h-full w-full overflow-hidden">
        <div className="border-b bg-background px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Estimating</div>
            <div className="text-xs text-muted-foreground">
              Spreadsheet v1. Rows can be manual quantity or linked to takeoff totals.
            </div>
          </div>
          {!embedded ? (
            <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>
          ) : null}
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => addRow.mutate()} disabled={!sheetId}>
              Add row
            </Button>
            <div className="ml-auto text-sm font-medium">
              Grand Total: ${computed.grandTotal.toFixed(2)}
            </div>
          </div>

          <div className="overflow-auto rounded-lg border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">#</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Code</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Description</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">UOM</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Qty Source</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Link (kind)</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Qty</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Markup %</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Total</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map(({ row, qty, total }) => {
                  const link = (row.meta?.link ?? { kind: "count", layer_id: null }) as any;
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{row.row_index}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.code ?? ""}
                          onChange={(e) => upsertRow.mutate({ id: row.id, code: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.description ?? ""}
                          onChange={(e) => upsertRow.mutate({ id: row.id, description: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.uom ?? "ea"}
                          onChange={(e) => upsertRow.mutate({ id: row.id, uom: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={row.qty_source}
                          onChange={(e) => upsertRow.mutate({ id: row.id, qty_source: e.target.value as any })}
                        >
                          <option value="manual">Manual</option>
                          <option value="takeoff">Takeoff</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={link.kind ?? "count"}
                          onChange={(e) =>
                            upsertRow.mutate({
                              id: row.id,
                              meta: { ...(row.meta ?? {}), link: { ...(link ?? {}), kind: e.target.value } },
                            })
                          }
                        >
                          <option value="count">count</option>
                          <option value="measure">measure</option>
                          <option value="line">line</option>
                          <option value="area">area</option>
                          <option value="auto_count">auto_count</option>
                          <option value="auto_line">auto_line</option>
                          <option value="auto_area">auto_area</option>
                        </select>
                        {row.qty_source === "manual" ? (
                          <div className="mt-2">
                            <Input
                              type="number"
                              value={row.qty_manual ?? 0}
                              onChange={(e) => upsertRow.mutate({ id: row.id, qty_manual: Number(e.target.value) })}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          value={row.unit_cost ?? 0}
                          onChange={(e) => upsertRow.mutate({ id: row.id, unit_cost: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          value={row.markup_pct ?? 0}
                          onChange={(e) => upsertRow.mutate({ id: row.id, markup_pct: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">${total.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="destructive" onClick={() => deleteRow.mutate(row.id)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!computed.rows.length ? (
                  <tr>
                    <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={11}>
                      No estimate rows yet. Click “Add row”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-muted-foreground">
            Note: This is a spreadsheet v1 (editable grid). Copy/paste, formulas, and multi-column cost breakdown can be added next.
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function EstimatingWorkspace() {
  const { projectId } = useParams();
  if (!projectId) {
    return (
      <AppLayout>
        <Card className="p-6">Missing projectId</Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout fullWidth>
      <div className="h-[calc(100vh-72px)]">
        <EstimatingWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
