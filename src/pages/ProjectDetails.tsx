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
import TakeoffWorkspace from "@/pages/TakeoffWorkspace";

// shadcn dialog
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// PDF.js
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

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

type Size = { w: number; h: number };
type Point = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const statusOptions = useMemo(
    () => Object.keys(STATUS_LABELS) as ProjectStatus[],
    []
  );

  // ---------------------------
  // In-app PDF Preview Modal (fixed header + constrained viewer + right-drag pan)
  // ---------------------------
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDocRow, setPreviewDocRow] = useState<DocumentRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number>(0);

  const [previewPage, setPreviewPage] = useState<number>(1);

  // Render scale is for PDF quality; viewZoom is the user zoom (CSS transform)
  const RENDER_SCALE = 1.5;
  const [viewZoom, setViewZoom] = useState<number>(1.0); // user zoom, CSS only
  const [rotation, setRotation] = useState<number>(0); // 0/90/180/270
  const [rendering, setRendering] = useState(false);

  // Viewer constraint + pan
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewerSize, setViewerSize] = useState<Size>({ w: 0, h: 0 });
  const [canvasSize, setCanvasSize] = useState<Size>({ w: 0, h: 0 });

  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    startMouse: Point;
    startPan: Point;
  }>({ dragging: false, startMouse: { x: 0, y: 0 }, startPan: { x: 0, y: 0 } });

  function clampPan(next: Point, vs = viewerSize, cs = canvasSize, z = viewZoom) {
    const scaledW = cs.w * z;
    const scaledH = cs.h * z;

    if (vs.w <= 0 || vs.h <= 0 || cs.w <= 0 || cs.h <= 0) return next;

    // Center positions when content is smaller than viewport
    const centerX = (vs.w - scaledW) / 2;
    const centerY = (vs.h - scaledH) / 2;

    // X clamp
    if (scaledW <= vs.w) {
      next.x = centerX;
    } else {
      // Keep content covering viewport (no big empty space)
      const minX = vs.w - scaledW;
      const maxX = 0;
      next.x = clamp(next.x, minX, maxX);
    }

    // Y clamp
    if (scaledH <= vs.h) {
      next.y = centerY;
    } else {
      const minY = vs.h - scaledH;
      const maxY = 0;
      next.y = clamp(next.y, minY, maxY);
    }

    return next;
  }

  function resetViewToDefault() {
    setViewZoom(1.0);
    setPan({ x: 0, y: 0 }); // will be centered by clamp once sizes are known
  }

  // Observe viewer size so the "red area" is the constraint box
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setViewerSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    });
    ro.observe(el);

    // init
    const rect = el.getBoundingClientRect();
    setViewerSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });

    return () => ro.disconnect();
  }, [previewOpen]);

  // Keep pan valid when zoom or sizes change
  useEffect(() => {
    setPan((p) => clampPan({ ...p }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewZoom, viewerSize.w, viewerSize.h, canvasSize.w, canvasSize.h]);

  // Stop dragging even if mouseup happens outside viewer
  useEffect(() => {
    const up = () => stopDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prevent browser context menu on the viewer (right-click is for pan)
  function onViewerContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  function onViewerMouseDown(e: React.MouseEvent) {
    // right click drag to pan
    if (e.button !== 2) return;
    e.preventDefault();
    dragRef.current.dragging = true;
    dragRef.current.startMouse = { x: e.clientX, y: e.clientY };
    dragRef.current.startPan = { ...pan };
  }

  function onViewerMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.dragging) return;
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startMouse.x;
    const dy = e.clientY - dragRef.current.startMouse.y;

    const next = clampPan({
      x: dragRef.current.startPan.x + dx,
      y: dragRef.current.startPan.y + dy,
    });

    setPan(next);
  }

  function stopDrag() {
    dragRef.current.dragging = false;
  }

  // When closing modal, clear PDF state
  useEffect(() => {
    if (!previewOpen) {
      setPreviewDocRow(null);
      setPreviewUrl("");
      setPdfDoc(null);
      setPdfNumPages(0);
      setPreviewPage(1);
      setViewZoom(1.0);
      setRotation(0);
      setRendering(false);
      setPan({ x: 0, y: 0 });
      setCanvasSize({ w: 0, h: 0 });
    }
  }, [previewOpen]);

  // Render PDF page onto canvas (quality render at fixed RENDER_SCALE)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!previewOpen) return;
      if (!pdfDoc) return;
      if (!canvasRef.current) return;

      const safePage = Math.min(Math.max(1, previewPage), pdfDoc.numPages);

      setRendering(true);
      try {
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: RENDER_SCALE, rotation });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        setCanvasSize({ w: canvas.width, h: canvas.height });

        const renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;

        // After render, enforce default centered state (especially after page changes)
        if (!cancelled) {
          setPan(() =>
            clampPan(
              { x: 0, y: 0 },
              viewerSize,
              { w: canvas.width, h: canvas.height },
              viewZoom
            )
          );
        }
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: "Viewer error",
          description: e?.message ?? "Failed to render page",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, pdfDoc, previewPage, rotation]);

  async function openDocumentInModal(doc: DocumentRow) {
    try {
      setPreviewDocRow(doc);
      setPreviewUrl("");
      setPdfDoc(null);
      setPdfNumPages(0);
      setPreviewPage(1);

      // default view on open
      resetViewToDefault();
      setRotation(0);
      setCanvasSize({ w: 0, h: 0 });

      setPreviewOpen(true);

      const { data, error } = await supabase.storage
        .from(doc.bucket)
        .createSignedUrl(doc.path, 60 * 10);

      if (error) throw error;
      if (!data?.signedUrl) throw new Error("No signed URL returned.");

      setPreviewUrl(data.signedUrl);

      const pdf = await getDocument(data.signedUrl).promise;
      setPdfDoc(pdf);
      setPdfNumPages(pdf.numPages);

      // page starts at 1 and will render centered
      setPreviewPage(1);
    } catch (e: any) {
      toast({
        title: "Open failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
      setPreviewOpen(false);
    }
  }

  // ---------------------------
  // Project query
  // ---------------------------
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

  // ---------------------------
  // Documents query
  // ---------------------------
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

  // Local editable form state
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

  // ---------------------------
  // Save project mutation
  // ---------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Missing projectId");

      const payload = {
        name: form.name.trim(),
        client_name: form.client_name.trim() || null,
        client_email: form.client_email.trim() || null,
        estimator_name: form.estimator_name.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };

      const { error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", projectId);

      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Saved", description: "Project details updated." });
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: any) => {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // ---------------------------
  // Upload
  // ---------------------------
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

  // ---------------------------
  // Document actions
  // ---------------------------
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

    const { error: dbErr } = await supabase
      .from("project_documents")
      .delete()
      .eq("id", doc.id);

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

  // ---------------------------
  // Loading / error states
  // ---------------------------
  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <div className="text-2xl font-bold">Project</div>
          <Card className="p-6">Loading…</Card>
        </div>
      </AppLayout>
    );
  }

  if (error || !project) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">Project not found</div>
            <Button variant="outline" onClick={() => navigate("/projects")}>
              Back to Projects
            </Button>
          </div>
          <Card className="p-6">
            <div className="text-sm text-muted-foreground">
              {String((error as any)?.message ?? "No record returned.")}
            </div>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-3xl font-display font-bold tracking-tight">{project.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge>
              <span>•</span>
              <span>{project.client_name || "No client set"}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/projects")}>
              Back
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <div className="rounded-xl border border-border bg-card p-2">
            <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="takeoff">Takeoff</TabsTrigger>
              <TabsTrigger value="estimating">Estimating</TabsTrigger>
              <TabsTrigger value="proposal">Proposal</TabsTrigger>
            </TabsList>
          </div>

          {/* Overview */}
          <TabsContent value="overview" className="mt-6">
            <Card className="p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Project Name</div>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Status</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.status}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, status: e.target.value as ProjectStatus }))
                    }
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
                  <Input
                    value={form.client_name}
                    onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))}
                    placeholder="e.g., John Smith"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Client Email</div>
                  <Input
                    value={form.client_email}
                    onChange={(e) => setForm((p) => ({ ...p, client_email: e.target.value }))}
                    placeholder="e.g., client@email.com"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Estimator</div>
                  <Input
                    value={form.estimator_name}
                    onChange={(e) => setForm((p) => ({ ...p, estimator_name: e.target.value }))}
                    placeholder="e.g., Ceejay"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold">Total Sales</div>
                  <Input value={`$${Number(project.total_sales || 0).toFixed(2)}`} disabled />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="text-sm font-semibold">Notes</div>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Add internal notes here…"
                    className="min-h-[120px]"
                  />
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Documents */}
          <TabsContent value="documents" className="mt-6">
            <Card className="p-6 space-y-4">
              <div>
                <div className="text-lg font-semibold">Documents</div>
                <div className="text-sm text-muted-foreground">
                  Upload plans (PDF) for viewing and later takeoff. Files are stored in Supabase Storage bucket:
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
                <div className="text-sm text-muted-foreground">
                  This list comes from <span className="font-semibold">project_documents</span>.
                </div>

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
                            <td className="px-4 py-3 text-muted-foreground">
                              {new Date(doc.created_at).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void openDocumentInModal(doc)}
                                >
                                  Open
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => void renameDocument(doc)}>
                                  Rename
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void deleteDocument(doc)}
                                >
                                  Delete
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => navigate(`/projects/${projectId}/documents/${doc.id}`)}
                                >
                                  Pages
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
                  “Pages” is the next workflow screen (page list + rename + auto-region naming).
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Takeoff */}
          <TabsContent value="takeoff" className="mt-6">
  {projectId ? <TakeoffWorkspace projectId={projectId} /> : null}
</TabsContent>


          {/* Estimating */}
          <TabsContent value="estimating" className="mt-6">
            <Card className="p-6 space-y-2">
              <div className="text-lg font-semibold">Estimating</div>
              <div className="text-sm text-muted-foreground">
                Placeholder. Next: Excel-like BOQ connected to takeoff quantities and assemblies.
              </div>
            </Card>
          </TabsContent>

          {/* Proposal */}
          <TabsContent value="proposal" className="mt-6">
            <Card className="p-6 space-y-2">
              <div className="text-lg font-semibold">Proposal</div>
              <div className="text-sm text-muted-foreground">
                Placeholder. Next: print/export markups + estimate documents to PDF.
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* In-app PDF Preview Modal
          - Yellow header is fixed
          - Red viewer is constrained
          - Zoom scales inside
          - Right-click drag pans (clamped)
          - Page change resets to centered @ 100%
      */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 overflow-hidden">
          <div className="flex flex-col h-full overflow-hidden">
            {/* Fixed header */}
            <DialogHeader className="px-4 py-3 border-b flex-none">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {previewDocRow?.file_name ?? "Document"}
                    {pdfNumPages ? ` — Page ${previewPage} / ${pdfNumPages}` : ""}
                  </DialogTitle>
                  <div className="text-xs text-muted-foreground">
                    {rendering ? "Rendering…" : pdfDoc ? "Ready" : "Loading…"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetViewToDefault();
                      setPreviewPage((p) => Math.max(1, p - 1));
                    }}
                    disabled={!pdfNumPages || previewPage <= 1}
                    title="Previous page"
                  >
                    ◀
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetViewToDefault();
                      setPreviewPage((p) => Math.min(pdfNumPages || p + 1, p + 1));
                    }}
                    disabled={!pdfNumPages || previewPage >= pdfNumPages}
                    title="Next page"
                  >
                    ▶
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewZoom((z) => Math.max(0.6, Number((z - 0.1).toFixed(2))))}
                    title="Zoom out"
                  >
                    -
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewZoom((z) => Math.min(3.0, Number((z + 0.1).toFixed(2))))}
                    title="Zoom in"
                  >
                    +
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // rotation keeps same page; also recenters
                      resetViewToDefault();
                      setRotation((r) => (r + 90) % 360);
                    }}
                    title="Rotate 90°"
                  >
                    Rotate
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => {
                      setPreviewOpen(false);
                      setActiveTab("takeoff");
                    }}
                  >
                    Go to takeoff
                  </Button>

                  <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* Constrained viewer area */}
            <div className="flex-1 overflow-hidden bg-muted/20">
              <div className="h-full w-full p-4 overflow-hidden">
                <div
                  ref={viewerRef}
                  className="h-full w-full overflow-hidden rounded-lg border bg-white relative select-none"
                  onContextMenu={(e) => e.preventDefault()}
                  onMouseDown={(e) => {
                    if (e.button !== 2) return;
                    e.preventDefault();
                    dragRef.current.dragging = true;
                    dragRef.current.startMouse = { x: e.clientX, y: e.clientY };
                    dragRef.current.startPan = { ...pan };
                  }}
                  onMouseMove={(e) => {
                    if (!dragRef.current.dragging) return;
                    e.preventDefault();
                    const dx = e.clientX - dragRef.current.startMouse.x;
                    const dy = e.clientY - dragRef.current.startMouse.y;
                    setPan(
                      clampPan({
                        x: dragRef.current.startPan.x + dx,
                        y: dragRef.current.startPan.y + dy,
                      })
                    );
                  }}
                  onMouseUp={stopDrag}
                  onMouseLeave={stopDrag}
                >
                  {!previewUrl || !pdfDoc ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      Loading document…
                    </div>
                  ) : (
                    <div className="absolute inset-0 overflow-hidden">
                      {/* Pan/zoom wrapper is clipped by the viewer box */}
                      <div
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${viewZoom})`,
                          transformOrigin: "top left",
                          width: `${canvasSize.w}px`,
                          height: `${canvasSize.h}px`,
                        }}
                      >
                        <canvas ref={canvasRef} className="block bg-white" />
                      </div>

                      <div className="absolute bottom-2 left-2 text-[11px] text-muted-foreground bg-white/80 px-2 py-1 rounded border">
                        Right-click + drag to pan • Zoom: {viewZoom.toFixed(2)} • Rotation: {rotation}°
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}