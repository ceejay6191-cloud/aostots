import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

type DocumentRow = {
  id: string;
  project_id: string;
  owner_id: string;
  bucket: string;
  path: string;
  file_name: string;
  created_at: string;
};

type ScanJob = {
  id: string;
  project_id: string;
  document_id: string;
  owner_id: string;
  status: string;
  progress: number;
  options: any;
  created_at: string;
  updated_at: string;
};

type ScanDetection = {
  id: string;
  job_id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  owner_id: string;
  class: string;
  confidence: number;
  geom: any;
  meta: any;
  created_at: string;
};

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error("Not signed in");
  return uid;
}

function rand(seed: number) {
  // deterministic-ish generator
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function ScanWorkspaceContent({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: documents = [] } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_documents")
        .select("id,project_id,owner_id,bucket,path,file_name,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });

  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  // default doc
  useMemo(() => {
    if (!activeDocId && documents.length) setActiveDocId(documents[0].id);
  }, [activeDocId, documents]);

  const { data: jobs = [] } = useQuery({
    queryKey: ["scan-jobs", activeDocId],
    enabled: !!activeDocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_jobs")
        .select("*")
        .eq("document_id", activeDocId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ScanJob[];
    },
  });

  const latestJob = jobs[0] ?? null;

  const { data: detections = [] } = useQuery({
    queryKey: ["scan-detections", latestJob?.id],
    enabled: !!latestJob?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_detections")
        .select("*")
        .eq("job_id", latestJob!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScanDetection[];
    },
  });

  const createJob = useMutation({
    mutationFn: async () => {
      if (!activeDocId) throw new Error("Choose a document");
      const uid = await requireUserId();
      const { data, error } = await supabase
        .from("scan_jobs")
        .insert({
          project_id: projectId,
          document_id: activeDocId,
          owner_id: uid,
          status: "queued",
          progress: 0,
          options: {
            classes: ["door", "window", "wall", "flooring", "ceiling"],
            threshold: 0.35,
          },
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ScanJob;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scan-jobs", activeDocId] });
    },
    onError: (e: any) => toast({ title: "Failed to create scan job", description: e?.message, variant: "destructive" }),
  });

  const runPrototypeScan = useMutation({
    mutationFn: async () => {
      if (!latestJob?.id) throw new Error("Create a scan job first");
      if (!activeDocId) throw new Error("Missing document");

      const uid = await requireUserId();

      // mark running
      await supabase.from("scan_jobs").update({ status: "running", progress: 0.1 }).eq("id", latestJob.id);

      // Create some fake detections on page 1 only (prototype)
      const classes = ["door", "window", "wall", "ceiling", "flooring"];
      const rows = Array.from({ length: 10 }).map((_, i) => {
        const c = classes[i % classes.length];
        const confidence = 0.55 + rand(i + 1) * 0.4;
        const x = rand(i + 10) * 0.8 + 0.1;
        const y = rand(i + 20) * 0.8 + 0.1;
        const w = 0.05 + rand(i + 30) * 0.12;
        const h = 0.05 + rand(i + 40) * 0.12;
        return {
          job_id: latestJob.id,
          project_id: projectId,
          document_id: activeDocId,
          page_number: 1,
          owner_id: uid,
          class: c,
          confidence,
          geom: { bbox_norm: { x, y, w, h } },
          meta: { source: "prototype" },
        };
      });

      const { error } = await supabase.from("scan_detections").insert(rows);
      if (error) throw error;

      await supabase.from("scan_jobs").update({ status: "done", progress: 1 }).eq("id", latestJob.id);
    },
    onSuccess: async () => {
      toast({ title: "Scan completed (prototype)" });
      await qc.invalidateQueries({ queryKey: ["scan-detections", latestJob?.id] });
      await qc.invalidateQueries({ queryKey: ["scan-jobs", activeDocId] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }),
  });

  const importJson = useMutation({
    mutationFn: async (jsonText: string) => {
      if (!latestJob?.id) throw new Error("Create a scan job first");
      if (!activeDocId) throw new Error("Missing document");
      const uid = await requireUserId();

      const parsed = JSON.parse(jsonText);
      // expected: [{page_number, class, confidence, geom}, ...]
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array");

      const rows = parsed.map((d: any) => ({
        job_id: latestJob.id,
        project_id: projectId,
        document_id: activeDocId,
        page_number: Number(d.page_number ?? 1),
        owner_id: uid,
        class: String(d.class ?? "unknown"),
        confidence: Number(d.confidence ?? 0.5),
        geom: d.geom ?? {},
        meta: d.meta ?? { source: "import" },
      }));

      const { error } = await supabase.from("scan_detections").insert(rows);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Imported detections" });
      await qc.invalidateQueries({ queryKey: ["scan-detections", latestJob?.id] });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });

  const [jsonInput, setJsonInput] = useState("");

  return (
    <div className="w-full h-full">
      <Card className="h-full w-full overflow-hidden">
        <div className="border-b bg-background px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Scan</div>
            <div className="text-xs text-muted-foreground">
              Pipeline foundation. Prototype scan generates detections; production scan is via server inference.
            </div>
          </div>
          {!embedded ? (
            <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>
          ) : null}
        </div>

        <div className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs font-semibold text-muted-foreground">Document</div>
              <select
                className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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

              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => createJob.mutate()} disabled={!activeDocId}>
                  Create job
                </Button>
                <Button size="sm" variant="outline" onClick={() => runPrototypeScan.mutate()} disabled={!latestJob?.id}>
                  Run prototype
                </Button>
              </div>

              {latestJob ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  Status: <span className="font-medium">{latestJob.status}</span> • Progress:{" "}
                  {Math.round((latestJob.progress ?? 0) * 100)}%
                </div>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">No scan job yet.</div>
              )}
            </div>

            <div className="rounded-lg border p-3 md:col-span-2">
              <div className="text-xs font-semibold text-muted-foreground">Import detections JSON</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Format: array of {{ page_number, class, confidence, geom }}. This is how your inference service will upload results.
              </div>
              <textarea
                className="mt-2 h-32 w-full rounded-md border border-input bg-background p-2 text-sm"
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='[{ "page_number": 1, "class": "door", "confidence": 0.86, "geom": { "bbox_norm": {"x":0.2,"y":0.3,"w":0.1,"h":0.05} } }]'
              />
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => importJson.mutate(jsonInput)} disabled={!jsonInput.trim() || !latestJob?.id}>
                  Import
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="text-sm font-semibold">Detections</div>
            <div className="mt-2 text-xs text-muted-foreground">
              These detections can be converted to auto takeoff items (next: accept/reject UI + geometry conversion).
            </div>

            <div className="mt-3 overflow-auto rounded-md border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Page</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Class</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Confidence</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground">Geom</th>
                  </tr>
                </thead>
                <tbody>
                  {detections.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="px-3 py-2">{d.page_number}</td>
                      <td className="px-3 py-2">{d.class}</td>
                      <td className="px-3 py-2 tabular-nums">{d.confidence.toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {JSON.stringify(d.geom).slice(0, 120)}
                        {JSON.stringify(d.geom).length > 120 ? "…" : ""}
                      </td>
                    </tr>
                  ))}
                  {!detections.length ? (
                    <tr>
                      <td className="px-3 py-5 text-xs text-muted-foreground" colSpan={4}>
                        No detections yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ScanWorkspace() {
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
        <ScanWorkspaceContent projectId={projectId} />
      </div>
    </AppLayout>
  );
}
