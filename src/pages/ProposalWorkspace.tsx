import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

/**
 * Proposal (MVP)
 * - Reads estimate lines from localStorage (aostot:estimate:${projectId})
 * - Editable proposal draft (localStorage)
 * - Print/export via window.print()
 *
 * DB writes are best-effort (won't break if tables/columns don't exist yet).
 */

type Unit = "ea" | "m" | "m²" | "ft" | "ft²" | "ls";

type EstimateRow = {
  id: string;
  code: string;
  description: string;
  unit: Unit;
  qty: number;
  rate: number;
  markupPct: number;
};

type ProposalDraft = {
  proposalNumber: string;
  date: string;
  preparedFor: string;
  preparedBy: string;
  intro: string;
  scope: string;
  exclusions: string;
  terms: string;
};

function estimateKey(projectId: string) {
  return `aostot:estimate:${projectId}`;
}
function proposalKey(projectId: string) {
  return `aostot:proposal:${projectId}`;
}

function stableJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(Date.now());
  }
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

async function writeProposalSnapshot(opts: { projectId: string; payload: unknown; total: number }) {
  const { projectId, payload, total } = opts;

  // 1) Update project rollup total_sales (best-effort)
  try {
    await supabase.from("projects").update({ total_sales: total }).eq("id", projectId);
  } catch {
    // ignore
  }

  // 2) Optional: proposal_progress (best-effort)
  try {
    await supabase.from("projects").update({ proposal_progress: 20 }).eq("id", projectId);
  } catch {
    // ignore
  }

  // 3) Versioning + activity (best-effort; tolerate schema differences)
  try {
    const { data: authRes } = await supabase.auth.getUser();
    const uid = authRes.user?.id ?? null;

    // proposal_versions: try created_by then user_id
    try {
      await supabase.from("proposal_versions").insert({
        project_id: projectId,
        total,
        payload,
        created_by: uid,
      });
    } catch {
      try {
        await supabase.from("proposal_versions").insert({
          project_id: projectId,
          total,
          payload,
          user_id: uid,
        });
      } catch {
        // ignore
      }
    }

    // project_activity: try (kind, created_by) then (event_type, user_id)
    try {
      await supabase.from("project_activity").insert({
        project_id: projectId,
        kind: "proposal_update",
        message: "Proposal updated",
        meta: { total },
        created_by: uid,
      });
    } catch {
      try {
        await supabase.from("project_activity").insert({
          project_id: projectId,
          event_type: "proposal_update",
          message: "Proposal updated",
          meta: { total },
          user_id: uid,
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function normalizeEstimate(raw: unknown): EstimateRow[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as EstimateRow[];
  // support { rows: [...] } shape
  const maybe = raw as any;
  if (Array.isArray(maybe?.rows)) return maybe.rows as EstimateRow[];
  return [];
}

export function ProposalWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();

  const [draft, setDraft] = useState<ProposalDraft>({
    proposalNumber: "",
    date: new Date().toISOString().slice(0, 10),
    preparedFor: "",
    preparedBy: "",
    intro:
      "Thank you for the opportunity to provide a proposal for the works described below. This proposal is based on the provided plans and information available at the time of pricing.",
    scope: "",
    exclusions: "",
    terms:
      "Payment terms: 50% deposit, 40% progress, 10% upon completion.\nThis proposal is valid for 14 days.\nAny variations will be priced and approved in writing prior to execution.",
  });

  const [hydrated, setHydrated] = useState(false);
  const lastSnapshotHashRef = useRef<string>("");
  const snapshotTimerRef = useRef<number | null>(null);

  // Load proposal draft
  useEffect(() => {
    setHydrated(false);

    const raw = localStorage.getItem(proposalKey(projectId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ProposalDraft;
        if (parsed && typeof parsed === "object") setDraft(parsed);
      } catch {
        // ignore
      }
    }

    setHydrated(true);
  }, [projectId]);

  // Persist draft
  useEffect(() => {
    localStorage.setItem(proposalKey(projectId), JSON.stringify(draft));
  }, [projectId, draft]);

  const estimateRows = useMemo(() => {
    const raw = localStorage.getItem(estimateKey(projectId));
    if (!raw) return [] as EstimateRow[];
    try {
      return normalizeEstimate(JSON.parse(raw));
    } catch {
      return [] as EstimateRow[];
    }
  }, [projectId]);

  const totals = useMemo(() => {
    const subtotal = estimateRows.reduce((s, r) => s + r.qty * r.rate, 0);
    const total = estimateRows.reduce((s, r) => s + r.qty * r.rate * (1 + r.markupPct / 100), 0);
    return { subtotal, total };
  }, [estimateRows]);

  // Debounced snapshot to DB (for activity + rollups)
  useEffect(() => {
    if (!hydrated) return;

    const payload = { draft, estimateRows };
    const hash = stableJson({ payload, total: totals.total });

    if (hash === lastSnapshotHashRef.current) return;

    if (snapshotTimerRef.current) window.clearTimeout(snapshotTimerRef.current);

    snapshotTimerRef.current = window.setTimeout(() => {
      void writeProposalSnapshot({
        projectId,
        payload,
        total: totals.total,
      });
      lastSnapshotHashRef.current = hash;
    }, 1200);

    return () => {
      if (snapshotTimerRef.current) window.clearTimeout(snapshotTimerRef.current);
    };
  }, [hydrated, projectId, draft, estimateRows, totals.total]);

  function printProposal() {
    if (!estimateRows.length) {
      toast({
        title: "No estimate lines",
        description: "Add estimate lines first (Estimating tab).",
      });
      return;
    }

    void writeProposalSnapshot({
      projectId,
      payload: { draft, estimateRows },
      total: totals.total,
    });

    window.print();
  }

  return (
    <div className="h-full w-full">
      <Card className="h-full w-full overflow-hidden">
        <div className="border-b bg-background px-4 py-3 print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Proposal</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Generate a client-facing proposal from your estimate.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={printProposal}>
                Export / Print
              </Button>
              {!embedded ? (
                <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
                  Back
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid h-[calc(100%-56px)] grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-2 print:block">
          <div className="space-y-4 print:hidden">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Proposal #</div>
                <Input
                  value={draft.proposalNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, proposalNumber: e.target.value }))}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Date</div>
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Prepared for</div>
                <Input
                  value={draft.preparedFor}
                  onChange={(e) => setDraft((d) => ({ ...d, preparedFor: e.target.value }))}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Prepared by</div>
                <Input
                  value={draft.preparedBy}
                  onChange={(e) => setDraft((d) => ({ ...d, preparedBy: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground">Introduction</div>
              <Textarea value={draft.intro} onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value }))} />
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground">Scope</div>
              <Textarea value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))} />
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground">Exclusions</div>
              <Textarea
                value={draft.exclusions}
                onChange={(e) => setDraft((d) => ({ ...d, exclusions: e.target.value }))}
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground">Terms</div>
              <Textarea value={draft.terms} onChange={(e) => setDraft((d) => ({ ...d, terms: e.target.value }))} />
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6 print:border-0 print:p-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl font-bold">Proposal</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {draft.proposalNumber ? `#${draft.proposalNumber} • ` : ""}
                  {draft.date}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">Total</div>
                <div className="text-lg">{money(totals.total)}</div>
              </div>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <div className="whitespace-pre-wrap">{draft.intro}</div>

              {estimateRows.length ? (
                <div className="overflow-auto rounded-md border">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-2">Code</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2">Unit</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimateRows.map((r) => {
                        const lineTotal = r.qty * r.rate * (1 + r.markupPct / 100);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-3 py-2">{r.code}</td>
                            <td className="px-3 py-2">{r.description}</td>
                            <td className="px-3 py-2 text-right">{r.qty}</td>
                            <td className="px-3 py-2">{r.unit}</td>
                            <td className="px-3 py-2 text-right">{money(r.rate)}</td>
                            <td className="px-3 py-2 text-right">{money(lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted-foreground">No estimate lines yet. Add them in Estimating.</div>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Subtotal</div>
                <div className="text-right">{money(totals.subtotal)}</div>
                <div className="text-muted-foreground">Total (with markup)</div>
                <div className="text-right font-semibold">{money(totals.total)}</div>
              </div>

              {draft.scope.trim() ? <div className="whitespace-pre-wrap">{draft.scope}</div> : null}
              {draft.exclusions.trim() ? <div className="whitespace-pre-wrap">{draft.exclusions}</div> : null}
              {draft.terms.trim() ? <div className="whitespace-pre-wrap">{draft.terms}</div> : null}
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
    <AppLayout mode="takeoff">
      <div className="h-[calc(100vh-72px)]">
        <ProposalWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
