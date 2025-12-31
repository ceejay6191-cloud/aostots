import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

type ProposalTemplateRow = {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  template_json: any;
  created_at: string;
  updated_at: string;
};

type ProposalRow = {
  id: string;
  project_id: string;
  owner_id: string;
  template_id: string | null;
  version: number;
  status: string;
  snapshot: any;
  created_at: string;
  updated_at: string;
};

type EstimateRow = {
  id: string;
  sheet_id: string;
  row_index: number;
  description: string;
  qty_source: string;
  qty_manual: number | null;
  unit_cost: number;
  markup_pct: number;
  meta: any;
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

export function ProposalWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: template } = useQuery({
    queryKey: ["proposal-template", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_templates")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProposalTemplateRow | null;
    },
  });

  useEffect(() => {
    (async () => {
      if (!projectId) return;
      if (template) return;

      try {
        const uid = await requireUserId();
        const { error } = await supabase.from("proposal_templates").insert({
          project_id: projectId,
          owner_id: uid,
          name: "Default Template",
          template_json: {
            title: "Renovation Proposal",
            intro: "Thank you for the opportunity to provide this proposal.",
            scope: "",
            terms: "Payment terms: 50% deposit, 50% upon completion.",
          },
        });
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: ["proposal-template", projectId] });
      } catch (e: any) {
        toast({ title: "Failed to create proposal template", description: e?.message, variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, template?.id]);

  const templateId = template?.id ?? null;

  const { data: proposals = [] } = useQuery({
    queryKey: ["proposals", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .eq("project_id", projectId)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProposalRow[];
    },
  });

  const latestProposal = proposals[0] ?? null;

  const { data: estimateRows = [] } = useQuery({
    queryKey: ["proposal-estimate-rows", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      // Pull estimate rows (v1: first sheet)
      const { data: sheet, error: sErr } = await supabase
        .from("estimate_sheets")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!sheet?.id) return [];
      const { data: rows, error } = await supabase
        .from("estimate_rows")
        .select("id,sheet_id,row_index,description,qty_source,qty_manual,unit_cost,markup_pct,meta")
        .eq("sheet_id", sheet.id)
        .order("row_index", { ascending: true });
      if (error) throw error;
      return (rows ?? []) as EstimateRow[];
    },
  });

  const estimateTotal = useMemo(() => {
    // v1: manual qty only (takeoff-linked quantities are computed live in Estimating module)
    return estimateRows.reduce((sum, r) => {
      const qty = num(r.qty_manual);
      const unit = num(r.unit_cost);
      const mk = num(r.markup_pct);
      const subtotal = qty * unit;
      return sum + subtotal * (1 + mk / 100);
    }, 0);
  }, [estimateRows]);

  const [form, setForm] = useState({
    title: "",
    intro: "",
    scope: "",
    terms: "",
  });

  useEffect(() => {
    const tj = template?.template_json ?? {};
    setForm({
      title: tj.title ?? "Renovation Proposal",
      intro: tj.intro ?? "",
      scope: tj.scope ?? "",
      terms: tj.terms ?? "",
    });
  }, [templateId]);

  const saveTemplate = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Missing template");
      const { error } = await supabase
        .from("proposal_templates")
        .update({
          template_json: { ...form },
          updated_at: new Date().toISOString(),
        })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Template saved" });
      await qc.invalidateQueries({ queryKey: ["proposal-template", projectId] });
    },
    onError: (e: any) => {
      toast({ title: "Failed to save template", description: e?.message, variant: "destructive" });
    },
  });

  const createVersion = useMutation({
    mutationFn: async () => {
      const uid = await requireUserId();
      const nextVersion = (latestProposal?.version ?? 0) + 1;

      const snapshot = {
        template: { ...form },
        estimate_total: estimateTotal,
        estimate_rows: estimateRows,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("proposals").insert({
        project_id: projectId,
        owner_id: uid,
        template_id: templateId,
        version: nextVersion,
        status: "draft",
        snapshot,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Proposal version created" });
      await qc.invalidateQueries({ queryKey: ["proposals", projectId] });
    },
    onError: (e: any) => {
      toast({ title: "Failed to create proposal", description: e?.message, variant: "destructive" });
    },
  });

  return (
    <div className="w-full h-full">
      <Card className="h-full w-full overflow-hidden">
        <div className="border-b bg-background px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Proposal</div>
            <div className="text-xs text-muted-foreground">
              Proposal v1: template + version snapshot. Export via Print → Save as PDF.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              Print / Save PDF
            </Button>
            {!embedded ? (
              <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
                Back
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[380px_1fr]">
          <div className="space-y-3">
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-semibold">Template</div>
              <div className="text-xs text-muted-foreground">These fields are used for all proposal versions.</div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Title</div>
                <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Intro</div>
                <Textarea value={form.intro} onChange={(e) => setForm((p) => ({ ...p, intro: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Scope</div>
                <Textarea value={form.scope} onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Terms</div>
                <Textarea value={form.terms} onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))} />
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => saveTemplate.mutate()} disabled={!templateId}>
                  Save template
                </Button>
                <Button size="sm" variant="outline" onClick={() => createVersion.mutate()} disabled={!templateId}>
                  Create new version
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-sm font-semibold">Versions</div>
              <div className="mt-2 space-y-2 text-sm">
                {proposals.length ? (
                  proposals.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border px-2 py-2">
                      <div>
                        <div className="font-medium">v{p.version}</div>
                        <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{p.status}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No versions yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6 print:p-0">
            <div className="text-2xl font-bold">{form.title}</div>
            <div className="mt-4 whitespace-pre-wrap text-sm">{form.intro}</div>

            <div className="mt-6">
              <div className="text-sm font-semibold">Scope of Work</div>
              <div className="mt-2 whitespace-pre-wrap text-sm">{form.scope || "—"}</div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-semibold">Pricing Summary</div>
              <div className="mt-2 text-sm">
                Current estimate total (v1): <span className="font-semibold">${estimateTotal.toFixed(2)}</span>
              </div>
              <div className="mt-3 overflow-auto rounded-md border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Description</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Qty</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Unit</th>
                      <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimateRows.map((r) => {
                      const qty = num(r.qty_manual);
                      const unit = num(r.unit_cost);
                      const mk = num(r.markup_pct);
                      const subtotal = qty * unit;
                      const total = subtotal * (1 + mk / 100);
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">{r.row_index}</td>
                          <td className="px-3 py-2">{r.description || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{qty.toFixed(3)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">${unit.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">${total.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                    {!estimateRows.length ? (
                      <tr>
                        <td className="px-3 py-5 text-xs text-muted-foreground" colSpan={5}>
                          No estimate rows found. Add rows in Estimating.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-semibold">Terms</div>
              <div className="mt-2 whitespace-pre-wrap text-sm">{form.terms}</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ProposalWorkspace() {
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
        <ProposalWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
