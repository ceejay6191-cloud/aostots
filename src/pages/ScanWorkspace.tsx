import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

/**
 * Scan (MVP stub)
 * - Lists project documents and lets you run a simulated scan.
 * - Results are stored client-side only (localStorage).
 *
 * Next: integrate actual detection service + store per-page detections in Supabase.
 */

type DocumentRow = {
  id: string;
  project_id: string;
  bucket: string;
  path: string;
  file_name: string;
  created_at: string;
};

type DetectionClass =
  | "door"
  | "window"
  | "wall"
  | "ceiling"
  | "flooring"
  | "fixture"
  | "other";

type Detection = {
  id: string;
  page: number;
  cls: DetectionClass;
  confidence: number; // 0-1
};

function safeId() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function key(projectId: string, docId: string) {
  return `aostot:scan:${projectId}:${docId}`;
}

export function ScanWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();

  const { data: documents = [] } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_documents")
        .select("id,project_id,bucket,path,file_name,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  useEffect(() => {
    if (activeDocId) return;
    if (documents.length) setActiveDocId(documents[0].id);
  }, [documents, activeDocId]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [detections, setDetections] = useState<Detection[]>([]);

  // load saved scan
  useEffect(() => {
    if (!activeDocId) {
      setDetections([]);
      return;
    }
    const raw = localStorage.getItem(key(projectId, activeDocId));
    if (!raw) {
      setDetections([]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Detection[];
      setDetections(Array.isArray(parsed) ? parsed : []);
    } catch {
      setDetections([]);
    }
  }, [projectId, activeDocId]);

  // save
  useEffect(() => {
    if (!activeDocId) return;
    localStorage.setItem(key(projectId, activeDocId), JSON.stringify(detections));
  }, [projectId, activeDocId, detections]);

  async function runScan() {
    if (!activeDocId) return;
    setIsScanning(true);
    setProgress(0);

    // simulate work without blocking the UI
    let p = 0;
    const t = window.setInterval(() => {
      p += 7;
      setProgress(Math.min(100, p));
      if (p >= 100) {
        window.clearInterval(t);
        setIsScanning(false);

        // fake detections
        const sample: Detection[] = Array.from({ length: 12 }).map((_, i) => {
          const classes: DetectionClass[] = [
            "door",
            "window",
            "wall",
            "ceiling",
            "flooring",
            "fixture",
          ];
          const cls = classes[i % classes.length] ?? "other";
          return {
            id: safeId(),
            page: 1 + (i % 3),
            cls,
            confidence: Number((0.65 + (i % 4) * 0.08).toFixed(2)),
          };
        });

        setDetections(sample);
        toast({
          title: "Scan completed (stub)",
          description: "This is a UI placeholder. Next step is wiring a real detection service.",
        });
      }
    }, 80);
  }

  function clearScan() {
    setDetections([]);
    toast({ title: "Cleared scan results" });
  }

  return (
    <div className="h-full w-full">
      <Card className="h-full w-full overflow-hidden">
        <div className="border-b bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Scan</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Detect doors, windows, walls, ceilings, flooring, and more (next).
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={runScan} disabled={!activeDocId || isScanning}>
                {isScanning ? `Scanning… ${progress}%` : "Run scan"}
              </Button>
              <Button size="sm" variant="outline" onClick={clearScan} disabled={!detections.length}>
                Clear
              </Button>
              {!embedded ? (
                <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
                  Back
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold text-muted-foreground">Document</div>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={activeDocId ?? ""}
              onChange={(e) => setActiveDocId(e.target.value || null)}
            >
              {documents.length ? (
                documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.file_name}
                  </option>
                ))
              ) : (
                <option value="">No documents</option>
              )}
            </select>

            <div className="ml-auto flex items-center gap-2 text-sm">
              <Badge variant="outline">Detections: {detections.length}</Badge>
              {activeDoc ? <Badge variant="secondary">{activeDoc.file_name}</Badge> : null}
            </div>
          </div>
        </div>

        <div className="h-[calc(100%-96px)] overflow-auto p-4">
          {!activeDocId ? (
            <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
              Upload a PDF in Documents to scan.
            </div>
          ) : !detections.length ? (
            <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
              No scan results yet. Click <span className="font-medium">Run scan</span>.
            </div>
          ) : (
            <div className="rounded-lg border bg-background">
              <div className="grid grid-cols-[100px_1fr_140px] gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground">
                <div>Page</div>
                <div>Class</div>
                <div className="text-right">Confidence</div>
              </div>

              {detections.map((d) => (
                <div
                  key={d.id}
                  className="grid grid-cols-[100px_1fr_140px] gap-2 border-b px-4 py-2 text-sm"
                >
                  <div>#{d.page}</div>
                  <div className="capitalize">{d.cls}</div>
                  <div className="text-right">{Math.round(d.confidence * 100)}%</div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 text-xs text-muted-foreground">
            Next: real AI detection + per-page overlays in Takeoff (auto-count, auto-line, auto-area).
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ScanWorkspace() {
  const { projectId } = useParams();
  if (!projectId) return null;

  return (
    <AppLayout fullWidth>
      <div className="h-[calc(100vh-72px)]">
        <ScanWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
