import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

type Unit = "ls" | "ea" | "m" | "m2" | "m3";

type EstimateRow = {
  id: string;
  code: string;
  description: string;
  unit: Unit;
  qty: number;
  rate: number;
};

function safeId() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(n: number) {
  if (!isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function stableHash(obj: unknown) {
  // lightweight deterministic hash via JSON + DJB2
  const json = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = (h * 33) ^ json.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function logProjectActivity(params: {
  projectId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, any> | null;
}) {
  const { projectId, action, entityType, entityId, meta } = params;

  const { data: auth } = await supabase.auth.getUser();
  const actorId = auth?.user?.id ?? null;
  const actorEmail = auth?.user?.email ?? null;

  const { error } = await supabase.from("project_activity").insert({
    project_id: projectId,
    actor_id: actorId,
    actor_email: actorEmail,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    meta: meta ?? null,
  });

  if (error) {
    // non-fatal
    // console.warn("activity insert failed", error);
  }
}

async function createEstimateVersion(params: {
  projectId: string;
  payload: any;
  total: number;
  note?: string | null;
}) {
  const { projectId, payload, total, note } = params;
  const payloadHash = stableHash(payload);

  // prevent duplicate consecutive versions (same hash)
  const { data: last } = await supabase
    .from("estimate_versions")
    .select("payload_hash")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.payload_hash === payloadHash) return { skipped: true };

  const { data, error } = await supabase.from("estimate_versions").insert({
    project_id: projectId,
    payload,
    payload_hash: payloadHash,
    total,
    note: note ?? null,
  }).select("id").single();

  if (error) throw error;
  return { skipped: false, id: data?.id as string };
}

/**
 * Embedded-friendly estimating workspace.
 * ProjectDetails imports this as:
 *   import { EstimatingWorkspaceContent } from "@/pages/EstimatingWorkspace";
 */
export function EstimatingWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const [rows, setRows] = useState<EstimateRow[]>([
    {
      id: safeId(),
      code: "01",
      description: "Preliminaries / Mobilization",
      unit: "ls",
      qty: 1,
      rate: 9000,
    },
    {
      id: safeId(),
      code: "02",
      description: "Qleave",
      unit: "ea",
      qty: 10,
      rate: 875000,
    },
  ]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  const subtotal = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0),
    [rows]
  );
  const total = subtotal;

  // ---- Debounced autosave to projects.total_sales + lightweight activity
  const autosaveTimer = useRef<number | null>(null);
  const lastSavedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!projectId) return;

    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(async () => {
      try {
        // avoid useless writes
        const t = Math.round(total * 100) / 100;
        if (lastSavedRef.current === t) return;

        const { error } = await supabase
          .from("projects")
          .update({ total_sales: t })
          .eq("id", projectId);

        if (error) throw error;
        lastSavedRef.current = t;
      } catch (e: any) {
        toast({
          title: "Autosave failed",
          description: e?.message ?? "Could not update total sales",
          variant: "destructive",
        });
      }
    }, 650);

    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [projectId, total]);

  function updateRow(id: string, patch: Partial<EstimateRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addLine() {
    setRows((prev) => [
      ...prev,
      {
        id: safeId(),
        code: String(prev.length + 1).padStart(2, "0"),
        description: "",
        unit: "ea",
        qty: 1,
        rate: 0,
      },
    ]);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    setRows((prev) => prev.filter((r) => !selectedIds.includes(r.id)));
    setSelected({});
  }

  async function saveVersion() {
    try {
      const payload = { rows };
      const res = await createEstimateVersion({ projectId, payload, total, note: null });

      await logProjectActivity({
        projectId,
        action: res.skipped ? "estimate_version_skipped" : "estimate_version_saved",
        entityType: "estimate",
        entityId: res.skipped ? null : res.id,
        meta: { total },
      });

      toast({
        title: res.skipped ? "No changes to save" : "Version saved",
        description: res.skipped ? "Current estimate matches last saved version." : "Audit trail updated.",
      });
    } catch (e: any) {
      toast({
        title: "Save version failed",
        description: e?.message ?? "Could not save estimate version",
        variant: "destructive",
      });
    }
  }

  return (
    <div className={embedded ? "h-full w-full" : "p-4"}>
      <Card className={embedded ? "h-full w-full overflow-hidden" : "p-4"}>
        <div className={embedded ? "p-4" : ""}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Estimating</div>
              <div className="text-sm text-muted-foreground">
                Spreadsheet-like estimate. Totals are calculated live.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-full border px-3 py-1 text-sm">
                Subtotal: <span className="font-medium">{money(subtotal)}</span>
              </div>
              <div className="rounded-full border px-3 py-1 text-sm">
                Total: <span className="font-medium">{money(total)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={addLine}>
              Add line
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSelected} disabled={!selectedIds.length}>
              Delete
            </Button>
            <Button size="sm" variant="outline" onClick={saveVersion}>
              Save version
            </Button>
          </div>

          <div className="mt-4 overflow-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="w-[140px] px-3 py-2 text-xs font-semibold text-muted-foreground">Code</th>
                  <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Description</th>
                  <th className="w-[120px] px-3 py-2 text-xs font-semibold text-muted-foreground">Unit</th>
                  <th className="w-[120px] px-3 py-2 text-xs font-semibold text-muted-foreground">Qty</th>
                  <th className="w-[140px] px-3 py-2 text-xs font-semibold text-muted-foreground">Rate</th>
                  <th className="w-[160px] px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const amount = (Number(r.qty) || 0) * (Number(r.rate) || 0);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!selected[r.id]}
                          onChange={(e) => setSelected((p) => ({ ...p, [r.id]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input value={r.code} onChange={(e) => updateRow(r.id, { code: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={r.description}
                          onChange={(e) => updateRow(r.id, { description: e.target.value })}
                          placeholder="Description"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={r.unit}
                          onChange={(e) => updateRow(r.id, { unit: e.target.value as Unit })}
                        >
                          <option value="ls">ls</option>
                          <option value="ea">ea</option>
                          <option value="m">m</option>
                          <option value="m2">m²</option>
                          <option value="m3">m³</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={r.qty}
                          onChange={(e) => updateRow(r.id, { qty: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={r.rate}
                          onChange={(e) => updateRow(r.id, { rate: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{money(amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Audit trail: versions are recorded in Supabase when you click <span className="font-medium">Save version</span>.
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Route wrapper (optional).
 * Keeps backward compatibility if you have /projects/:projectId/estimating as a standalone route.
 */
export default function EstimatingWorkspace() {
  const { projectId } = useParams();

  if (!projectId) {
    return (
      <div className="p-6">
        <Card className="p-6">Missing projectId</Card>
      </div>
    );
  }

  return <EstimatingWorkspaceContent projectId={projectId} />;
}
