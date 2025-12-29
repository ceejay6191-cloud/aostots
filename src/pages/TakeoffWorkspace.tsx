import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  status: string;
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
  project_id: string;
  owner_id: string;
  page_number: number;
  page_name: string | null;
};

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/* -----------------------------
   PDF Canvas Viewer (stable)
----------------------------- */
function PdfCanvasViewer({
  pdfDoc,
  pageNumber,
  scale,
  rotation,
  onViewport,
  onError,
}: {
  pdfDoc: any | null;
  pageNumber: number;
  scale: number;
  rotation: number;
  onViewport?: (vp: { width: number; height: number }) => void; // CSS px
  onError?: (msg: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const seqRef = useRef(0);

  const onViewportRef = useLatest(onViewport);
  const onErrorRef = useLatest(onError);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!pdfDoc || pageNumber < 1) return;

      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        // ignore
      }

      const seq = ++seqRef.current;

      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || seq !== seqRef.current) return;

        const viewport = page.getViewport({ scale, rotation });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        onViewportRef.current?.({ width: viewport.width, height: viewport.height });

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled || seq !== seqRef.current) return;
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        const isCancel =
          msg.toLowerCase().includes("cancel") ||
          e?.name === "RenderingCancelledException";
        if (!isCancel && !cancelled) {
          onErrorRef.current?.(e?.message ?? "Failed to render PDF page.");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        // ignore
      }
    };
  }, [pdfDoc, pageNumber, scale, rotation]);

  return <canvas ref={canvasRef} className="block bg-white" />;
}

/* -----------------------------
   Drag pan (scroll)
----------------------------- */
function useDragPan(scrollRef: React.RefObject<HTMLDivElement>, allowLeftDrag: boolean) {
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  function hasOverflow(el: HTMLDivElement) {
    return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
  }

  function canStart(e: React.PointerEvent, el: HTMLDivElement) {
    if (!hasOverflow(el)) return false;
    if (e.button === 2) return true; // right always
    if (allowLeftDrag && e.button === 0) return true; // left when pan tool
    return false;
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el) return;
    if (!canStart(e, el)) return;

    draggingRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;

    const last = lastRef.current;
    if (!last) return;

    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;

    el.scrollLeft -= dx;
    el.scrollTop -= dy;

    lastRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastRef.current = null;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  return { onPointerDown, onPointerMove, onPointerUp, onContextMenu };
}

function centerScroll(el: HTMLDivElement | null) {
  if (!el) return;
  if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
  el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
}

type Tool = "select" | "pan" | "line" | "area" | "count";

export default function TakeoffWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // Maximize drawing space: remove page scrollbar while this page is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const [tool, setTool] = useState<Tool>("select");

  // Scale display (button becomes text)
  const [scaleText, setScaleText] = useState<string | null>(null);
  const scaleTitle = scaleText ? "Rescale?" : "Set scale";

  // pdf state
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);

  const [viewPage, setViewPage] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.0);

  // sizing
  const [viewportPx, setViewportPx] = useState<{ width: number; height: number }>({
    width: 1,
    height: 1,
  });

  const viewerBoxRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // base size at scale=1 derived from viewport/zoom
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Fit-to-page behavior
  const [fitPending, setFitPending] = useState<boolean>(true);

  // Wheel-zoom anchor (keep zoom around cursor point)
  const wheelAnchorRef = useRef<{
    targetZoom: number;
    nx: number;
    ny: number;
    ox: number;
    oy: number;
  } | null>(null);

  const pan = useDragPan(scrollRef, tool === "pan");

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,client_name,status")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as ProjectRow;
    },
  });

  const { data: documents } = useQuery({
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

  useEffect(() => {
    if (!documents?.length) return;
    if (selectedDocId) return;
    setSelectedDocId(documents[0].id);
  }, [documents, selectedDocId]);

  const selectedDoc = useMemo(() => {
    if (!documents?.length) return null;
    return documents.find((d) => d.id === selectedDocId) ?? null;
  }, [documents, selectedDocId]);

  const { data: pages } = useQuery({
    queryKey: ["document-pages", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_pages")
        .select("id,document_id,project_id,owner_id,page_number,page_name")
        .eq("document_id", selectedDocId)
        .order("page_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  const pageCount = pages?.length ?? 0;

  async function getSignedPdfUrl(d: DocumentRow) {
    const { data, error } = await supabase.storage
      .from(d.bucket)
      .createSignedUrl(d.path, 60 * 10);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("No signed URL returned.");
    return data.signedUrl;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedDoc) return;

      try {
        setSignedUrl("");
        setPdfDoc(null);
        setViewPage(1);
        setRotation(0);
        setZoom(1.0);
        setFitPending(true);

        const url = await getSignedPdfUrl(selectedDoc);
        if (cancelled) return;
        setSignedUrl(url);

        const pdf = await getDocument(url).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
      } catch (e: any) {
        if (cancelled) return;
        toast({
          title: "Failed to load PDF",
          description: e?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDocId]);

  // Fit on open/page change/layout change
  useEffect(() => {
    setFitPending(true);
  }, [viewPage, rotation, leftOpen, rightOpen]);

  const fitToPage = useCallback(() => {
    const box = viewerBoxRef.current;
    const base = baseSizeRef.current;
    if (!box || !base || base.w <= 1 || base.h <= 1) return;

    // very small padding so we maximize drawing space
    const padding = 10;
    const w = Math.max(1, box.clientWidth - padding);
    const h = Math.max(1, box.clientHeight - padding);

    const nextZoom = Math.min(w / base.w, h / base.h);
    const clamped = Math.max(0.2, Math.min(3.0, Number(nextZoom.toFixed(4))));

    setZoom(clamped);
    setTimeout(() => centerScroll(scrollRef.current), 30);

    setFitPending(false);
  }, []);

  const handleViewport = useCallback(
    (vp: { width: number; height: number }) => {
      setViewportPx((prev) =>
        prev.width === vp.width && prev.height === vp.height ? prev : vp
      );

      const z = Math.max(0.01, zoom);
      baseSizeRef.current = { w: vp.width / z, h: vp.height / z };

      // apply wheel anchor after render/viewport updates (keeps cursor point stable)
      const anchor = wheelAnchorRef.current;
      if (anchor && scrollRef.current && baseSizeRef.current) {
        const base = baseSizeRef.current;
        const newW = base.w * anchor.targetZoom;
        const newH = base.h * anchor.targetZoom;

        scrollRef.current.scrollLeft = Math.max(0, anchor.nx * newW - anchor.ox);
        scrollRef.current.scrollTop = Math.max(0, anchor.ny * newH - anchor.oy);

        wheelAnchorRef.current = null;
      }

      if (fitPending) {
        requestAnimationFrame(() => fitToPage());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoom, fitPending, fitToPage]
  );

  const handleViewerError = useCallback((msg: string) => {
    toast({ title: "Viewer error", description: msg, variant: "destructive" });
  }, []);

  // Search sheets
  const [search, setSearch] = useState("");
  const filteredPages = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return pages ?? [];
    return (pages ?? []).filter((p) => {
      const name = (p.page_name ?? `Page ${p.page_number}`).toLowerCase();
      return name.includes(s);
    });
  }, [pages, search]);

  function onScaleClick() {
    if (!scaleText) {
      const next = window.prompt("Enter drawing scale (example: 1:100)", "1:100");
      if (!next) return;
      setScaleText(next.trim() || null);
      return;
    }

    const ok = window.confirm("Rescale? (this will replace the current scale)");
    if (!ok) return;

    const next = window.prompt("Enter drawing scale (example: 1:100)", scaleText);
    if (!next) return;
    setScaleText(next.trim() || null);
  }

  // Wheel zoom (scroll up/down)
  const onViewerWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!scrollRef.current || !baseSizeRef.current) return;

      // Always zoom on wheel per your request
      e.preventDefault();

      const el = scrollRef.current;
      const rect = el.getBoundingClientRect();

      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;

      const base = baseSizeRef.current;
      const oldW = base.w * zoom;
      const oldH = base.h * zoom;

      // cursor point in content coords
      const contentX = el.scrollLeft + ox;
      const contentY = el.scrollTop + oy;

      const nx = oldW > 1 ? contentX / oldW : 0.5;
      const ny = oldH > 1 ? contentY / oldH : 0.5;

      // wheel delta -> zoom factor
      // negative deltaY = zoom in, positive = zoom out
      const dir = e.deltaY < 0 ? 1 : -1;
      const step = 0.08; // smooth but fast enough
      const nextZoom = Math.max(0.2, Math.min(3.0, Number((zoom * (1 + dir * step)).toFixed(4))));

      wheelAnchorRef.current = {
        targetZoom: nextZoom,
        nx,
        ny,
        ox,
        oy,
      };

      setZoom(nextZoom);
    },
    [zoom]
  );

  // Hide scrollbars but keep scroll working
  const hideScrollbarStyle: React.CSSProperties = {
    scrollbarWidth: "none",
    msOverflowStyle: "none",
  };

  const viewerHeight = "calc(100vh - 210px)"; // tuned to maximize drawing space without page scrolling

  return (
    <AppLayout>
      {/* local css for webkit scrollbar */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Lock the page to viewport height (max drawing space) */}
      <div className="h-[calc(100vh-120px)] flex flex-col overflow-hidden">
        {/* Header row (tight) */}
        <div className="flex items-center justify-between gap-3 flex-none">
          <div className="min-w-0">
            <div className="text-xl font-bold truncate">{project?.name ?? "Takeoff"}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">Takeoff</Badge>
              {selectedDoc ? (
                <>
                  <span>•</span>
                  <span className="truncate">{selectedDoc.file_name}</span>
                  <span>•</span>
                  <span>
                    Page {viewPage}
                    {pageCount ? ` / ${pageCount}` : ""}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2 flex-none">
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>

            <Button variant="outline" title={scaleTitle} onClick={onScaleClick}>
              {scaleText ? `Scale: ${scaleText}` : "Scale"}
            </Button>
          </div>
        </div>

        {/* Workspace */}
        <div className="flex-1 overflow-hidden mt-3">
          <div className="h-full grid grid-cols-12 gap-3 overflow-hidden">
            {/* Left panel (Sheets) */}
            {leftOpen ? (
              <Card className="col-span-12 lg:col-span-3 p-2 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between flex-none">
                  <div className="text-sm font-medium">Sheets</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLeftOpen(false)}
                    title="Hide sheets"
                  >
                    {"<<"}
                  </Button>
                </div>

                <div className="mt-2 space-y-2 flex-none">
                  <div className="text-[11px] text-muted-foreground">Document</div>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                  >
                    {(documents ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.file_name}
                      </option>
                    ))}
                  </select>

                  <Input
                    className="h-9"
                    placeholder="Search sheets…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  <div className="text-[11px] text-muted-foreground">
                    {pageCount ? `${pageCount} page(s)` : "No pages in DB yet"}
                  </div>
                </div>

                <div
                  className="mt-2 flex-1 overflow-auto rounded-lg border border-border no-scrollbar"
                  style={hideScrollbarStyle}
                >
                  <div className="divide-y">
                    {filteredPages.length ? (
                      filteredPages.map((p) => {
                        const title = p.page_name?.trim() || `Page ${p.page_number}`;
                        const active = p.page_number === viewPage;
                        return (
                          <button
                            key={p.id}
                            className={`w-full text-left px-2 py-2 hover:bg-muted/40 ${
                              active ? "bg-muted/50" : ""
                            }`}
                            onClick={() => setViewPage(p.page_number)}
                          >
                            <div className="text-sm font-medium truncate">{title}</div>
                            <div className="text-[11px] text-muted-foreground">#{p.page_number}</div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-3 text-sm text-muted-foreground">No results.</div>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <div className="col-span-12 lg:col-span-1 flex items-start">
                <Button variant="outline" size="sm" onClick={() => setLeftOpen(true)} title="Show sheets">
                  {">>"}
                </Button>
              </div>
            )}

            {/* Center viewer (maximized) */}
            <Card
              className={`p-2 overflow-hidden flex flex-col ${
                leftOpen && rightOpen
                  ? "col-span-12 lg:col-span-6"
                  : leftOpen || rightOpen
                  ? "col-span-12 lg:col-span-8"
                  : "col-span-12 lg:col-span-10"
              }`}
            >
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 flex-none">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={tool === "select" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTool("select")}
                  >
                    Select
                  </Button>
                  <Button
                    variant={tool === "pan" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTool("pan")}
                  >
                    Pan
                  </Button>
                  <Button variant={tool === "line" ? "default" : "outline"} size="sm" disabled>
                    Line
                  </Button>
                  <Button variant={tool === "area" ? "default" : "outline"} size="sm" disabled>
                    Area
                  </Button>
                  <Button variant={tool === "count" ? "default" : "outline"} size="sm" disabled>
                    Count
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewPage((p) => Math.max(1, p - 1))}
                    disabled={viewPage <= 1}
                    title="Previous page"
                  >
                    ◀
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setViewPage((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))
                    }
                    disabled={pageCount ? viewPage >= pageCount : false}
                    title="Next page"
                  >
                    ▶
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.1).toFixed(2))))}
                    title="Zoom out"
                  >
                    -
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.1).toFixed(2))))}
                    title="Zoom in"
                  >
                    +
                  </Button>

                  <Button variant="outline" size="sm" onClick={() => setFitPending(true)}>
                    Fit
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                  >
                    Rotate
                  </Button>

                  <Badge variant="secondary">{Math.round(zoom * 100)}%</Badge>
                </div>
              </div>

              {/* Viewer */}
              <div className="mt-2 flex-1 overflow-hidden">
                <div
                  ref={viewerBoxRef}
                  className="rounded-xl border border-border bg-muted/10 overflow-hidden"
                  style={{ height: viewerHeight }}
                >
                  <div
                    ref={scrollRef}
                    className="h-full w-full overflow-auto no-scrollbar"
                    style={hideScrollbarStyle}
                    onPointerDown={pan.onPointerDown}
                    onPointerMove={pan.onPointerMove}
                    onPointerUp={pan.onPointerUp}
                    onContextMenu={pan.onContextMenu}
                    onWheel={onViewerWheel}
                    // Important: allow preventDefault on wheel zoom
                    // (React wheel is non-passive, so this works)
                  >
                    <div className="p-1">
                      <div
                        className="relative inline-block"
                        style={{ width: viewportPx.width, height: viewportPx.height }}
                      >
                        {!signedUrl || !pdfDoc ? (
                          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                            {documents?.length
                              ? "Loading document…"
                              : "Upload a PDF in Documents tab first."}
                          </div>
                        ) : (
                          <PdfCanvasViewer
                            pdfDoc={pdfDoc}
                            pageNumber={viewPage}
                            scale={zoom}
                            rotation={rotation}
                            onViewport={handleViewport}
                            onError={handleViewerError}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-1 text-[11px] text-muted-foreground">
                  Wheel = zoom • Pan: {tool === "pan" ? "left-drag or right-drag" : "right-drag"}
                </div>
              </div>
            </Card>

            {/* Right panel (Properties) */}
            {rightOpen ? (
              <Card className="col-span-12 lg:col-span-3 p-2 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between flex-none">
                  <div className="text-sm font-medium">Properties</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRightOpen(false)}
                    title="Hide properties"
                  >
                    {">>"}
                  </Button>
                </div>

                <div className="mt-2 space-y-2 overflow-auto no-scrollbar" style={hideScrollbarStyle}>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-sm font-medium">Drawing Scale</div>
                    <div className="text-xs text-muted-foreground">
                      {scaleText ? `Current: ${scaleText}` : "Not defined yet"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <div className="text-sm font-medium">Selected</div>
                    <div className="text-xs text-muted-foreground">
                      {tool === "select" ? "No selection (tools coming next)" : "Tool active"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <div className="text-sm font-medium">Quick actions</div>
                    <div className="mt-2 flex gap-2">
                      <Button variant="outline" size="sm" disabled>
                        Undo
                      </Button>
                      <Button variant="outline" size="sm" disabled>
                        Redo
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <div className="col-span-12 lg:col-span-1 flex items-start justify-end">
                <Button variant="outline" size="sm" onClick={() => setRightOpen(true)} title="Show properties">
                  {"<<"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
