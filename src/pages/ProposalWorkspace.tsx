import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

/**
 * Proposal (MVP)
 * - Uses localStorage estimate (aostot:estimate:${projectId})
 * - Editable sections
 * - Print/export via window.print()
 *
 * Next: server-side PDF generation, versioning, and client portal links.
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

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function estimateKey(projectId: string) {
  return `aostot:estimate:${projectId}`;
}

function proposalKey(projectId: string) {
  return `aostot:proposal:${projectId}`;
}

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

  // Load/save proposal draft
  useEffect(() => {
    const raw = localStorage.getItem(proposalKey(projectId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ProposalDraft;
      if (parsed && typeof parsed === "object") setDraft(parsed);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(proposalKey(projectId), JSON.stringify(draft));
  }, [projectId, draft]);

  const estimateRows = useMemo(() => {
    const raw = localStorage.getItem(estimateKey(projectId));
    if (!raw) return [] as EstimateRow[];
    try {
      const parsed = JSON.parse(raw) as EstimateRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [] as EstimateRow[];
    }
  }, [projectId]);

  const totals = useMemo(() => {
    const subtotal = estimateRows.reduce((s, r) => s + r.qty * r.rate, 0);
    const total = estimateRows.reduce((s, r) => s + r.qty * r.rate * (1 + r.markupPct / 100), 0);
    return { subtotal, total };
  }, [estimateRows]);

  function printProposal() {
    if (!estimateRows.length) {
      toast({
        title: "No estimate lines",
        description: "Add estimate lines first (Estimating tab).",
      });
      return;
    }
    window.print();
  }

  return (
    <div className="h-full w-full">
      <Card className="h-full w-full overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background px-4 py-3 print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Proposal</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Generates a client-facing proposal from your estimate.
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

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">Subtotal: {money(totals.subtotal)}</Badge>
            <Badge variant="secondary">Total: {money(totals.total)}</Badge>
          </div>
        </div>

        {/* Content */}
        <div className="h-[calc(100%-72px)] overflow-auto bg-muted/10 p-4 print:h-auto print:overflow-visible print:bg-white">
          {/* Print styles */}
          <style>{`
            @media print {
              @page { margin: 14mm; }
              .print\\:hidden { display: none !important; }
              .print\\:pagebreak { page-break-before: always; }
            }
          `}</style>

          <div className="mx-auto max-w-[900px] rounded-xl border bg-white p-6 print:border-0 print:p-0">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-bold">Proposal</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Prepared on {draft.date}
                </div>
              </div>

              <div className="text-right text-sm">
                <div className="font-medium">Proposal #</div>
                <div className="text-muted-foreground">{draft.proposalNumber || "—"}</div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="text-xs font-semibold text-muted-foreground">Prepared for</div>
                <div className="mt-2 print:hidden">
                  <Input
                    value={draft.preparedFor}
                    placeholder="Client / Company"
                    onChange={(e) => setDraft((p) => ({ ...p, preparedFor: e.target.value }))}
                  />
                </div>
                <div className="mt-2 hidden print:block">{draft.preparedFor || "—"}</div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-xs font-semibold text-muted-foreground">Prepared by</div>
                <div className="mt-2 print:hidden">
                  <Input
                    value={draft.preparedBy}
                    placeholder="Estimator / Company"
                    onChange={(e) => setDraft((p) => ({ ...p, preparedBy: e.target.value }))}
                  />
                </div>
                <div className="mt-2 hidden print:block">{draft.preparedBy || "—"}</div>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Introduction</div>
                <div className="mt-2 print:hidden">
                  <Textarea
                    value={draft.intro}
                    onChange={(e) => setDraft((p) => ({ ...p, intro: e.target.value }))}
                    className="min-h-[90px]"
                  />
                </div>
                <div className="mt-2 whitespace-pre-wrap hidden print:block">{draft.intro}</div>
              </section>

              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Scope of Works</div>
                <div className="mt-2 print:hidden">
                  <Textarea
                    value={draft.scope}
                    onChange={(e) => setDraft((p) => ({ ...p, scope: e.target.value }))}
                    className="min-h-[120px]"
                    placeholder="Describe the work included…"
                  />
                </div>
                <div className="mt-2 whitespace-pre-wrap hidden print:block">{draft.scope || "—"}</div>
              </section>

              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Estimate Summary</div>
                <div className="mt-3 overflow-hidden rounded-lg border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Code</th>
                        <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Description</th>
                        <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Qty</th>
                        <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Unit</th>
                        <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimateRows.length ? (
                        estimateRows.map((r) => {
                          const amount = r.qty * r.rate * (1 + r.markupPct / 100);
                          return (
                            <tr key={r.id} className="border-t">
                              <td className="px-4 py-2">{r.code || "—"}</td>
                              <td className="px-4 py-2">{r.description || "—"}</td>
                              <td className="px-4 py-2 text-right">{r.qty}</td>
                              <td className="px-4 py-2 text-right">{r.unit}</td>
                              <td className="px-4 py-2 text-right font-medium">{money(amount)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={5}>
                            No estimate lines yet. Build your estimate first.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="border-t bg-muted/10">
                      <tr>
                        <td className="px-4 py-2 text-right font-semibold" colSpan={4}>
                          Total
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">{money(totals.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Exclusions</div>
                <div className="mt-2 print:hidden">
                  <Textarea
                    value={draft.exclusions}
                    onChange={(e) => setDraft((p) => ({ ...p, exclusions: e.target.value }))}
                    className="min-h-[90px]"
                    placeholder="List exclusions…"
                  />
                </div>
                <div className="mt-2 whitespace-pre-wrap hidden print:block">{draft.exclusions || "—"}</div>
              </section>

              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Terms</div>
                <div className="mt-2 print:hidden">
                  <Textarea
                    value={draft.terms}
                    onChange={(e) => setDraft((p) => ({ ...p, terms: e.target.value }))}
                    className="min-h-[120px]"
                  />
                </div>
                <div className="mt-2 whitespace-pre-wrap hidden print:block">{draft.terms}</div>
              </section>

              <div className="print:pagebreak" />

              <section className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Acceptance</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  By signing below, the client accepts the proposal as presented.
                </div>

                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">Client signature</div>
                    <div className="mt-10 h-10 border-b" />
                    <div className="mt-2 text-xs text-muted-foreground">Name / Date</div>
                  </div>

                  <div className="rounded-lg border p-4">
                    <div className="text-xs font-semibold text-muted-foreground">Company signature</div>
                    <div className="mt-10 h-10 border-b" />
                    <div className="mt-2 text-xs text-muted-foreground">Name / Date</div>
                  </div>
                </div>
              </section>

              <div className="mt-3 text-xs text-muted-foreground print:hidden">
                Next: proposal versions, cover branding, attachments, and PDF export service.
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ProposalWorkspace() {
  const { projectId } = useParams();
  if (!projectId) return null;

  return (
    <AppLayout fullWidth>
      <div className="h-[calc(100vh-72px)]">
        <ProposalWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
