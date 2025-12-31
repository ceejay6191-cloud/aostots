import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABELS, ProjectStatus } from "@/types/project";
import { TakeoffWorkspaceContent } from "@/pages/TakeoffWorkspace";

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  client_email: string | null;
  estimator_name: string | null;
  status: ProjectStatus;
  total_sales: number | null;
  notes: string | null;
  created_at: string;
};

type TabKey = "overview" | "documents" | "takeoff" | "estimating" | "proposal";

type DocumentRow = {
  id: string;
  project_id: string;
  owner_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function stableStringify(v: unknown) {
  return JSON.stringify(v, Object.keys(v as any).sort());
}

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Trigger value used to request "enter calibration mode" inside embedded Takeoff.
  const [takeoffScaleTrigger, setTakeoffScaleTrigger] = useState(0);

  // ------------------------------------------------------------
  // Project query
  // ------------------------------------------------------------
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id,name,client_name,client_email,estimator_name,status,total_sales,notes,created_at"
        )
        .eq("id", projectId)
        .single();

      if (error) throw error;
      return data as ProjectRow;
    },
  });

  // ------------------------------------------------------------
  // Documents query
  // ------------------------------------------------------------
  const { data: documents, isLoading: docsLoading } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_documents")
        .select(
          "id,project_id,owner_id,bucket,path,file_name,mime_type,size_bytes,created_at"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });

  // ------------------------------------------------------------
  // Local editable form state + autosave
  // ------------------------------------------------------------
  const statusOptions = useMemo(
    () => Object.keys(STATUS_LABELS) as ProjectStatus[],
    []
  );

  const [form, setForm] = useState({
    name: "",
    client_name: "",
    client_email: "",
    estimator_name: "",
    status: "estimating" as ProjectStatus,
    notes: "",
  });

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name ?? "",
      client_name: project.client_name ?? "",
      client_email: project.client_email ?? "",
      estimator_name: project.estimator_name ?? "",
      status: project.status ?? "estimating",
      notes: project.notes ?? "",
    });
  }, [project]);

  const lastSavedKeyRef = useRef<string>("");
  const autosaveTimerRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const autosaveMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      client_name: string | null;
      client_email: string | null;
      estimator_name: string | null;
      status: ProjectStatus;
      notes: string | null;
    }) => {
      if (!projectId) throw new Error("Missing projectId");
      const { error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSaveState("saved");
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: any) => {
      setSaveState("idle");
      toast({
        title: "Autosave failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!projectId) return;
    if (!project) return;

    const payload = {
      name: form.name.trim(),
      client_name: form.client_name.trim() || null,
      client_email: form.client_email.trim() || null,
      estimator_name: form.estimator_name.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    const key = stableStringify(payload);

    // initialize last saved snapshot once
    if (!lastSavedKeyRef.current) {
      lastSavedKeyRef.current = key;
      return;
    }

    // no-op if nothing changed
    if (key === lastSavedKeyRef.current) return;

    if (autosaveTimerRef.current)
      window.clearTimeout(autosaveTimerRef.current);
    setSaveState("saving");

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveMutation.mutate(payload, {
        onSuccess: () => {
          lastSavedKeyRef.current = key;
        },
      });
    }, 650);

    return () => {
      if (autosaveTimerRef.current)
        window.clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, projectId, project?.id]);

  // ------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------
  async function handleUpload(file: File) {
    if (!projectId) return;

    const { data: authRes, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      toast({
        title: "Auth error",
        description: authErr.message,
        variant: "destructive",
      });
      return;
    }
    const uid = authRes.user?.id;
    if (!uid) {
      toast({
        title: "Not signed in",
        description: "Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    const bucket = "project-documents";
    const path = `${uid}/${projectId}/${Date.now()}-${file.name}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

    if (upErr) {
      toast({
        title: "Upload failed",
        description: upErr.message,
        variant: "destructive",
      });
      return;
    }

    const { error: insErr } = await supabase.from("project_documents").insert({
      project_id: projectId,
      owner_id: uid,
      bucket,
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size || null,
    });

    if (insErr) {
      toast({
        title: "Uploaded, but failed to save metadata",
        description: insErr.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Uploaded", description: "Document uploaded and added to the list." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  // ------------------------------------------------------------
  // Document actions
  // ------------------------------------------------------------
  async function renameDocument(doc: DocumentRow) {
    const next = window.prompt("Rename document to:", doc.file_name);
    if (!next) return;

    const trimmed = next.trim();
    if (!trimmed) return;

    const { error } = await supabase
      .from("project_documents")
      .update({ file_name: trimmed })
      .eq("id", doc.id);

    if (error) {
      toast({
        title: "Rename failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Renamed", description: "Document name updated." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  async function deleteDocument(doc: DocumentRow) {
    const ok = window.confirm(`Delete "${doc.file_name}"? This cannot be undone.`);
    if (!ok) return;

    const { error: rmErr } = await supabase.storage.from(doc.bucket).remove([doc.path]);
    if (rmErr) {
      toast({
        title: "Delete failed",
        description: rmErr.message,
        variant: "destructive",
      });
      return;
    }

    const { error: dbErr } = await supabase.from("project_documents").delete().eq("id", doc.id);
    if (dbErr) {
      toast({
        title: "Deleted file, but failed to delete record",
        description: dbErr.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Deleted", description: "Document removed." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  // ------------------------------------------------------------
  // Loading / error states
  // ------------------------------------------------------------
  if (isLoading) {
    return (
      <AppLayout fullWidth>
        <Card className="p-6">Loading…</Card>
      </AppLayout>
    );
  }

  if (error || !project) {
    return (
      <AppLayout fullWidth>
        <Card className="p-6">
          <div className="text-xl font-semibold">Project not found</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {String((error as any)?.message ?? "No record returned.")}
          </div>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate("/projects")}>
              Back to Projects
            </Button>
          </div>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout fullWidth>
      <Card className="p-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          {/* Header row: title + tabs + Scale (far right) */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0">
                  <div className="text-2xl font-display font-bold tracking-tight">{project.name}</div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge>
                    <span>•</span>
                    <span className="truncate">{project.client_name || "No client set"}</span>
                    {saveState === "saving" ? (
                      <>
                        <span>•</span>
                        <span>Saving…</span>
                      </>
                    ) : saveState === "saved" ? (
                      <>
                        <span>•</span>
                        <span>Saved</span>
                      </>
                    ) : null}
                  </div>

                  <TabsList className="bg-transparent p-0 flex flex-wrap gap-2">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="takeoff">Takeoff</TabsTrigger>
                    <TabsTrigger value="estimating">Estimating</TabsTrigger>
                    <TabsTrigger value="proposal">Proposal</TabsTrigger>
                  </TabsList>
                </div>
              </div>
            </div>

            {/* Scale button only on Takeoff tab */}
            <div className="flex items-center justify-end">
              {activeTab === "takeoff" ? (
                <Button
                  size="sm"
                  title="Calibrate scale"
                  onClick={() => {
                    setTakeoffScaleTrigger((n) => n + 1);
                  }}
                >
                  Scale
                </Button>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div className="mt-5">
            {/* Overview */}
            <TabsContent value="overview">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Project Name</div>
                  <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Status</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ProjectStatus }))}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Client Name</div>
                  <Input value={form.client_name} onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))} placeholder="e.g., John Smith" />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Client Email</div>
                  <Input value={form.client_email} onChange={(e) => setForm((p) => ({ ...p, client_email: e.target.value }))} placeholder="e.g., client@email.com" />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Estimator</div>
                  <Input value={form.estimator_name} onChange={(e) => setForm((p) => ({ ...p, estimator_name: e.target.value }))} placeholder="e.g., Ceejay" />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Total Sales</div>
                  <Input value={`$${Number(project.total_sales || 0).toFixed(2)}`} disabled />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="text-sm font-semibold">Notes</div>
                  <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Add internal notes here…" className="min-h-[120px]" />
                </div>
              </div>
            </TabsContent>

            {/* Documents */}
            <TabsContent value="documents">
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold">Documents</div>
                  <div className="text-sm text-muted-foreground">
                    Upload plans (PDF). Files are stored in Supabase Storage bucket:
                    <span className="font-semibold"> project-documents</span>.
                  </div>
                </div>

                <Input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />

                <div className="pt-2">
                  <div className="text-sm font-semibold">Uploaded files</div>

                  <div className="mt-3 overflow-auto rounded-xl border border-border">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">File</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Size</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Uploaded</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docsLoading ? (
                          <tr>
                            <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                              Loading documents…
                            </td>
                          </tr>
                        ) : (documents?.length ?? 0) === 0 ? (
                          <tr>
                            <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                              No documents uploaded yet.
                            </td>
                          </tr>
                        ) : (
                          documents!.map((doc) => (
                            <tr key={doc.id} className="border-t border-border">
                              <td className="px-4 py-3 font-medium">{doc.file_name}</td>
                              <td className="px-4 py-3 text-muted-foreground">{formatBytes(doc.size_bytes)}</td>
                              <td className="px-4 py-3 text-muted-foreground">{new Date(doc.created_at).toLocaleString()}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" onClick={() => navigate(`/projects/${projectId}/documents/${doc.id}`)}>
                                    Open
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => void renameDocument(doc)}>
                                    Rename
                                  </Button>
                                  <Button variant="destructive" size="sm" onClick={() => void deleteDocument(doc)}>
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground">
                    Open a document to see its pages and rename them.
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Takeoff */}
            <TabsContent value="takeoff" className="mt-0">
              <div className="-mx-2 sm:-mx-4">
                <div className="h-[calc(100vh-260px)] min-h-[560px] bg-muted/20 rounded-xl border border-border overflow-hidden">
                  <TakeoffWorkspaceContent projectId={projectId!} embedded scaleTrigger={takeoffScaleTrigger} />
                </div>
              </div>
            </TabsContent>

            {/* Estimating */}
            <TabsContent value="estimating">
              <div className="text-sm text-muted-foreground">
                Placeholder. Next: Excel-like BOQ connected to takeoff quantities and assemblies.
              </div>
            </TabsContent>

            {/* Proposal */}
            <TabsContent value="proposal">
              <div className="text-sm text-muted-foreground">
                Placeholder. Next: print/export markups + estimate documents to PDF.
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </AppLayout>
  );
}
