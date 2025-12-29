import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

// UI
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

// Data
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABELS, ProjectStatus } from "@/types/project";

// PDF.js
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
};

type DocumentRow = {
  id: string;
  project_id: string;
  owner_id: string;
  bucket: string;
  path: string;
  file_name: string;
  created_at: string;
};

type PageRow = {
  id: string;
  document_id: string;
  page_number: number;
  label: string | null;
};

type Size = { w: number; h: number };
type Point = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function useResizeObserverSize(ref: React.RefObject<HTMLElement>, enabled: boolean) {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });

    ro.observe(el);

    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });

    return () => ro.disconnect();
  }, [ref, enabled]);

  return size;
}

/**
 * Takeoff workspace content.
 * - embedded: used inside ProjectDetails tab (no AppLayout wrapper, no duplicate heading)
 * - standalone (default export): used on /projects/:projectId/takeoff route
 */
export function TakeoffWorkspaceContent({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();

  // ----------------------------
  // Layout / panels
  // ----------------------------
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // ----------------------------
  // Scale (Option B UI behaviour)
  // ----------------------------
  const [scaleText, setScaleText] = useState<string | null>(null);
  const scaleTitle = scaleText ? "Rescale?" : "Scale";
  const scaleButtonLabel = scaleText ?? "Scale";

  function onScaleClick() {
    if (scaleText) {
      const ok = window.confirm("Replace existing scale?");
      if (!ok) return;
    }
    const next = window.prompt(
      "Enter drawing scale (e.g., 1:100, 1/4\"=1'-0\"):",
      scaleText ?? ""
    );
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    setScaleText(trimmed);
    toast({ title: "Scale set", description: trimmed });
  }

  // ----------------------------
  // Project, documents, pages
  // ----------------------------
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,status")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as ProjectRow;
    },
  });

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
  useEffect(() => {
    if (activeDocId) return;
    if (documents.length) setActiveDocId(documents[0].id);
  }, [documents, activeDocId]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  const { data: pages = [] } = useQuery({
    queryKey: ["document_pages", activeDocId],
    enabled: !!activeDocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_pages")
        .select("id,document_id,page_number,label")
        .eq("document_id", activeDocId)
        .order("page_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  // ----------------------------
  // PDF state
  // ----------------------------
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [signedUrl, setSignedUrl] = useState<string>("");

  // ----------------------------
  // Viewer state (fit + zoom + pan + rotate)
  // ----------------------------
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerSize = useResizeObserverSize(viewerRef, true);

  const [rotation, setRotation] = useState(0); // 0/90/180/270
  const [zoom, setZoom] = useState(1); // CSS zoom
  const [fitMode, setFitMode] = useState(true);
  const [fitPending, setFitPending] = useState(false);

  const [canvasSize, setCanvasSize] = useState<Size>({ w: 0, h: 0 });
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  const renderTaskRef = useRef<RenderTask | null>(null);

  function clampPan(next: Point, vs: Size, cs: Size, z: number) {
    if (vs.w <= 0 || vs.h <= 0 || cs.w <= 0 || cs.h <= 0) return next;

    const scaledW = cs.w * z;
    const scaledH = cs.h * z;

    const centerX = (vs.w - scaledW) / 2;
    const centerY = (vs.h - scaledH) / 2;

    if (scaledW <= vs.w) next.x = centerX;
    else next.x = clamp(next.x, vs.w - scaledW, 0);

    if (scaledH <= vs.h) next.y = centerY;
    else next.y = clamp(next.y, vs.h - scaledH, 0);

    return next;
  }

  function requestFit() {
    setFitMode(true);
    setFitPending(true);
  }

  // Fit when page changes / rotation changes
  useEffect(() => {
    requestFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, rotation]);

  // Keep pan clamped on resize/zoom
  useEffect(() => {
    setPan((p) => clampPan({ ...p }, viewerSize, canvasSize, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerSize.w, viewerSize.h, canvasSize.w, canvasSize.h, zoom]);

  // ----------------------------
  // Signed URL + load PDF when activeDoc changes
  // ----------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPdfDoc(null);
        setPdfNumPages(0);
        setSignedUrl("");
        setPageNumber(1);
        setRotation(0);
        setZoom(1);
        setFitMode(true);
        setFitPending(false);
        setCanvasSize({ w: 0, h: 0 });
        setPan({ x: 0, y: 0 });

        if (!activeDoc) return;

        const { data, error } = await supabase.storage
          .from(activeDoc.bucket)
          .createSignedUrl(activeDoc.path, 60 * 10);

        if (error) throw error;
        if (!data?.signedUrl) throw new Error("No signed URL returned.");

        if (cancelled) return;

        setSignedUrl(data.signedUrl);

        const pdf = await getDocument(data.signedUrl).promise;
        if (cancelled) return;

        setPdfDoc(pdf);
        setPdfNumPages(pdf.numPages);
        setPageNumber(1);
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: "Failed to open PDF",
          description: e?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDoc]);

  // ----------------------------
  // Render current page to canvas
  // ----------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!pdfDoc) return;
        if (!canvasRef.current) return;

        const safePage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePage);

        // Cancel previous task (prevents render stacking)
        renderTaskRef.current?.cancel();
        renderTaskRef.current = null;

        // Quality scale for rendering (actual pixels). Zoom is CSS.
        const RENDER_SCALE = 1.5;
        const viewport = page.getViewport({ scale: RENDER_SCALE, rotation });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setCanvasSize({ w: canvas.width, h: canvas.height });

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        renderTaskRef.current = null;

        if (cancelled) return;

        // Compute fit zoom when requested
        if (fitPending && viewerSize.w > 0 && viewerSize.h > 0) {
          const fitZ = Math.min(viewerSize.w / canvas.width, viewerSize.h / canvas.height);
          const clampedFitZ = clamp(fitZ, 0.2, 6);
          setZoom(clampedFitZ);
          setFitPending(false);

          // Center after fit
          setPan(() =>
            clampPan({ x: 0, y: 0 }, viewerSize, { w: canvas.width, h: canvas.height }, clampedFitZ)
          );
        } else {
          setPan((p) => clampPan({ ...p }, viewerSize, { w: canvas.width, h: canvas.height }, zoom));
        }
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name) === "RenderingCancelledException") return;
        toast({
          title: "Viewer error",
          description: e?.message ?? "Failed to render page",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageNumber, rotation, fitPending, viewerSize.w, viewerSize.h]);

  // ----------------------------
  // Pan / zoom handlers
  // ----------------------------
  const dragRef = useRef<{ dragging: boolean; startMouse: Point; startPan: Point }>({
    dragging: false,
    startMouse: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
  });

  function stopDrag() {
    dragRef.current.dragging = false;
  }

  useEffect(() => {
    const up = () => stopDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current.dragging = true;
    dragRef.current.startMouse = { x: e.clientX, y: e.clientY };
    dragRef.current.startPan = { ...pan };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.dragging) return;
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startMouse.x;
    const dy = e.clientY - dragRef.current.startMouse.y;

    setFitMode(false);
    setPan(
      clampPan(
        { x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy },
        viewerSize,
        canvasSize,
        zoom
      )
    );
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();

    // wheel down (positive deltaY) -> zoom out
    const direction = e.deltaY > 0 ? -1 : 1;
    const step = 0.08;

    const nextZoom = clamp(Number((zoom * (1 + direction * step)).toFixed(3)), 0.2, 6.0);
    setFitMode(false);

    // Zoom around cursor
    const rect = (viewerRef.current ?? e.currentTarget).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const beforeX = (mx - pan.x) / zoom;
    const beforeY = (my - pan.y) / zoom;

    const nextPan: Point = {
      x: mx - beforeX * nextZoom,
      y: my - beforeY * nextZoom,
    };

    setZoom(nextZoom);
    setPan(() => clampPan(nextPan, viewerSize, canvasSize, nextZoom));
  }

  // ----------------------------
  // Sheets + page list UI
  // ----------------------------
  const [sheetSearch, setSheetSearch] = useState("");

  const effectivePages = useMemo(() => {
    const fallbackCount = pdfNumPages || 0;

    const byNumber = new Map<number, PageRow>();
    for (const p of pages) byNumber.set(p.page_number, p);

    const count = fallbackCount || Math.max(0, ...pages.map((p) => p.page_number), 0);

    const out: { page: number; label: string }[] = [];
    for (let i = 1; i <= count; i++) {
      const row = byNumber.get(i);
      out.push({ page: i, label: row?.label?.trim() || `Page ${i}` });
    }

    const q = sheetSearch.trim().toLowerCase();
    if (!q) return out;
    return out.filter((x) => x.label.toLowerCase().includes(q) || String(x.page).includes(q));
  }, [pages, pdfNumPages, sheetSearch]);

  return (
    <div className="h-full w-full bg-muted/20 overflow-hidden">
      {/* Standalone-only compact title row (prevents “double heading” when embedded) */}
      {!embedded ? (
        <div className="flex items-center justify-between gap-3 border-b bg-background px-4 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-semibold truncate">{project?.name ?? "Takeoff"}</div>
              {project?.status ? <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge> : null}
              <span className="text-xs text-muted-foreground truncate">
                {activeDoc?.file_name ? `• ${activeDoc.file_name}` : ""}
              </span>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
            Back to project
          </Button>
        </div>
      ) : null}

      {/* Workspace */}
      <div
        className={[
          "grid h-full grid-cols-[auto_1fr_auto] overflow-hidden",
          embedded ? "" : "h-[calc(100%-41px)]",
        ].join(" ")}
      >
        {/* Left panel */}
        {leftOpen ? (
          <div className="w-[280px] border-r bg-background overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="text-sm font-semibold">Sheets</div>
              <Button variant="ghost" size="sm" onClick={() => setLeftOpen(false)} title="Hide sheets">
                {"<<"}
              </Button>
            </div>

            <div className="p-3 space-y-3">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Document</div>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
              </div>

              <Input placeholder="Search sheets..." value={sheetSearch} onChange={(e) => setSheetSearch(e.target.value)} />
              <div className="text-xs text-muted-foreground">{effectivePages.length} page(s)</div>
            </div>

            <div className="h-[calc(100%-156px)] overflow-auto no-scrollbar">
              <div className="divide-y">
                {effectivePages.map((p) => (
                  <button
                    key={p.page}
                    className={[
                      "w-full px-3 py-2 text-left hover:bg-muted/50",
                      pageNumber === p.page ? "bg-muted/50" : "",
                    ].join(" ")}
                    onClick={() => setPageNumber(p.page)}
                  >
                    <div className="text-sm font-medium truncate">{p.label}</div>
                    <div className="text-xs text-muted-foreground">#{p.page}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-r bg-background flex items-start">
            <Button variant="ghost" size="sm" className="m-2" onClick={() => setLeftOpen(true)} title="Show sheets">
              {">>"}
            </Button>
          </div>
        )}

        {/* Center viewer */}
        <div className="bg-muted/20 overflow-hidden">
          {/* Toolbar (no extra heading / no white card) */}
          <div className="border-b bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={!pdfNumPages || pageNumber <= 1}
                >
                  ◀
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.min(pdfNumPages || p + 1, p + 1))}
                  disabled={!pdfNumPages || pageNumber >= pdfNumPages}
                >
                  ▶
                </Button>
              </div>

              <div className="h-6 w-px bg-border" />

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFitMode(false);
                  setZoom((z) => clamp(Number((z * 0.9).toFixed(3)), 0.2, 6));
                }}
              >
                -
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFitMode(false);
                  setZoom((z) => clamp(Number((z * 1.1).toFixed(3)), 0.2, 6));
                }}
              >
                +
              </Button>

              <Button variant="outline" size="sm" onClick={requestFit}>
                Fit
              </Button>

              <Button variant="outline" size="sm" onClick={() => setRotation((r) => (r + 90) % 360)}>
                Rotate
              </Button>

              <div className="ml-auto flex items-center gap-3">
                <div className="text-xs text-muted-foreground">
                  {fitMode ? "Fit" : `${Math.round(zoom * 100)}%`} • Wheel to zoom
                </div>

                <Button variant={scaleText ? "outline" : "default"} size="sm" onClick={onScaleClick} title={scaleTitle}>
                  {scaleButtonLabel}
                </Button>
              </div>
            </div>
          </div>

          {/* Viewer */}
          <div className="h-[calc(100%-44px)] p-0">
            <div
              ref={viewerRef}
              className="h-full w-full overflow-hidden bg-white relative select-none"
              onContextMenu={(e) => e.preventDefault()}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={stopDrag}
              onMouseLeave={stopDrag}
              onWheel={onWheel}
            >
              {!signedUrl || !pdfDoc ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {activeDoc ? "Loading PDF…" : "Upload a PDF in Documents to start takeoff."}
                </div>
              ) : (
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: "top left",
                      width: `${canvasSize.w}px`,
                      height: `${canvasSize.h}px`,
                    }}
                  >
                    <canvas ref={canvasRef} className="block bg-white" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        {rightOpen ? (
          <div className="w-[320px] border-l bg-background overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="text-sm font-semibold">Properties</div>
              <Button variant="ghost" size="sm" onClick={() => setRightOpen(false)} title="Hide properties">
                {">>"}
              </Button>
            </div>

            <div className="h-[calc(100%-44px)] overflow-auto no-scrollbar p-3 space-y-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold text-muted-foreground">Drawing Scale</div>
                <div className="mt-1 text-sm">{scaleText ?? "Not defined yet"}</div>
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={onScaleClick} title={scaleTitle}>
                    {scaleText ? "Rescale" : "Set scale"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold text-muted-foreground">Selected</div>
                <div className="mt-1 text-sm text-muted-foreground">None (tools coming next)</div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold text-muted-foreground">Quick actions</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" disabled>
                    Undo
                  </Button>
                  <Button size="sm" variant="outline" disabled>
                    Redo
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-l bg-background flex items-start">
            <Button variant="ghost" size="sm" className="m-2" onClick={() => setRightOpen(true)} title="Show properties">
              {"<<"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TakeoffWorkspace() {
  const { projectId } = useParams();

  if (!projectId) {
    return (
      <AppLayout>
        <div className="p-6">Missing projectId</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout mode="takeoff">
      <TakeoffWorkspaceContent projectId={projectId} />
    </AppLayout>
  );
}
