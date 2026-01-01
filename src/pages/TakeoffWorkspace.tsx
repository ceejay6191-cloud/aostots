import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

// UI
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

// Supabase types in this repo are currently generated only for the "projects" table.
// Use an untyped client for other tables (project_documents, document_pages, etc.) to avoid TS errors.
const db = supabase as any;

/**
 * B4 PERFORMANCE MODEL:
 * - PDF.js renders at a constant scale (PDF_RENDER_SCALE) once per page/rotation.
 * - UI zoom is CSS-only (wrapper sizing + scroll). No PDF re-render on zoom.
 * - Fit runs once per page open (doc+page+rotation key).
 * - Calibration uses an in-app Dialog (NOT window.prompt) to avoid UI "freezing".
 */
const PDF_RENDER_SCALE = 1.5;



// Hide scrollbar but keep scroll functionality
const hideScrollbarStyle: React.CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  client_email: string | null;
  status: ProjectStatus;
  total_sales: number | null;
created_at: string;
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

type Size = { width: number; height: number };
type Point = { x: number; y: number };

type Tool = "select" | "pan" | "measure" | "line" | "area" | "count" | "scale";

type Calibration = {
  metersPerDocPx: number;
  displayUnit: "m" | "cm" | "mm" | "ft" | "in";
  label?: string;
};

type TakeoffItem =
  | {
      id: string;
      kind: "measure" | "line";
      page: number;
      a: Point;
      b: Point;
    }
  | {
      id: string;
      kind: "count";
      page: number;
      p: Point;
      /** Optional label/value for UI display (defaults shown if undefined). */
      label?: string;
      value?: number;
    }
  | {
      id: string;
      kind: "area";
      page: number;
      pts: Point[];
    };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function polygonArea(pts: Point[]) {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(sum) / 2;
}

function unitToMetersFactor(unit: Calibration["displayUnit"]) {
  switch (unit) {
    case "m":
      return 1;
    case "cm":
      return 0.01;
    case "mm":
      return 0.001;
    case "ft":
      return 0.3048;
    case "in":
      return 0.0254;
  }
}

function formatLength(meters: number, unit: Calibration["displayUnit"]) {
  const factor = unitToMetersFactor(unit);
  const v = meters / factor;
  if (unit === "mm") return `${Math.round(v)} mm`;
  if (unit === "cm") return `${v.toFixed(1)} cm`;
  if (unit === "m") return `${v.toFixed(2)} m`;
  if (unit === "ft") return `${v.toFixed(2)} ft`;
  if (unit === "in") return `${v.toFixed(1)} in`;
  return `${meters.toFixed(2)} m`;
}

function formatArea(m2: number, unit: Calibration["displayUnit"]) {
  const factor = unitToMetersFactor(unit);
  const v = m2 / (factor * factor);
  if (unit === "mm") return `${Math.round(v)} mm²`;
  if (unit === "cm") return `${v.toFixed(1)} cm²`;
  if (unit === "m") return `${v.toFixed(2)} m²`;
  if (unit === "ft") return `${v.toFixed(2)} ft²`;
  if (unit === "in") return `${v.toFixed(1)} in²`;
  return `${m2.toFixed(2)} m²`;
}

function safeId() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function useResizeObserverSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });

    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });

    return () => ro.disconnect();
  }, [ref]);

  return size;
}

/**
 * Pan by dragging the scroll container.
 */
function useDragPan({
  containerRef,
  enabled,
}: {
  containerRef: React.RefObject<HTMLElement>;
  enabled: boolean;
}) {
  const isDraggingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onPointerDown(e: PointerEvent) {
      if (!enabled) return;
      if (e.button !== 0) return;

      isDraggingRef.current = true;
      startRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      };
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      if (!enabled) return;
      if (!isDraggingRef.current || !startRef.current) return;

      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      el.scrollLeft = startRef.current.scrollLeft - dx;
      el.scrollTop = startRef.current.scrollTop - dy;
      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!enabled) return;
      isDraggingRef.current = false;
      startRef.current = null;
      e.preventDefault();
    }

    el.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp, { passive: false });
    el.addEventListener("pointercancel", onPointerUp, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [containerRef, enabled]);
}

function PdfCanvasViewer({
  pdfDoc,
  pageNumber,
  rotation,
  onViewport,
}: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  onViewport: (viewportSize: Size, renderedAtScale: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const safePage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        renderTaskRef.current?.cancel();
        renderTaskRef.current = null;

        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE, rotation });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        onViewport({ width: canvas.width, height: canvas.height }, PDF_RENDER_SCALE);

        const task = page.render({ canvas, canvasContext: ctx, viewport } as any);
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name) === "RenderingCancelledException") return;

        toast({
          title: "Viewer error",
          description: e?.message ?? "Failed to render PDF page",
          variant: "destructive",
        });
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdfDoc, pageNumber, rotation, onViewport]);

  return <canvas ref={canvasRef} className="block bg-white" />;
}

/**
 * Takeoff workspace content.
 * - embedded=true: renders ONLY workspace (no header/tabs). Use inside ProjectDetails.
 * - embedded=false: includes header/tabs (standalone route).
 */
export function TakeoffWorkspaceContent({
  projectId,
  embedded = false,
  activeTab = "takeoff",
  onTabChange,
}: {
  projectId: string;
  embedded?: boolean;
  activeTab?: "overview" | "documents" | "takeoff" | "bidding" | "proposal";
  onTabChange?: (next: "overview" | "documents" | "takeoff" | "bidding" | "proposal") => void;
}) {
  const navigate = useNavigate();

  // Panels
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Tooling
  const [tool, setTool] = useState<Tool>("select");

  // Drafts
  const [draft, setDraft] = useState<{
    kind: "measure" | "line";
    a: Point;
    b: Point;
    done: boolean;
  } | null>(null);

  const [areaDraft, setAreaDraft] = useState<{
    pts: Point[];
    cursor?: Point;
  } | null>(null);

  const [scaleDraft, setScaleDraft] = useState<{
    a?: Point;
    b?: Point;
    cursor?: Point;
  } | null>(null);

  // Calibration dialog (non-blocking)
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [calibratePx, setCalibratePx] = useState<number | null>(null);
  const [calibrateValueStr, setCalibrateValueStr] = useState("1");
  const [calibrateUnit, setCalibrateUnit] = useState<Calibration["displayUnit"]>("m");
  const [calibrateLabel, setCalibrateLabel] = useState("");

  // ESC cancels drafts (and closes calibration dialog)
  const toolRef = useRef<Tool>(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraft(null);
        setAreaDraft(null);
        setScaleDraft(null);
        setCalibrateOpen(false);
        setCalibratePx(null);
        if (toolRef.current === "scale") setTool("select");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Project
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,client_name,client_email,client_phone,status,total_sales,created_at,updated_at")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as ProjectRow;
    },
  });

  // Documents
  const { data: documents = [] } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db
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

  // Pages
  const { data: pages = [] } = useQuery({
    queryKey: ["document_pages", activeDocId],
    enabled: !!activeDocId,
    queryFn: async () => {
      const { data, error } = await db
        .from("document_pages")
        .select("id,document_id,page_number,label")
        .eq("document_id", activeDocId)
        .order("page_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  // Load PDF for active document
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [signedUrl, setSignedUrl] = useState("");

  // Viewer state
  const [rotation, setRotation] = useState(0);
  const [uiZoom, setUiZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxSize = useResizeObserverSize(viewerBoxRef);

  // Base viewport size at PDF_RENDER_SCALE
  const viewportBaseRef = useRef<Size>({ width: 0, height: 0 });
  const [viewportBasePx, setViewportBasePx] = useState<Size>({ width: 0, height: 0 });

  function handleViewport(nextViewport: Size) {
    viewportBaseRef.current = nextViewport;
    setViewportBasePx(nextViewport);
  }

  // Fit once per page open
  const fitDoneRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!activeDocId) return;
    const key = `${activeDocId}:${pageNumber}:${rotation}`;
    fitDoneRef.current[key] = false;
  }, [activeDocId, pageNumber, rotation]);

  useEffect(() => {
    if (!activeDocId) return;

    const key = `${activeDocId}:${pageNumber}:${rotation}`;
    if (fitDoneRef.current[key]) return;

    const base = viewportBaseRef.current;
    if (!base.width || !base.height) return;

    const pad = 16;
    const availW = Math.max(0, viewerBoxSize.width - pad);
    const availH = Math.max(0, viewerBoxSize.height - pad);
    if (!availW || !availH) return;

    const fitZ = Math.min(availW / base.width, availH / base.height);
    const clamped = clamp(Number(fitZ.toFixed(3)), 0.2, 6);

    setUiZoom(clamped);

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const targetW = base.width * clamped;
      const targetH = base.height * clamped;
      el.scrollLeft = Math.max(0, (targetW - el.clientWidth) / 2);
      el.scrollTop = Math.max(0, (targetH - el.clientHeight) / 2);
    });

    fitDoneRef.current[key] = true;
  }, [
    activeDocId,
    pageNumber,
    rotation,
    viewerBoxSize.width,
    viewerBoxSize.height,
    viewportBasePx.width,
    viewportBasePx.height,
  ]);

  function requestFit() {
    const base = viewportBaseRef.current;
    if (!base.width || !base.height) return;

    const pad = 16;
    const availW = Math.max(0, viewerBoxSize.width - pad);
    const availH = Math.max(0, viewerBoxSize.height - pad);
    if (!availW || !availH) return;

    const fitZ = Math.min(availW / base.width, availH / base.height);
    const clamped = clamp(Number(fitZ.toFixed(3)), 0.2, 6);

    setUiZoom(clamped);

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const targetW = base.width * clamped;
      const targetH = base.height * clamped;
      el.scrollLeft = Math.max(0, (targetW - el.clientWidth) / 2);
      el.scrollTop = Math.max(0, (targetH - el.clientHeight) / 2);
    });
  }

  // Wheel zoom around cursor (CSS zoom only)
  function onViewerWheel(e: React.WheelEvent) {
    // Do not hijack wheel while calibrating; allow normal scroll/pan so UI doesn't feel locked.
    if (tool === "scale") return;

    e.preventDefault();

    const el = scrollRef.current;
    if (!el) return;

    const direction = e.deltaY > 0 ? -1 : 1;
    const step = 0.1;
    const nextZoom = clamp(Number((uiZoom * (1 + direction * step)).toFixed(3)), 0.2, 6);

    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left + el.scrollLeft;
    const my = e.clientY - rect.top + el.scrollTop;

    const ratio = nextZoom / Math.max(uiZoom, 0.0001);
    setUiZoom(nextZoom);

    requestAnimationFrame(() => {
      el.scrollLeft = mx * ratio - (e.clientX - rect.left);
      el.scrollTop = my * ratio - (e.clientY - rect.top);
    });
  }

  // Drag pan only when tool === pan
  useDragPan({ containerRef: scrollRef, enabled: tool === "pan" });

  const scaledViewportPx = useMemo<Size>(() => {
    return {
      width: Math.floor(viewportBasePx.width * uiZoom),
      height: Math.floor(viewportBasePx.height * uiZoom),
    };
  }, [viewportBasePx.width, viewportBasePx.height, uiZoom]);

  // Convert pointer events to doc-space
  function docPointFromEvent(e: React.PointerEvent, wrapperEl: HTMLElement) {
    const r = wrapperEl.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    return { x: dx / Math.max(uiZoom, 0.0001), y: dy / Math.max(uiZoom, 0.0001) };
  }

  // Throttle pointer move previews
  const rafMoveRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ tool: Tool; p: Point } | null>(null);

  function scheduleMoveUpdate(toolNow: Tool, p: Point) {
    pendingMoveRef.current = { tool: toolNow, p };
    if (rafMoveRef.current != null) return;

    rafMoveRef.current = requestAnimationFrame(() => {
      rafMoveRef.current = null;
      const payload = pendingMoveRef.current;
      if (!payload) return;

      const { tool, p } = payload;

      if (tool === "scale") {
        setScaleDraft((prev) => ({ ...(prev ?? {}), cursor: p }));
        return;
      }
      if (tool === "area") {
        setAreaDraft((prev) => (prev ? { ...prev, cursor: p } : prev));
        return;
      }
      setDraft((prev) => (prev ? { ...prev, b: p } : prev));
    });
  }

  // Overlay handlers
  function onOverlayPointerDown(e: React.PointerEvent, wrapperEl: HTMLElement) {
    // Pan uses scroll-container drag; select should not swallow clicks.
    if (tool === "pan" || tool === "select") return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    if (!pdfDoc) return;
    const p = docPointFromEvent(e, wrapperEl);

    if (tool === "scale") {
      setScaleDraft((prev) => {
        const next = prev ?? {};
        if (!next.a) return { a: p };
        if (!next.b) return { ...next, b: p };
        return next;
      });
      return;
    }

    if (tool === "count") {
      setItems((prev) => [...prev, { id: safeId(), kind: "count", page: pageNumber, p }]);
      return;
    }

    if (tool === "area") {
      setAreaDraft((prev) => {
        const next = prev ?? { pts: [] as Point[] };
        return { ...next, pts: [...next.pts, p] };
      });
      return;
    }

    if (tool === "measure" || tool === "line") {
      setDraft((prev) => {
        if (!prev || prev.done) {
          return { kind: tool, a: p, b: p, done: false };
        }
        const final = { ...prev, b: p, done: true };
        setItems((itemsPrev) => [
          ...itemsPrev,
          { id: safeId(), kind: final.kind, page: pageNumber, a: final.a, b: final.b },
        ]);
        return null;
      });
      return;
    }
  }

  function onOverlayPointerMove(e: React.PointerEvent, wrapperEl: HTMLElement) {
    if (tool === "pan" || tool === "select") return;

    // Only consume events if we are actively previewing something.
    const hasActivePreview =
      (tool === "scale" && !!scaleDraft?.a) ||
      (tool === "area" && !!areaDraft) ||
      ((tool === "measure" || tool === "line") && !!draft);

    if (!hasActivePreview) return;

    e.preventDefault();
    e.stopPropagation();

    if (!pdfDoc) return;
    const p = docPointFromEvent(e, wrapperEl);
    scheduleMoveUpdate(tool, p);
  }

  function onOverlayDoubleClick(e: React.MouseEvent) {
    if (tool !== "area") return;
    e.preventDefault();
    e.stopPropagation();

    setAreaDraft((prev) => {
      if (!prev) return prev;
      if (prev.pts.length < 3) {
        toast({ title: "Area needs at least 3 points" });
        return prev;
      }
      setItems((itemsPrev) => [
        ...itemsPrev,
        { id: safeId(), kind: "area", page: pageNumber, pts: prev.pts },
      ]);
      return null;
    });
  }

  // Calibration storage
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  useEffect(() => {
    if (!activeDocId) {
      setCalibration(null);
      return;
    }
    const key = `aostot:calibration:${activeDocId}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      setCalibration(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Calibration;
      if (typeof parsed?.metersPerDocPx === "number" && parsed.metersPerDocPx > 0) {
        setCalibration(parsed);
      } else {
        setCalibration(null);
      }
    } catch {
      setCalibration(null);
    }
  }, [activeDocId]);

  function persistCalibration(next: Calibration | null) {
    if (!activeDocId) return;
    const key = `aostot:calibration:${activeDocId}`;
    if (!next) {
      localStorage.removeItem(key);
      setCalibration(null);
      return;
    }
    localStorage.setItem(key, JSON.stringify(next));
    setCalibration(next);
  }

  // When scaleDraft gets both points, open the calibration dialog (non-blocking)
  useEffect(() => {
    if (tool !== "scale") return;
    if (!scaleDraft?.a || !scaleDraft?.b) return;
    if (calibrateOpen) return;

    const px = dist(scaleDraft.a, scaleDraft.b);
    if (!isFinite(px) || px <= 0) return;

    setCalibratePx(px);
    setCalibrateUnit(calibration?.displayUnit ?? "m");
    setCalibrateValueStr("1");
    setCalibrateLabel(calibration?.label ?? "");
    setCalibrateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, scaleDraft?.a, scaleDraft?.b]);

  function cancelCalibration() {
    setCalibrateOpen(false);
    setCalibratePx(null);
    setScaleDraft(null);
    setTool("select");
  }

  function submitCalibration() {
    if (!calibratePx || calibratePx <= 0) {
      cancelCalibration();
      return;
    }

    const val = Number(calibrateValueStr);
    if (!isFinite(val) || val <= 0) {
      toast({
        title: "Invalid distance",
        description: "Distance must be a positive number.",
        variant: "destructive",
      });
      return;
    }

    const meters = val * unitToMetersFactor(calibrateUnit);
    const metersPerDocPx = meters / calibratePx;

    const next: Calibration = {
      metersPerDocPx,
      displayUnit: calibrateUnit,
      label: calibrateLabel.trim() || undefined,
    };

    persistCalibration(next);

    toast({
      title: "Scale calibrated",
      description: `1 px = ${formatLength(metersPerDocPx, calibrateUnit)}`,
    });

    setCalibrateOpen(false);
    setCalibratePx(null);
    setScaleDraft(null);
    setTool("select");
  }

  // Derived quantities for drafts
  const draftLengthMeters = useMemo(() => {
    if (!draft || !calibration) return null;
    const px = dist(draft.a, draft.b);
    return px * calibration.metersPerDocPx;
  }, [draft, calibration]);

  const areaDraftMeters2 = useMemo(() => {
    if (!areaDraft || !calibration) return null;
    const px2 = polygonArea(areaDraft.pts);
    return px2 * calibration.metersPerDocPx * calibration.metersPerDocPx;
  }, [areaDraft, calibration]);

  // Load PDF when activeDoc changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPdfDoc(null);
        setPdfNumPages(0);
        setSignedUrl("");
        setPageNumber(1);

        // reset view defaults
        setRotation(0);
        setUiZoom(1);
        viewportBaseRef.current = { width: 0, height: 0 };
        setViewportBasePx({ width: 0, height: 0 });

        // reset drafts on doc change
        setDraft(null);
        setAreaDraft(null);
        setScaleDraft(null);
        setTool("select");

        if (!activeDoc) return;

        const { data, error } = await supabase.storage
          .from(activeDoc.bucket)
          .createSignedUrl(activeDoc.path, 60 * 10);

        if (error) throw error;
        if (!data?.signedUrl) throw new Error("No signed URL returned.");

        if (cancelled) return;

        setSignedUrl(data.signedUrl);

        const pdf = await getDocument({ url: data.signedUrl }).promise;
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

  // Items (Part C persistence later)
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const pageItems = useMemo(() => items.filter((it) => it.page === pageNumber), [items, pageNumber]);

  // Reset drafts when page changes
  useEffect(() => {
    setDraft(null);
    setAreaDraft(null);
    setScaleDraft(null);
    setCalibrateOpen(false);
    setCalibratePx(null);
    if (tool === "scale") setTool("select");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  // Sheets list
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

  // Header (standalone only)
  const tabs = (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          ["overview", "Overview"],
          ["documents", "Documents"],
          ["takeoff", "Takeoff"],
          ["bidding", "Estimating"],
          ["proposal", "Proposal"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          className={[
            "rounded-md px-3 py-1.5 text-sm",
            activeTab === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
          ].join(" ")}
          onClick={() => onTabChange?.(k)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );

  const headerStrip = (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight truncate">{project?.name ?? "Project"}</div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {project?.status ? <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge> : null}
            <span>•</span>
            <span>{project?.client_name || "No client set"}</span>

            {calibration?.label ? (
              <>
                <span>•</span>
                <Badge variant="outline">{calibration.label}</Badge>
              </>
            ) : null}
          </div>

          <div className="mt-3">{tabs}</div>
        </div>

        {!embedded ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  // Toolbar buttons
  const toolButtons = (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          ["select", "Select"],
          ["pan", "Pan"],
          ["measure", "Measure"],
          ["line", "Line"],
          ["area", "Area"],
          ["count", "Count"],
        ] as const
      ).map(([k, label]) => (
        <Button
          key={k}
          size="sm"
          variant={tool === k ? "default" : "outline"}
          onClick={() => {
            setDraft(null);
            setAreaDraft(null);
            setScaleDraft(null);
            setCalibrateOpen(false);
            setCalibratePx(null);
            setTool(k as Tool);

            if (k === "measure" && !calibration) {
              toast({
                title: "Measure needs scale",
                description: "Calibrate scale first (Properties → Calibrate).",
              });
            }
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  function clearAllMarkupsForPage() {
    setItems((prev) => prev.filter((it) => it.page !== pageNumber));
    setDraft(null);
    setAreaDraft(null);
    toast({ title: "Cleared", description: `Cleared items on page ${pageNumber}.` });
  }

  function Overlay({ wrapperSize }: { wrapperSize: Size }) {
    const z = uiZoom;

    const cursor = (() => {
      switch (tool) {
        case "pan":
          return "grab";
        case "measure":
        case "line":
        case "area":
        case "count":
        case "scale":
          return "crosshair";
        default:
          return "default";
      }
    })();

    const showOverlayEvents = tool !== "pan" && tool !== "select";

    const scaleLine =
      scaleDraft?.a && (scaleDraft?.b || scaleDraft?.cursor)
        ? { a: scaleDraft.a, b: scaleDraft.b ?? scaleDraft.cursor! }
        : null;

    return (
      <div
        className="absolute inset-0"
        style={{
          cursor,
          pointerEvents: showOverlayEvents ? "auto" : "none",
        }}
        onPointerDown={(e) => onOverlayPointerDown(e, e.currentTarget as HTMLElement)}
        onPointerMove={(e) => onOverlayPointerMove(e, e.currentTarget as HTMLElement)}
        onDoubleClick={onOverlayDoubleClick}
      >
        <svg
          width={wrapperSize.width}
          height={wrapperSize.height}
          className="absolute inset-0"
          style={{ pointerEvents: "none" }}
        >
          {/* Existing items */}
          {pageItems.map((it) => {
            switch (it.kind) {
              case "count": {
                return (
                  <div
                    key={it.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/90 px-2 py-1 text-xs font-semibold text-primary-foreground shadow"
                    style={{ left: it.p.x, top: it.p.y }}
                    title={it.label}
                  >
                    {it.value}
                  </div>
                );
              }
              case "measure":
              case "line": {
                const x1 = it.a.x;
                const y1 = it.a.y;
                const x2 = it.b.x;
                const y2 = it.b.y;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.sqrt(dx * dx + dy * dy);
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;

                return (
                  <div key={it.id} className="absolute inset-0 pointer-events-none">
                    <svg className="absolute inset-0 h-full w-full">
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                      />
                      {/* endpoints */}
                      <circle cx={x1} cy={y1} r={4} fill="hsl(var(--primary))" />
                      <circle cx={x2} cy={y2} r={4} fill="hsl(var(--primary))" />
                    </svg>
                    {it.kind === "measure" ? (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/90 px-2 py-1 text-xs font-medium shadow"
                        style={{ left: mx, top: my }}
                      >
                        {(() => {
  const len = dist(it.a, it.b);
  if (!calibration) return `${Math.round(len)} px`;
  const meters = len * calibration.metersPerDocPx;
  return formatLength(meters, calibration.displayUnit);
})()}
                      </div>
                    ) : (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/90 px-2 py-1 text-xs font-medium shadow"
                        style={{ left: mx, top: my }}
                      >
                        {(() => {
  if (!calibration) return `${Math.round(len)} px`;
  const meters = len * calibration.metersPerDocPx;
  return formatLength(meters, calibration.displayUnit);
})()}
                      </div>
                    )}
                  </div>
                );
              }
              case "area": {
                const pts = it.pts;
                const d = pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
                  .join(" ");
                const closed = `${d} Z`;

                // centroid (simple average)
                const cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
                const cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;

                return (
                  <div key={it.id} className="absolute inset-0 pointer-events-none">
                    <svg className="absolute inset-0 h-full w-full">
                      <path
                        d={closed}
                        fill="hsl(var(--primary) / 0.15)"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                      />
                      {pts.map((p, idx) => (
                        <circle key={idx} cx={p.x} cy={p.y} r={4} fill="hsl(var(--primary))" />
                      ))}
                    </svg>
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background/90 px-2 py-1 text-xs font-medium shadow"
                      style={{ left: cx, top: cy }}
                    >
                      {(() => {
  const aPx2 = polygonArea(it.pts);
  if (!calibration) return `${Math.round(aPx2)} px²`;
  const m2 = aPx2 * calibration.metersPerDocPx * calibration.metersPerDocPx;
  return formatArea(m2, calibration.displayUnit);
})()}
                    </div>
                  </div>
                );
              }
              default:
                return null;
            }
          })}

          {/* Draft: measure/line */}
          {draft ? (
            <g>
              <line
                x1={draft.a.x * z}
                y1={draft.a.y * z}
                x2={draft.b.x * z}
                y2={draft.b.y * z}
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            </g>
          ) : null}

          {/* Area draft */}
          {areaDraft?.pts?.length ? (
            <g>
              <polyline
                points={[
                  ...areaDraft.pts.map((p) => `${p.x * z},${p.y * z}`),
                  ...(areaDraft.cursor ? [`${areaDraft.cursor.x * z},${areaDraft.cursor.y * z}`] : []),
                ].join(" ")}
                fill="none"
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            </g>
          ) : null}

          {/* Scale draft */}
          {scaleLine ? (
            <g>
              <line
                x1={scaleLine.a.x * z}
                y1={scaleLine.a.y * z}
                x2={scaleLine.b.x * z}
                y2={scaleLine.b.y * z}
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            </g>
          ) : null}
        </svg>

        {/* Draft info label */}
        <div className="absolute top-2 right-2 rounded-md border bg-white/90 px-2 py-1 text-xs text-muted-foreground">
          {tool === "scale"
            ? "Scale: click 2 points (ESC to cancel)"
            : tool === "area"
            ? "Area: click points, double-click to finish (ESC to cancel)"
            : tool === "count"
            ? "Count: click to place points"
            : tool === "measure"
            ? "Measure: click 2 points (needs scale)"
            : tool === "line"
            ? "Line: click 2 points"
            : " "}
        </div>

        {/* Draft quantity */}
        {(draft && calibration && draftLengthMeters != null) || (areaDraft && calibration && areaDraftMeters2 != null) ? (
          <div className="absolute bottom-2 left-2 rounded-md border bg-white/90 px-2 py-1 text-xs">
            {draft && calibration && draftLengthMeters != null
              ? `Length: ${formatLength(draftLengthMeters, calibration.displayUnit)}`
              : null}
            {areaDraft && calibration && areaDraftMeters2 != null
              ? `Area: ${formatArea(areaDraftMeters2, calibration.displayUnit)}`
              : null}
          </div>
        ) : null}
      </div>
    );
  }

  // Load PDF when activeDoc changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPdfDoc(null);
        setPdfNumPages(0);
        setSignedUrl("");
        setPageNumber(1);

        setRotation(0);
        setUiZoom(1);
        viewportBaseRef.current = { width: 0, height: 0 };
        setViewportBasePx({ width: 0, height: 0 });

        setDraft(null);
        setAreaDraft(null);
        setScaleDraft(null);
        setCalibrateOpen(false);
        setCalibratePx(null);
        setTool("select");

        if (!activeDoc) return;

        const { data, error } = await supabase.storage
          .from(activeDoc.bucket)
          .createSignedUrl(activeDoc.path, 60 * 10);

        if (error) throw error;
        if (!data?.signedUrl) throw new Error("No signed URL returned.");

        if (cancelled) return;

        setSignedUrl(data.signedUrl);

        const pdf = await getDocument({ url: data.signedUrl }).promise;
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

  // Layout
  return (
    <div className="w-full h-full">
      <Card className="h-full w-full overflow-hidden">
        {/* Header: standalone only */}
        {!embedded ? <div className="border-b bg-background px-4 py-3">{headerStrip}</div> : null}

        {/* Calibration dialog */}
        <Dialog
          open={calibrateOpen}
          onOpenChange={(open) => {
            if (!open) cancelCalibration();
            else setCalibrateOpen(true);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Calibrate drawing scale</DialogTitle>
              <DialogDescription>
                Enter the real distance between the two points you clicked.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">Distance</label>
                  <Input
                    value={calibrateValueStr}
                    onChange={(e) => setCalibrateValueStr(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 5"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Unit</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={calibrateUnit}
                    onChange={(e) => setCalibrateUnit(e.target.value as Calibration["displayUnit"])}
                  >
                    <option value="m">m</option>
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                    <option value="ft">ft</option>
                    <option value="in">in</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Optional label</label>
                <Input
                  value={calibrateLabel}
                  onChange={(e) => setCalibrateLabel(e.target.value)}
                  placeholder="e.g. 1:100"
                />
              </div>

              <div className="text-xs text-muted-foreground">
                {calibratePx ? `Measured line: ${Math.round(calibratePx)} px` : null}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cancelCalibration}>
                Cancel
              </Button>
              <Button onClick={submitCalibration}>Save scale</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Workspace */}
        <div className={embedded ? "grid h-full grid-cols-[auto_1fr_auto]" : "grid h-[calc(100%-110px)] grid-cols-[auto_1fr_auto]"}>
          {/* Left panel */}
          {leftOpen ? (
            <div className="w-[280px] border-r bg-background">
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

              <div className="h-[calc(100%-156px)] overflow-auto no-scrollbar" style={hideScrollbarStyle as any}>
                <div className="divide-y">
                  {effectivePages.map((p) => (
                    <button
                      key={p.page}
                      className={[
                        "w-full px-3 py-2 text-left hover:bg-muted/50",
                        pageNumber === p.page ? "bg-muted/50" : "",
                      ].join(" ")}
                      onClick={() => setPageNumber(p.page)}
                      type="button"
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
          <div className="bg-muted/20">
            {/* Toolbar row */}
            <div className="border-b bg-background px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {toolButtons}

                <div className="h-6 w-px bg-border mx-1" />

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

                <div className="h-6 w-px bg-border mx-1" />

                <Button variant="outline" size="sm" onClick={() => setUiZoom((z) => clamp(Number((z * 0.9).toFixed(3)), 0.2, 6))}>
                  -
                </Button>

                <Button variant="outline" size="sm" onClick={() => setUiZoom((z) => clamp(Number((z * 1.1).toFixed(3)), 0.2, 6))}>
                  +
                </Button>

                <Button variant="outline" size="sm" onClick={requestFit}>
                  Fit
                </Button>

                <Button variant="outline" size="sm" onClick={() => setRotation((r) => (r + 90) % 360)}>
                  Rotate
                </Button>

                <div className="ml-auto text-xs text-muted-foreground">{Math.round(uiZoom * 100)}% • Wheel to zoom</div>
              </div>
            </div>

            {/* Viewer */}
            <div className="p-3">
              <div ref={viewerBoxRef} className="h-[calc(100vh-260px)] w-full rounded-lg border bg-white overflow-hidden">
                <div
                  ref={scrollRef}
                  className="h-full w-full overflow-auto no-scrollbar"
                  style={hideScrollbarStyle as any}
                  onWheel={onViewerWheel}
                >
                  <div className="inline-block relative" style={{ width: scaledViewportPx.width, height: scaledViewportPx.height }}>
                    {!signedUrl || !pdfDoc ? (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                        {activeDoc ? "Loading PDF…" : "Upload a PDF in Documents to start takeoff."}
                      </div>
                    ) : (
                      <>
                        <PdfCanvasViewer pdfDoc={pdfDoc} pageNumber={pageNumber} rotation={rotation} onViewport={handleViewport} />
                        {viewportBasePx.width > 0 && viewportBasePx.height > 0 ? (
                          <Overlay wrapperSize={scaledViewportPx} />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <div>{tool === "pan" ? "Drag to pan" : "Use tools above to mark up. ESC cancels current action."}</div>
                <div className="flex items-center gap-2">
                  {calibration ? (
                    <span>
                      Scale:{" "}
                      {calibration.label
                        ? calibration.label
                        : `1 px = ${formatLength(calibration.metersPerDocPx, calibration.displayUnit)}`}
                    </span>
                  ) : (
                    <span>Scale: not calibrated</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right panel */}
          {rightOpen ? (
            <div className="w-[320px] border-l bg-background">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="text-sm font-semibold">Properties</div>
                <Button variant="ghost" size="sm" onClick={() => setRightOpen(false)} title="Hide properties">
                  {">>"}
                </Button>
              </div>

              <div className="p-3 space-y-3">
                {/* Drawing scale */}
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">Drawing Scale</div>
                  <div className="mt-1 text-sm">
                    {calibration ? (calibration.label ? calibration.label : `Calibrated (${calibration.displayUnit})`) : "Not defined yet"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {calibration
                      ? `1 px = ${formatLength(calibration.metersPerDocPx, calibration.displayUnit)}`
                      : "Calibrate by picking two points of a known real distance."}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setDraft(null);
                        setAreaDraft(null);
                        setScaleDraft(null);
                        setCalibrateOpen(false);
                        setCalibratePx(null);
                        setTool("scale");
                        toast({ title: "Scale calibration", description: "Click two points on the drawing." });
                      }}
                    >
                      {calibration ? "Recalibrate" : "Calibrate"}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        persistCalibration(null);
                        toast({ title: "Scale cleared" });
                      }}
                      disabled={!calibration}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                {/* Selected placeholder */}
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">Selected</div>
                  <div className="mt-1 text-sm text-muted-foreground">None (selection logic next)</div>
                </div>

                {/* Quick actions */}
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">Quick actions</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={clearAllMarkupsForPage} disabled={!pageItems.length}>
                      Clear page
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      Undo
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      Redo
                    </Button>
                  </div>
                </div>

                {/* Page summary */}
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-semibold text-muted-foreground">This page</div>
                  <div className="mt-2 text-sm">
                    <div className="flex justify-between">
                      <span>Count</span>
                      <span>{pageItems.filter((i) => i.kind === "count").length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Lines</span>
                      <span>{pageItems.filter((i) => i.kind === "line").length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Areas</span>
                      <span>{pageItems.filter((i) => i.kind === "area").length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Measures</span>
                      <span>{pageItems.filter((i) => i.kind === "measure").length}</span>
                    </div>
                  </div>

                  {calibration ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Tip: Use <span className="font-medium">Measure</span> after calibration to show real lengths.
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-muted-foreground">Tip: Calibrate scale first to get real-world quantities.</div>
                  )}
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
      </Card>
    </div>
  );
}

/**
 * Standalone Takeoff page route: /projects/:projectId/takeoff
 */
export default function TakeoffWorkspace() {
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
        <TakeoffWorkspaceContent projectId={projectId} embedded={false} />
      </div>
    </AppLayout>
  );
}
