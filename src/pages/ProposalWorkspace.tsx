import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected";

export type ProposalStats = {
  status: ProposalStatus;
  pct: number;
};

const STATUS_TO_PCT: Record<ProposalStatus, number> = {
  draft: 50,
  sent: 90,
  accepted: 100,
  rejected: 100,
};

function readStatus(projectId: string): ProposalStatus {
  try {
    const raw = localStorage.getItem(`aostot:proposal:status:${projectId}`);
    if (raw === "draft" || raw === "sent" || raw === "accepted" || raw === "rejected") return raw;
    return "draft";
  } catch {
    return "draft";
  }
}

function writeStatus(projectId: string, s: ProposalStatus) {
  try {
    localStorage.setItem(`aostot:proposal:status:${projectId}`, s);
  } catch {
    // ignore
  }
}

export function ProposalWorkspaceContent({
  projectId,
  embedded,
  onStats,
}: {
  projectId: string;
  embedded?: boolean;
  onStats?: (s: ProposalStats) => void;
}) {
  const [status, setStatus] = useState<ProposalStatus>(() => readStatus(projectId));

  useEffect(() => {
    setStatus(readStatus(projectId));
  }, [projectId]);

  useEffect(() => {
    writeStatus(projectId, status);
    onStats?.({ status, pct: STATUS_TO_PCT[status] });
  }, [projectId, status, onStats]);

  const pct = useMemo(() => STATUS_TO_PCT[status], [status]);

  const containerClass = embedded ? "h-full" : "";

  return (
    <div className={containerClass}>
      <Card className={embedded ? "h-full border-0 shadow-none" : "p-4"}>
        <div className={embedded ? "p-4" : ""}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">Proposal</div>
              <div className="text-sm text-muted-foreground">
                Track proposal status for progress + reporting.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="capitalize">
                {status}
              </Badge>
              <div className="rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums">
                {pct}%
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["draft", "sent", "accepted", "rejected"] as ProposalStatus[]).map((s) => (
              <Button
                key={s}
                variant={status === s ? "default" : "outline"}
                onClick={() => setStatus(s)}
                className="capitalize"
              >
                {s}
              </Button>
            ))}
          </div>

          <div className="mt-6 text-sm text-muted-foreground">
            Next: proposal PDF export, templates, and quote versioning/audit trail after Supabase schema is finalized.
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ProposalWorkspace() {
  return (
    <div className="p-4">
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Open this workspace via a project to load projectId.</div>
      </Card>
    </div>
  );
}
