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

const SHORTCUTS_STORAGE_KEY = "aostot:takeoffShortcuts:v1";
const VIEWER_STATE_STORAGE_PREFIX = "aostot:viewerState";

const DEFAULT_SHORTCUTS: ShortcutMap = {
  area: "1",
  measure: "2",
  count: "3",
  line: "4",
  scale: "s",
  select: "v",
  pan: "h",
};



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

type ShortcutMap = {
  area: string;
  measure: string;
  count: string;
  line: string;
  scale: string;
  select: string;
  pan: string;
};

type CountShape = "circle" | "square" | "triangle" | "diamond" | "cross";

type TakeoffStyle = {
  /** Base HSL token (without the `hsl(...)` wrapper), e.g. "210 90% 55%". */
  token: string;
  /** For count markers only. */
  shape?: CountShape;
};

type TakeoffTemplateKind = "measure" | "line" | "area" | "count";

type TakeoffTemplate = {
  id: string;
  name: string;
  kind: TakeoffTemplateKind;
  /** User grouping (e.g. Concrete, Rebar, Markups). */
  category: string;
  /** Unit of measure (e.g. m, m2, ea). */
  uom: string;
  /** True if this template is annotation-only (does not feed estimating by default). */
  isMarkup: boolean;
  style: TakeoffStyle;
};

type TakeoffItem =
  | {
      id: string;
      kind: "measure" | "line";
      page: number;
      a: Point;
      b: Point;
      style: TakeoffStyle;

      templateId?: string;
      templateName?: string;
      category?: string;
      uom?: string;
      isMarkup?: boolean;
    }
  | {
      id: string;
      kind: "count";
      page: number;
      p: Point;
      style: TakeoffStyle;

      templateId?: string;
      templateName?: string;
      category?: string;
      uom?: string;
      isMarkup?: boolean;

      /** Optional label/value for UI display (defaults shown if undefined). */
      label?: string;
      value?: number;
    }
  | {
      id: string;
      kind: "area";
      page: number;
      pts: Point[];
      style: TakeoffStyle;

      templateId?: string;
      templateName?: string;
      category?: string;
      uom?: string;
      isMarkup?: boolean;
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

const MARKUP_COLOR_TOKENS: string[] = [
  "0 84% 60%",    // red
  "24 95% 55%",   // orange
  "45 93% 50%",   // yellow
  "142 72% 45%",  // green
  "190 85% 45%",  // cyan
  "210 90% 55%",  // blue
  "258 90% 60%",  // purple
  "320 85% 60%",  // pink
  "10 80% 55%",   // coral
  "165 70% 42%",  // teal
  "285 80% 62%",  // violet
  "200 75% 52%",  // sky
];

const DEFAULT_TAKEOFF_TEMPLATES: TakeoffTemplate[] = [
  {
    id: "tpl-linear",
    name: "Linear Takeoff",
    kind: "measure",
    category: "Takeoff",
    uom: "m",
    isMarkup: false,
    style: { token: MARKUP_COLOR_TOKENS[5] },
  },
  {
    id: "tpl-area",
    name: "Area Takeoff",
    kind: "area",
    category: "Takeoff",
    uom: "m2",
    isMarkup: false,
    style: { token: MARKUP_COLOR_TOKENS[3] },
  },
  {
    id: "tpl-count",
    name: "Count Takeoff",
    kind: "count",
    category: "Takeoff",
    uom: "ea",
    isMarkup: false,
    style: { token: MARKUP_COLOR_TOKENS[1], shape: "circle" },
  },
  {
    id: "tpl-redline",
    name: "Redline Markup",
    kind: "line",
    category: "Markups",
    uom: "",
    isMarkup: true,
    style: { token: MARKUP_COLOR_TOKENS[0] },
  },
];


const COUNT_SHAPES: CountShape[] = ["circle", "square", "triangle", "diamond", "cross"];

function hsl(token: string) {
  return `hsl(${token})`;
}
function hslA(token: string, alpha: number) {
  const a = Math.max(0, Math.min(1, alpha));
  return `hsl(${token} / ${a})`;
}

function pickNextColorToken(items: TakeoffItem[]): string {
  const used = new Set<string>();
  for (const it of items) used.add(it.style?.token);
  for (const t of MARKUP_COLOR_TOKENS) {
    if (!used.has(t)) return t;
  }
  // Palette exhausted – deterministic fallback
  return MARKUP_COLOR_TOKENS[items.length % MARKUP_COLOR_TOKENS.length];
}

function pickNextCountShape(items: TakeoffItem[]): CountShape {
  const countItems = items.filter((it) => it.kind === "count");
  return COUNT_SHAPES[countItems.length % COUNT_SHAPES.length];
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


/** Geometry helpers for PlanSwift-like selection/editing. */
function distToSegment(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(p, a);

  const c2 = vx * vx + vy * vy;
  if (c2 <= 0.000001) return dist(p, a);

  const t = c1 / c2;
  if (t >= 1) return dist(p, b);

  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return dist(p, proj);
}

function pointInPolygon(p: Point, pts: Point[]) {
  // Ray casting algorithm
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x,
      yi = pts[i].y;
    const xj = pts[j].x,
      yj = pts[j].y;

    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / Math.max(0.000001, yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function itemDisplayName(it: TakeoffItem) {
  return it.templateName || it.label || it.kind.toUpperCase();
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

function loadShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!raw) return DEFAULT_SHORTCUTS;
    const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
    const next: ShortcutMap = { ...DEFAULT_SHORTCUTS };
    for (const k of Object.keys(DEFAULT_SHORTCUTS) as (keyof ShortcutMap)[]) {
      const v = (parsed as any)?.[k];
      if (typeof v === "string" && v.trim()) next[k] = v.trim().slice(0, 1);
    }
    return next;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

function saveShortcuts(next: ShortcutMap) {
  localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(next));
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as any).isContentEditable) return true;
  return false;
}

function viewerStateKey(docId: string) {
  return `${VIEWER_STATE_STORAGE_PREFIX}:${docId}`;
}

function loadViewerState(docId: string): { pageNumber: number; rotation: number; uiZoom: number } | null {
  try {
    const raw = localStorage.getItem(viewerStateKey(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const pageNumber = Number(parsed?.pageNumber);
    const rotation = Number(parsed?.rotation);
    const uiZoom = Number(parsed?.uiZoom);
    if (!isFinite(pageNumber) || pageNumber <= 0) return null;
    if (![0, 90, 180, 270].includes(rotation)) return null;
    if (!isFinite(uiZoom) || uiZoom <= 0) return null;
    return { pageNumber, rotation, uiZoom };
  } catch {
    return null;
  }
}

function saveViewerState(docId: string, next: { pageNumber: number; rotation: number; uiZoom: number }) {
  try {
    localStorage.setItem(viewerStateKey(docId), JSON.stringify(next));
  } catch {
    // ignore
  }
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
  const onViewportRef = useRef(onViewport);

  useEffect(() => {
    onViewportRef.current = onViewport;
  }, [onViewport]);

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

        onViewportRef.current({ width: canvas.width, height: canvas.height }, PDF_RENDER_SCALE);

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
  }, [pdfDoc, pageNumber, rotation]);

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
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(true);
  const [shiftDown, setShiftDown] = useState(false);

  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => {
    try {
      return loadShortcuts();
    } catch {
      return DEFAULT_SHORTCUTS;
    }
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutMap>(() => ({ ...DEFAULT_SHORTCUTS }));

  useEffect(() => {
    if (shortcutsOpen) setShortcutDraft(shortcuts);
  }, [shortcutsOpen, shortcuts]);

  // PlanSwift-like: user selects a Takeoff Item "template" (type/category/style), then draws.
  const [templates, setTemplates] = useState<TakeoffTemplate[]>(DEFAULT_TAKEOFF_TEMPLATES);
  const [activeTemplateId, setActiveTemplateId] = useState<string>(
    DEFAULT_TAKEOFF_TEMPLATES[0]?.id ?? ""
  );
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) ?? null,
    [templates, activeTemplateId]
  );

  const [templateSearch, setTemplateSearch] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<{
    name: string;
    kind: TakeoffTemplateKind;
    category: string;
    uom: string;
    isMarkup: boolean;
    token: string;
    shape: CountShape;
  }>({
    name: "",
    kind: "measure",
    category: "Takeoff",
    uom: "m",
    isMarkup: false,
    token: MARKUP_COLOR_TOKENS[0],
    shape: "circle",
  });

  // Selection + editing
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<
    | null
    | {
        id: string;
        mode: "move" | "handle";
        handleKey?: "a" | "b";
        handleIndex?: number; // for area vertices
        start: Point;
        origin: TakeoffItem;
      }
  >(null);

  // Undo/Redo (items only)
  const undoRef = useRef<TakeoffItem[][]>([]);
  const redoRef = useRef<TakeoffItem[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

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

  // Keyboard
  const toolRef = useRef<Tool>(tool);
  const selectedIdRef = useRef<string | null>(selectedId);
  const shortcutsRef = useRef<ShortcutMap>(shortcuts);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    function matchShortcut(key: string, shortcut: string) {
      return shortcut.trim().slice(0, 1).toLowerCase() === key;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Shift") setShiftDown(true);

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (!mod && !e.altKey) {
        const sc = shortcutsRef.current;
        if (matchShortcut(key, sc.area)) {
          e.preventDefault();
          setToolWithTemplate("area");
          return;
        }
        if (matchShortcut(key, sc.measure)) {
          e.preventDefault();
          setToolWithTemplate("measure");
          return;
        }
        if (matchShortcut(key, sc.count)) {
          e.preventDefault();
          setToolWithTemplate("count");
          return;
        }
        if (matchShortcut(key, sc.line)) {
          e.preventDefault();
          setToolWithTemplate("line");
          return;
        }
        if (matchShortcut(key, sc.scale)) {
          e.preventDefault();
          setToolWithTemplate("scale");
          return;
        }
        if (matchShortcut(key, sc.select)) {
          e.preventDefault();
          setToolWithTemplate("select");
          return;
        }
        if (matchShortcut(key, sc.pan)) {
          e.preventDefault();
          setToolWithTemplate("pan");
          return;
        }
      }

      if (key === "delete" || key === "backspace") {
        if (selectedIdRef.current) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (key === "escape") {
        setDraft(null);
        setAreaDraft(null);
        setScaleDraft(null);
        setCalibrateOpen(false);
        setCalibratePx(null);
        dragRef.current = null;
        if (toolRef.current === "scale") setTool("select");
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Shift") setShiftDown(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
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

  type LegendState = { x: number; y: number; w: number; h: number; font: number; open: boolean };

  const [legendState, setLegendState] = useState<LegendState>({
    x: 16,
    y: 16,
    w: 300,
    h: 160,
    font: 12,
    open: true,
  });

  const legendStorageKey = useMemo(() => {
    if (!activeDocId) return null;
    return `aostot:legend:${activeDocId}:p${pageNumber}`;
  }, [activeDocId, pageNumber]);

  useEffect(() => {
    if (!legendStorageKey) return;
    try {
      const raw = localStorage.getItem(legendStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<LegendState>;
      setLegendState((prev) => ({
        x: typeof parsed.x === "number" ? parsed.x : prev.x,
        y: typeof parsed.y === "number" ? parsed.y : prev.y,
        w: typeof parsed.w === "number" ? parsed.w : prev.w,
        h: typeof parsed.h === "number" ? parsed.h : prev.h,
        font: typeof parsed.font === "number" ? parsed.font : prev.font,
        open: typeof parsed.open === "boolean" ? parsed.open : prev.open,
      }));
    } catch {
      // ignore
    }
  }, [legendStorageKey]);

  useEffect(() => {
    if (!legendStorageKey) return;
    try {
      localStorage.setItem(legendStorageKey, JSON.stringify(legendState));
    } catch {
      // ignore
    }
  }, [legendStorageKey, legendState]);


  // Persist view state per document (page + rotation + zoom)
  useEffect(() => {
    if (!activeDocId) return;
    saveViewerState(activeDocId, { pageNumber, rotation, uiZoom });
  }, [activeDocId, pageNumber, rotation, uiZoom]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxSize = useResizeObserverSize(viewerBoxRef);

  // Base viewport size at PDF_RENDER_SCALE
  const viewportBaseRef = useRef<Size>({ width: 0, height: 0 });
  const [viewportBasePx, setViewportBasePx] = useState<Size>({ width: 0, height: 0 });

  const handleViewport = React.useCallback((nextViewport: Size) => {
    const cur = viewportBaseRef.current;
    if (cur.width === nextViewport.width && cur.height === nextViewport.height) return;
    viewportBaseRef.current = nextViewport;
    setViewportBasePx(nextViewport);
  }, []);

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

	  const pad = 64; // allow for viewer padding + sheet shadow
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
    // Wheel = zoom only (Bluebeam/PlanSwift-style). Prevent the page / sidebars from scrolling.
    e.preventDefault();
    e.stopPropagation();

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
  const pendingMoveRef = useRef<{ tool: Tool; p: Point; shiftKey: boolean } | null>(null);

  function applyOrtho(anchor: Point, p: Point, shiftKey: boolean): Point {
    // Ortho is ON by default; holding Shift temporarily disables it.
    if (!orthoEnabled) return p;
    if (shiftKey) return p;
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: p.x, y: anchor.y };
    return { x: anchor.x, y: p.y };
  }

  function scheduleMoveUpdate(toolNow: Tool, raw: Point, shiftKey: boolean) {
    pendingMoveRef.current = { tool: toolNow, p: raw, shiftKey };
    if (rafMoveRef.current != null) return;

    rafMoveRef.current = requestAnimationFrame(() => {
      rafMoveRef.current = null;
      const payload = pendingMoveRef.current;
      if (!payload) return;

      const { tool, p: rawP, shiftKey } = payload;

      if (tool === "scale") {
        setScaleDraft((prev) => {
          if (!prev) return prev;
          const anchor = prev.a ?? rawP;
          const orthoP = prev.a ? applyOrtho(anchor, rawP, shiftKey) : rawP;
          const snapped = snapPointToExisting(orthoP);
          return { ...prev, cursor: snapped };
        });
        return;
      }

      if (tool === "area") {
        setAreaDraft((prev) => {
          if (!prev) return prev;
          const anchor = prev.pts.length ? prev.pts[prev.pts.length - 1] : rawP;
          const orthoP = prev.pts.length ? applyOrtho(anchor, rawP, shiftKey) : rawP;
          const snapped = snapPointToExisting(orthoP);
          return { ...prev, cursor: snapped };
        });
        return;
      }

      setDraft((prev) => {
        if (!prev) return prev;
        const anchor = prev.a ?? rawP;
        const orthoP = prev.a ? applyOrtho(anchor, rawP, shiftKey) : rawP;
        const snapped = snapPointToExisting(orthoP);
        return { ...prev, b: snapped };
      });
    });
  }

  // Overlay handlers
  // Overlay handlers
function snapPointToExisting(p: Point) {
  if (!snapEnabled) return p;

  const tol = 8 / Math.max(uiZoom, 0.0001); // ~8px on screen
  let best: { p: Point; d: number } | null = null;

  for (const it of pageItems) {
    const candidates: Point[] = [];
    if (it.kind === "count") candidates.push(it.p);
    else if (it.kind === "area") candidates.push(...it.pts);
    else candidates.push(it.a, it.b);

    for (const c of candidates) {
      const d = dist(p, c);
      if (d <= tol && (!best || d < best.d)) best = { p: c, d };
    }
  }
  return best ? best.p : p;
}

function normalizePointForTool(raw: Point, shiftKey: boolean): Point {
  let p = raw;

  // Ortho is ON by default; holding Shift temporarily disables it.
  if (tool === "measure" || tool === "line") {
    const anchor = draft?.a ?? null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  } else if (tool === "scale") {
    const anchor = scaleDraft?.a ?? null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  } else if (tool === "area") {
    const anchor = areaDraft?.pts?.length ? areaDraft.pts[areaDraft.pts.length - 1] : null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  }

  // Snap after ortho, so snapping respects constrained direction.
  p = snapPointToExisting(p);

  return p;
}

function hitTestItem(p: Point) {
  const tol = 10 / Math.max(uiZoom, 0.0001);
  let best: { id: string; d: number } | null = null;

  for (const it of pageItems) {
    if (it.kind === "count") {
      const d = dist(p, it.p);
      if (d <= tol && (!best || d < best.d)) best = { id: it.id, d };
    } else if (it.kind === "area") {
      const inside = pointInPolygon(p, it.pts);
      if (inside) return { id: it.id, d: 0 };
      for (let i = 0; i < it.pts.length; i++) {
        const a = it.pts[i];
        const b = it.pts[(i + 1) % it.pts.length];
        const d = distToSegment(p, a, b);
        if (d <= tol && (!best || d < best.d)) best = { id: it.id, d };
      }
    } else {
      const d = distToSegment(p, it.a, it.b);
      if (d <= tol && (!best || d < best.d)) best = { id: it.id, d };
    }
  }
  return best;
}

function hitTestHandle(p: Point) {
  const tol = 10 / Math.max(uiZoom, 0.0001);

  let best:
    | null
    | {
        id: string;
        mode: "handle" | "move";
        handleKey?: "a" | "b";
        handleIndex?: number;
        d: number;
      } = null;

  for (const it of pageItems) {
    if (it.kind === "count") {
      const d = dist(p, it.p);
      if (d <= tol && (!best || d < best.d)) best = { id: it.id, mode: "move", d };
      continue;
    }

    if (it.kind === "area") {
      for (let i = 0; i < it.pts.length; i++) {
        const d = dist(p, it.pts[i]);
        if (d <= tol && (!best || d < best.d)) best = { id: it.id, mode: "handle", handleIndex: i, d };
      }
      continue;
    }

    const da = dist(p, it.a);
    if (da <= tol && (!best || da < best.d)) best = { id: it.id, mode: "handle", handleKey: "a", d: da };

    const db = dist(p, it.b);
    if (db <= tol && (!best || db < best.d)) best = { id: it.id, mode: "handle", handleKey: "b", d: db };
  }

  return best;
}

function onOverlayPointerDown(e: React.PointerEvent, wrapperEl: HTMLElement) {
  if (tool === "pan") return;
  if (e.button !== 0) return;
  if (!pdfDoc) return;

	const raw = docPointFromEvent(e, wrapperEl);
	const p = normalizePointForTool(raw, e.shiftKey);

  if (tool === "select") {
    const handle = hitTestHandle(raw);
    if (handle) {
      const item = items.find((x) => x.id === handle.id);
      if (item) {
        pushUndoSnapshot(items);
        setSelectedId(handle.id);
        dragRef.current = {
          id: handle.id,
          mode: handle.mode,
          handleKey: handle.handleKey,
          handleIndex: handle.handleIndex,
          start: raw,
          // store original geometry for stable drag
          origin: item,
        } as any;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const hit = hitTestItem(raw);
    if (hit) {
      const item = items.find((x) => x.id === hit.id);
      if (item) {
        pushUndoSnapshot(items);
        setSelectedId(hit.id);
        dragRef.current = { id: hit.id, mode: "move", start: raw, origin: item } as any;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    setSelectedId(null);
    dragRef.current = null;
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const tpl = activeTemplate && activeTemplate.kind === tool ? activeTemplate : null;
  const meta = tpl
    ? {
        templateId: tpl.id,
        templateName: tpl.name,
        category: tpl.category,
        uom: tpl.uom,
        isMarkup: tpl.isMarkup,
      }
    : {};

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
    commitItems((prev) => {
      const style = tpl?.style ?? { token: pickNextColorToken(prev), shape: pickNextCountShape(prev) };
      const shape = style.shape ?? pickNextCountShape(prev);
      return [
        ...prev,
        { id: safeId(), kind: "count", page: pageNumber, p, style: { ...style, shape }, value: 1, ...meta },
      ];
    });
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
      commitItems((itemsPrev) => [
        ...itemsPrev,
        {
          id: safeId(),
          kind: final.kind,
          page: pageNumber,
          a: final.a,
          b: final.b,
          style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
          ...meta,
        },
      ]);
      return null;
    });
    return;
  }
}

function onOverlayPointerMove(e: React.PointerEvent, wrapperEl: HTMLElement) {
  if (!pdfDoc) return;

  if (tool === "select" && dragRef.current) {
    const raw = docPointFromEvent(e, wrapperEl);
    const p = snapPointToExisting(raw);
    const drag = dragRef.current as any;

    setItems((prev) => {
      return prev.map((it) => {
        if (it.id !== drag.id) return it;

        const origin = drag.origin as TakeoffItem;
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;

        if (drag.mode === "move") {
          if (origin.kind === "count") {
            return { ...it, p: { x: origin.p.x + dx, y: origin.p.y + dy } };
          }
          if (origin.kind === "area") {
            return { ...it, pts: origin.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
          }
          return {
            ...it,
            a: { x: origin.a.x + dx, y: origin.a.y + dy },
            b: { x: origin.b.x + dx, y: origin.b.y + dy },
          };
        }

        if (origin.kind === "area" && typeof drag.handleIndex === "number") {
          const nextPts = origin.pts.slice();
          nextPts[drag.handleIndex] = p;
          return { ...it, pts: nextPts };
        }

        if ((origin.kind === "measure" || origin.kind === "line") && drag.handleKey) {
          if (drag.handleKey === "a") return { ...it, a: p };
          return { ...it, b: p };
        }

        return it;
      });
    });

    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (tool === "pan") return;

  const hasActivePreview =
    (tool === "scale" && !!scaleDraft?.a) ||
    (tool === "area" && !!areaDraft) ||
    ((tool === "measure" || tool === "line") && !!draft);

  if (!hasActivePreview) return;

  e.preventDefault();
  e.stopPropagation();

  const raw = docPointFromEvent(e, wrapperEl);
  scheduleMoveUpdate(tool, raw, e.shiftKey);
}

function onOverlayPointerUp(e: React.PointerEvent) {
  if (tool === "select" && dragRef.current) {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }
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

    const tpl = activeTemplate && activeTemplate.kind === "area" ? activeTemplate : null;
    const meta = tpl
      ? {
          templateId: tpl.id,
          templateName: tpl.name,
          category: tpl.category,
          uom: tpl.uom,
          isMarkup: tpl.isMarkup,
        }
      : {};

    commitItems((itemsPrev) => [
      ...itemsPrev,
      {
        id: safeId(),
        kind: "area",
        page: pageNumber,
        pts: prev.pts,
        style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
        ...meta,
      },
    ]);
    return null;
  });
}

  // Calibration storage
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  const calibrationStorageKey = useMemo(() => {
    if (!activeDocId) return null;
    return `aostot:calibration:${activeDocId}:p${pageNumber}`;
  }, [activeDocId, pageNumber]);

  useEffect(() => {
    if (!calibrationStorageKey) {
      setCalibration(null);
      return;
    }
    const raw = localStorage.getItem(calibrationStorageKey);
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
  }, [calibrationStorageKey]);

  function persistCalibration(next: Calibration | null) {
    if (!calibrationStorageKey) return;
    if (!next) {
      localStorage.removeItem(calibrationStorageKey);
      setCalibration(null);
      return;
    }
    localStorage.setItem(calibrationStorageKey, JSON.stringify(next));
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

  // Items (Part C persistence later)
  const [items, setItems] = useState<TakeoffItem[]>([]);

  // Persist takeoff items per document so markups survive refresh/server restarts.
  const didLoadItemsRef = useRef(false);

  useEffect(() => {
    didLoadItemsRef.current = false;

    if (!activeDocId) {
      setItems([]);
      didLoadItemsRef.current = true;
      return;
    }

    const key = `aostot:takeoffItems:${activeDocId}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      setItems([]);
      didLoadItemsRef.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setItems(parsed as TakeoffItem[]);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      didLoadItemsRef.current = true;
    }
  }, [activeDocId]);

  useEffect(() => {
    if (!activeDocId) return;
    if (!didLoadItemsRef.current) return;

    const key = `aostot:takeoffItems:${activeDocId}`;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // ignore quota errors
    }
  }, [activeDocId, items]);

function pushUndoSnapshot(prevItems: TakeoffItem[]) {
  const cap = 50;
  undoRef.current.push(prevItems);
  if (undoRef.current.length > cap) undoRef.current.shift();
  redoRef.current = [];
  setUndoCount(undoRef.current.length);
  setRedoCount(0);
}

function commitItems(update: (prev: TakeoffItem[]) => TakeoffItem[]) {
  setItems((prev) => {
    const next = update(prev);
    if (next === prev) return prev;
    pushUndoSnapshot(prev);
    return next;
  });
}

function undo() {
  setItems((curr) => {
    const prev = undoRef.current.pop();
    if (!prev) return curr;
    redoRef.current.push(curr);
    setUndoCount(undoRef.current.length);
    setRedoCount(redoRef.current.length);
    setSelectedId(null);
    return prev;
  });
}

function redo() {
  setItems((curr) => {
    const next = redoRef.current.pop();
    if (!next) return curr;
    undoRef.current.push(curr);
    setUndoCount(undoRef.current.length);
    setRedoCount(redoRef.current.length);
    setSelectedId(null);
    return next;
  });
}

function deleteSelected() {
  if (!selectedId) return;
  commitItems((prev) => prev.filter((it) => it.id !== selectedId));
  setSelectedId(null);
}


function duplicateSelected() {
  if (!selectedId) return;
  const it = items.find((x) => x.id === selectedId);
  if (!it) return;

  const bump = 12 / Math.max(uiZoom, 0.0001);

  commitItems((prev) => {
    const copy = { ...it, id: safeId() } as TakeoffItem;
    if (copy.kind === "count") copy.p = { x: copy.p.x + bump, y: copy.p.y + bump };
    else if (copy.kind === "area") copy.pts = copy.pts.map((p) => ({ x: p.x + bump, y: p.y + bump }));
    else {
      copy.a = { x: copy.a.x + bump, y: copy.a.y + bump };
      copy.b = { x: copy.b.x + bump, y: copy.b.y + bump };
    }
    return [...prev, copy];
  });

  toast({ title: "Duplicated", description: itemDisplayName(it) });
}

const selectedItem = useMemo(
  () => (selectedId ? items.find((it) => it.id === selectedId) ?? null : null),
  [items, selectedId]
);

useEffect(() => {
  // Keep active template valid
  if (activeTemplateId && templates.some((t) => t.id === activeTemplateId)) return;
  if (templates.length) setActiveTemplateId(templates[0].id);
}, [templates, activeTemplateId]);

  const pageItems = useMemo(() => items.filter((it) => it.page === pageNumber), [items, pageNumber]);

  const pageKindCountsByPage = useMemo(() => {
    const m = new Map<number, { measure: number; line: number; area: number; count: number }>();
    for (const it of items) {
      const cur = m.get(it.page) ?? { measure: 0, line: 0, area: 0, count: 0 };
      if (it.kind === "measure") cur.measure += 1;
      else if (it.kind === "line") cur.line += 1;
      else if (it.kind === "area") cur.area += 1;
      else if (it.kind === "count") cur.count += 1;
      m.set(it.page, cur);
    }
    return m;
  }, [items]);

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
  
function resetDrafts() {
  setDraft(null);
  setAreaDraft(null);
  setScaleDraft(null);
  setCalibrateOpen(false);
  setCalibratePx(null);
}

function activateTemplate(t: TakeoffTemplate) {
  setActiveTemplateId(t.id);
  setSelectedId(null);
  dragRef.current = null;

  resetDrafts();
  setTool(t.kind as Tool);

  if (t.kind === "measure" && !calibration) {
    toast({
      title: "Measure needs scale",
      description: "Calibrate scale first (Properties → Calibrate).",
    });
  }
}

function setToolWithTemplate(nextTool: Tool) {
  // select/pan/scale are not tied to templates.
  if (nextTool === "select" || nextTool === "pan" || nextTool === "scale") {
    resetDrafts();
    setTool(nextTool);
    if (nextTool === "scale") {
      toast({ title: "Scale", description: "Click 2 points on this page, then enter the known distance." });
    }
    return;
  }

  const kind = nextTool as TakeoffTemplateKind;
  const candidates = templates.filter((t) => t.kind === kind);
  if (!candidates.length) {
    // Planswift-style: if no assembly/template exists, prompt for name + color.
    openTemplateDialog(kind);
    return;
  }

  const nextTpl = activeTemplate && activeTemplate.kind === kind ? activeTemplate : candidates[0];
  activateTemplate(nextTpl);
}

function openTemplateDialog(kind?: TakeoffTemplateKind) {
  // Pick a token that isn't already used by templates (best-effort).
  const used = new Set(templates.map((t) => t.style.token));
  const token = MARKUP_COLOR_TOKENS.find((t) => !used.has(t)) ?? MARKUP_COLOR_TOKENS[0];

  const k: TakeoffTemplateKind = kind ?? "measure";
  const uom = k === "area" ? "m2" : k === "count" ? "ea" : "m";

  setTemplateForm({
    name: "",
    kind: k,
    category: "Takeoff",
    uom,
    isMarkup: false,
    token,
    shape: "circle",
  });
  setTemplateDialogOpen(true);
}

function saveTemplateFromDialog() {
  const name = templateForm.name.trim();
  if (!name) {
    toast({ title: "Template needs a name", variant: "destructive" });
    return;
  }

  const id = `tpl-${safeId()}`;
  const next: TakeoffTemplate = {
    id,
    name,
    kind: templateForm.kind,
    category: templateForm.category.trim() || "Takeoff",
    uom: templateForm.uom.trim(),
    isMarkup: Boolean(templateForm.isMarkup),
    style:
      templateForm.kind === "count"
        ? { token: templateForm.token, shape: templateForm.shape }
        : { token: templateForm.token },
  };

  setTemplates((prev) => [...prev, next]);
  setTemplateDialogOpen(false);

  // Immediately activate new template
  activateTemplate(next);
}

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
          ["scale", "Scale"],
        ] as const
      ).map(([k, label]) => (
        <Button
          key={k}
          size="sm"
          variant={tool === k ? "default" : "outline"}
          onClick={() => {
            setSelectedId(null);
            dragRef.current = null;
	            setToolWithTemplate(k as Tool);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  function clearAllMarkupsForPage() {
    setSelectedId(null);
    dragRef.current = null;
    commitItems((prev) => prev.filter((it) => it.page !== pageNumber));
    setDraft(null);
    setAreaDraft(null);
    toast({ title: "Cleared", description: `Cleared items on page ${pageNumber}.` });
  }


  function TakeoffLegend() {
    if (!legendState.open) return null;
    if (!activeDocId) return null;

    // Build per-template totals for the current page.
    const rows = templates
      .map((t) => {
        const its = pageItems.filter((i) => i.templateId === t.id || (i.templateName === t.name && i.kind === t.kind));
        if (!its.length) return null;

        const qty = (() => {
          if (t.kind === "count") {
            const n = its.reduce((acc, it) => acc + (it.kind === "count" ? it.value ?? 1 : 0), 0);
            return `${n} ${t.uom || "ea"}`;
          }
          if (t.kind === "area") {
            const aPx2 = its.reduce((acc, it) => acc + (it.kind === "area" ? polygonArea(it.pts) : 0), 0);
            if (!calibration) return `${aPx2.toFixed(1)} px²`;
            const m2 = aPx2 * (calibration.metersPerDocPx * calibration.metersPerDocPx);
            return formatArea(m2, calibration.displayUnit);
          }
          // measure/line
          const lenPx = its.reduce((acc, it) => {
            if (it.kind === "measure" || it.kind === "line") return acc + dist(it.a, it.b);
            return acc;
          }, 0);
          if (!calibration) return `${lenPx.toFixed(1)} px`;
          const m = lenPx * calibration.metersPerDocPx;
          return formatLength(m, calibration.displayUnit);
        })();

        return {
          id: t.id,
          name: t.name,
          kind: t.kind,
          category: t.category,
          token: t.style.token,
          qty,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; kind: string; category: string; token: string; qty: string }>;

    if (!rows.length) return null;

    function beginDrag(e: React.PointerEvent) {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...legendState };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        setLegendState((prev) => ({ ...prev, x: start.x + dx, y: start.y + dy }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    function beginResize(e: React.PointerEvent) {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...legendState };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        setLegendState((prev) => ({
          ...prev,
          w: clamp(Math.round(start.w + dx), 180, 900),
          h: clamp(Math.round(start.h + dy), 120, 700),
        }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    return (
      <div
        className="absolute z-30 rounded-md border bg-background shadow"
        style={{
          left: legendState.x,
          top: legendState.y,
          width: legendState.w,
          height: legendState.h,
        }}
        onPointerDown={(e) => {
          // Prevent drawing interactions when clicking inside the legend.
          e.stopPropagation();
        }}
      >
        <div
          className="flex items-center justify-between gap-2 border-b px-2 py-1"
          style={{ cursor: "move" }}
          onPointerDown={beginDrag}
        >
          <div className="text-xs font-semibold text-muted-foreground">Takeoff Report (Page {pageNumber})</div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLegendState((s) => ({ ...s, font: clamp(s.font - 1, 10, 18) }));
              }}
              title="Smaller text"
            >
              <span className="text-xs">A-</span>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLegendState((s) => ({ ...s, font: clamp(s.font + 1, 10, 18) }));
              }}
              title="Larger text"
            >
              <span className="text-xs">A+</span>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLegendState((s) => ({ ...s, open: false }));
              }}
              title="Hide report"
            >
              ×
            </Button>
          </div>
        </div>

        <div className="h-full overflow-auto p-2" style={{ fontSize: legendState.font }}>
          <div className="grid gap-1">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: hsl(r.token) }} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-[0.85em] text-muted-foreground">
                      {r.category} • {String(r.kind).toUpperCase()}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 font-medium">{r.qty}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-transparent"
          onPointerDown={beginResize}
          title="Resize"
        />
      </div>
    );
  }


  function Overlay({ wrapperSize }: { wrapperSize: Size }) {
    const z = uiZoom;
const draftToken =
  (activeTemplate && activeTemplate.kind === tool ? activeTemplate.style.token : null) ??
  pickNextColorToken(items);
const draftStroke = hsl(draftToken);
const draftFill = hslA(draftToken, 0.18);

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

    const showOverlayEvents = tool !== "pan";

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
        onPointerUp={onOverlayPointerUp}
        onPointerCancel={onOverlayPointerUp}
        onDoubleClick={onOverlayDoubleClick}
      >
        <svg
          width={wrapperSize.width}
          height={wrapperSize.height}
          className="absolute inset-0"
          style={{ pointerEvents: "none" }}
        >

          {/* Selection highlight */}
          {selectedItem ? (() => {
            const token = selectedItem.style.token;
            const stroke = hsl(token);
            const fill = hslA(token, 0.10);
            const r = 6;

            if (selectedItem.kind === "count") {
              const x = selectedItem.p.x * z;
              const y = selectedItem.p.y * z;
              return (
                <g>
                  <circle cx={x} cy={y} r={14} fill={fill} stroke={stroke} strokeWidth={3} />
                  <circle cx={x} cy={y} r={r} fill="white" stroke={stroke} strokeWidth={2} />
                </g>
              );
            }

            if (selectedItem.kind === "area") {
              const pts = selectedItem.pts.map((p) => `${p.x * z},${p.y * z}`).join(" ");
              return (
                <g>
                  <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={3} />
                  {selectedItem.pts.map((p, i) => (
                    <circle key={i} cx={p.x * z} cy={p.y * z} r={r} fill="white" stroke={stroke} strokeWidth={2} />
                  ))}
                </g>
              );
            }

            const x1 = selectedItem.a.x * z;
            const y1 = selectedItem.a.y * z;
            const x2 = selectedItem.b.x * z;
            const y2 = selectedItem.b.y * z;

            return (
              <g>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={4} />
                <circle cx={x1} cy={y1} r={r} fill="white" stroke={stroke} strokeWidth={2} />
                <circle cx={x2} cy={y2} r={r} fill="white" stroke={stroke} strokeWidth={2} />
              </g>
            );
          })() : null}

          {/* Existing items */}
          {pageItems.map((it) => {
            const token = it.style.token;
            const stroke = hsl(token);
            const fill = hslA(token, 0.18);

            if (it.kind === "count") {
              const x = it.p.x * z;
              const y = it.p.y * z;
              const shape = it.style.shape ?? "circle";
              const r = 8;
              const v = String(it.value ?? 1);

              return (
                <g key={it.id} transform={`translate(${x}, ${y})`}>
                  {shape === "circle" ? (
                    <circle cx={0} cy={0} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
                  ) : shape === "square" ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={2} />
                  ) : shape === "triangle" ? (
                    <path
                      d={`M 0 ${-r} L ${r} ${r * 0.9} L ${-r} ${r * 0.9} Z`}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={2}
                    />
                  ) : shape === "diamond" ? (
                    <path
                      d={`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={2}
                    />
                  ) : (
                    <>
                      <line x1={-r} y1={-r} x2={r} y2={r} stroke={stroke} strokeWidth={2} />
                      <line x1={r} y1={-r} x2={-r} y2={r} stroke={stroke} strokeWidth={2} />
                    </>
                  )}

                  <text
                    x={0}
                    y={4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={stroke}
                    stroke="white"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {v}
                  </text>
                </g>
              );
            }

            if (it.kind === "area") {
              const pts = it.pts.map((p) => `${p.x * z},${p.y * z}`).join(" ");
              return <polygon key={it.id} points={pts} fill={fill} />;
            }

            // measure/line
            const x1 = it.a.x * z;
            const y1 = it.a.y * z;
            const x2 = it.b.x * z;
            const y2 = it.b.y * z;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;

            const pxLen = dist(it.a, it.b);
            const label = (() => {
              if (it.kind !== "measure") return null;
              if (!calibration) return `${Math.round(pxLen)} px`;
              const meters = pxLen * calibration.metersPerDocPx;
              return formatLength(meters, calibration.displayUnit);
            })();

            return (
              <g key={it.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={2} />
                {it.kind === "measure" ? (
                  <>
                    <circle cx={x1} cy={y1} r={3} fill={stroke} />
                    <circle cx={x2} cy={y2} r={3} fill={stroke} />
                    {label ? (
                      <text
                        x={mx}
                        y={my - 6}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={700}
                        fill={stroke}
                        stroke="white"
                        strokeWidth={4}
                        paintOrder="stroke"
                      >
                        {label}
                      </text>
                    ) : null}
                  </>
                ) : null}
              </g>
            );
          })}
          {/* Draft: measure/line */}
          {draft
            ? (() => {
                const x1 = draft.a.x * z;
                const y1 = draft.a.y * z;
                const x2 = draft.b.x * z;
                const y2 = draft.b.y * z;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const pxLen = dist(draft.a, draft.b);

                const label =
                  draft.kind === "measure"
                    ? calibration
                      ? formatLength(pxLen * calibration.metersPerDocPx, calibration.displayUnit)
                      : `${Math.round(pxLen)} px`
                    : null;

                return (
                  <g>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={draftStroke}
                      strokeWidth={2}
                      strokeDasharray="6 6"
                    />
                    {label ? (
                      <text
                        x={mx}
                        y={my - 6}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={700}
                        fill={draftStroke}
                        stroke="white"
                        strokeWidth={4}
                        paintOrder="stroke"
                      >
                        {label}
                      </text>
                    ) : null}
                  </g>
                );
              })()
            : null}

          {/* Area draft */}
          {areaDraft?.pts?.length ? (
            <g>
              <polygon
                points={[
                  ...areaDraft.pts.map((p) => `${p.x * z},${p.y * z}`),
                  ...(areaDraft.cursor ? [`${areaDraft.cursor.x * z},${areaDraft.cursor.y * z}`] : []),
                ].join(" ")}
                fill={draftFill}
              />
              <polyline
                points={[
                  ...areaDraft.pts.map((p) => `${p.x * z},${p.y * z}`),
                  ...(areaDraft.cursor ? [`${areaDraft.cursor.x * z},${areaDraft.cursor.y * z}`] : []),
                ].join(" ")}
                fill="none"
                stroke={draftStroke}
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            </g>
          ) : null}

          {/* Scale draft */}
          {scaleLine ? (() => {
            const x1 = scaleLine.a.x * z;
            const y1 = scaleLine.a.y * z;
            const x2 = scaleLine.b.x * z;
            const y2 = scaleLine.b.y * z;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const pxLen = dist(scaleLine.a, scaleLine.b);

            const label = (() => {
              if (calibrateOpen && calibrateValueStr && calibrateUnit) {
                return `${calibrateValueStr} ${calibrateUnit}`;
              }
              if (calibration) {
                return formatLength(pxLen * calibration.metersPerDocPx, calibration.displayUnit);
              }
              return `${Math.round(pxLen)} px`;
            })();

            return (
              <g>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={draftStroke}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                />
                <text
                  x={mx}
                  y={my - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill={draftStroke}
                  stroke="white"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {label}
                </text>
              </g>
            );
          })() : null}
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

	    const savedView = activeDoc ? loadViewerState(activeDoc.id) : null;
	    const nextRotation = savedView?.rotation ?? 0;
	    const nextZoom = clamp(savedView?.uiZoom ?? 1, 0.2, 6);
	    const nextPage = Math.max(1, savedView?.pageNumber ?? 1);

	    setRotation(nextRotation);
	    setUiZoom(nextZoom);
	    setPageNumber(nextPage);
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
	    setPageNumber((p) => clamp(p, 1, pdf.numPages));
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


<Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>New takeoff item</DialogTitle>
      <DialogDescription>
        Create a reusable item (category + tool + unit + style). You can change and persist these in Supabase in Part C.
      </DialogDescription>
    </DialogHeader>

    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-xs font-medium">Name</div>
        <Input
          value={templateForm.name}
          onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g. Skirting, Tiles, Door count"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium">Category</div>
          <Input
            value={templateForm.category}
            onChange={(e) => setTemplateForm((p) => ({ ...p, category: e.target.value }))}
            placeholder="Takeoff"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium">Unit</div>
          <Input
            value={templateForm.uom}
            onChange={(e) => setTemplateForm((p) => ({ ...p, uom: e.target.value }))}
            placeholder="m, m2, ea"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium">Tool</div>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={templateForm.kind}
            onChange={(e) =>
              setTemplateForm((p) => ({ ...p, kind: e.target.value as TakeoffTemplateKind }))
            }
          >
            <option value="measure">Measure (distance)</option>
            <option value="area">Area</option>
            <option value="count">Count</option>
            <option value="line">Line (markup)</option>
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium">Feeds estimating</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!templateForm.isMarkup}
              onChange={(e) => setTemplateForm((p) => ({ ...p, isMarkup: !e.target.checked }))}
            />
            <span className="text-muted-foreground">Yes (uncheck for markup-only)</span>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium">Color</div>
        <div className="flex flex-wrap gap-2">
          {MARKUP_COLOR_TOKENS.map((t) => {
            const active = t === templateForm.token;
            return (
              <button
                key={t}
                type="button"
                className={"h-7 w-7 rounded-md border " + (active ? "ring-2 ring-primary" : "")}
                style={{ backgroundColor: hsl(t) }}
                onClick={() => setTemplateForm((p) => ({ ...p, token: t }))}
                title={t}
              />
            );
          })}
        </div>
      </div>

      {templateForm.kind === "count" ? (
        <div className="space-y-2">
          <div className="text-xs font-medium">Count shape</div>
          <div className="flex flex-wrap gap-2">
            {COUNT_SHAPES.map((sh) => {
              const active = sh === templateForm.shape;
              return (
                <button
                  key={sh}
                  type="button"
                  className={"rounded-md border px-2 py-1 text-sm " + (active ? "bg-muted" : "")}
                  onClick={() => setTemplateForm((p) => ({ ...p, shape: sh }))}
                >
                  {sh}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
        Cancel
      </Button>
      <Button onClick={saveTemplateFromDialog}>Create</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

        {/* Shortcuts dialog */}
        <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
              <DialogDescription>
                Assign single-key shortcuts for tools. Defaults: Area=1, Measure=2, Count=3.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {(
                [
                  ["area", "Area"],
                  ["measure", "Measure"],
                  ["count", "Count"],
                  ["line", "Line"],
                  ["scale", "Scale"],
                  ["select", "Select"],
                  ["pan", "Pan"],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-2">
                  <div className="text-sm text-muted-foreground">{label}</div>
                  <Input
                    value={shortcutDraft[k]}
                    onChange={(e) => {
                      const v = e.target.value.slice(-1);
                      setShortcutDraft((p) => ({ ...p, [k]: v }));
                    }}
                    placeholder="single key"
                    maxLength={1}
                  />
                </div>
              ))}
              <div className="text-xs text-muted-foreground">
                Notes: shortcuts are ignored while typing in input fields. Ctrl/Cmd+Z is Undo; Ctrl/Cmd+Y is Redo.
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShortcutsOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const cleaned: ShortcutMap = { ...DEFAULT_SHORTCUTS, ...shortcutDraft };
                  setShortcuts(cleaned);
                  saveShortcuts(cleaned);
                  setShortcutsOpen(false);
                  toast({ title: "Shortcuts saved" });
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Workspace */}
        <div className={embedded ? "grid h-full grid-cols-[auto_minmax(0,1fr)_auto]" : "grid h-[calc(100%-110px)] grid-cols-[auto_minmax(0,1fr)_auto]"}>
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

<div className="rounded-lg border p-2">
  <div className="flex items-center justify-between gap-2">
    <div className="text-xs font-semibold text-muted-foreground">Takeoff items</div>
    <Button size="sm" variant="outline" onClick={openTemplateDialog}>
      Add
    </Button>
  </div>

  <div className="mt-2 space-y-2">
    <Input
      value={templateSearch}
      onChange={(e) => setTemplateSearch(e.target.value)}
      placeholder="Search items..."
      className="h-8"
    />

    <div className="max-h-[220px] overflow-auto rounded-md border">
      {templates
        .filter((t) => {
          const q = templateSearch.trim().toLowerCase();
          if (!q) return true;
          return (
            t.name.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q) ||
            t.kind.toLowerCase().includes(q)
          );
        })
        .map((t) => {
          const active = t.id === activeTemplateId;
          return (
            <button
              key={t.id}
              className={
                "flex w-full items-center gap-2 border-b px-2 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 " +
                (active ? "bg-muted" : "")
              }
              onClick={() => activateTemplate(t)}
              type="button"
            >
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: hsl(t.style.token) }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.category} • {t.kind.toUpperCase()}
                  {t.uom ? ` • ${t.uom}` : ""}
                  {t.isMarkup ? " • markup" : ""}
                </div>
              </div>
            </button>
          );
        })}
    </div>

    <div className="text-[11px] text-muted-foreground">
      Tip: selecting an item automatically picks the correct tool.
    </div>
  </div>
</div>

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
	                      <div className="mt-1 flex flex-wrap gap-1">
	                        {(() => {
	                          const c = pageKindCountsByPage.get(p.page);
	                          if (!c) return null;
	                          return (
	                            <>
	                              {c.area ? (
	                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
	                                  A {c.area}
	                                </Badge>
	                              ) : null}
	                              {c.line ? (
	                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
	                                  L {c.line}
	                                </Badge>
	                              ) : null}
	                              {c.measure ? (
	                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
	                                  M {c.measure}
	                                </Badge>
	                              ) : null}
	                              {c.count ? (
	                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
	                                  C {c.count}
	                                </Badge>
	                              ) : null}
	                            </>
	                          );
	                        })()}
	                      </div>
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


<Button size="sm" variant="outline" onClick={undo} disabled={undoCount === 0}>
  Undo
</Button>
<Button size="sm" variant="outline" onClick={redo} disabled={redoCount === 0}>
  Redo
</Button>
<Button
  size="sm"
  variant={snapEnabled ? "default" : "outline"}
  onClick={() => setSnapEnabled((v) => !v)}
  title="Snap to nearby points"
>
  Snap
</Button>
	<Button
	  size="sm"
	  variant={orthoEnabled && !shiftDown ? "default" : "outline"}
	  onClick={() => setOrthoEnabled((v) => !v)}
	  title="Ortho locks segments to horizontal/vertical. Hold Shift to temporarily disable while drawing."
	>
	  Ortho{shiftDown ? " (Shift)" : ""}
	</Button>
	<Button size="sm" variant="outline" onClick={() => setShortcutsOpen(true)}>
	  Shortcuts
	</Button>
	<Button
	  size="sm"
	  variant={legendState.open ? "default" : "outline"}
	  onClick={() => setLegendState((s) => ({ ...s, open: !s.open }))}
	  title="Toggle takeoff report overlay"
	>
	  Report
	</Button>

{activeTemplate ? (
  <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ backgroundColor: hsl(activeTemplate.style.token) }}
    />
    <span className="max-w-[160px] truncate">{activeTemplate.name}</span>
  </div>
) : null}

                <div className="ml-auto text-xs text-muted-foreground">{Math.round(uiZoom * 100)}% • Wheel to zoom</div>
              </div>
            </div>

            {/* Viewer */}
	            <div className="p-3 min-w-0">
	              <div ref={viewerBoxRef} className="h-[calc(100vh-260px)] w-full rounded-lg border bg-muted/60 overflow-hidden">
                <div
                  ref={scrollRef}
	                  className="h-full w-full overflow-auto no-scrollbar bg-muted/60 p-6"
                  style={hideScrollbarStyle as any}
                  onWheel={onViewerWheel}
                >
	                  <div
	                    className="inline-block relative bg-white border shadow-md"
	                    style={{ width: scaledViewportPx.width, height: scaledViewportPx.height }}
	                  >
                    {!signedUrl || !pdfDoc ? (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                        {activeDoc ? "Loading PDF…" : "Upload a PDF in Documents to start takeoff."}
                      </div>
                    ) : (
                      <>
                        <PdfCanvasViewer pdfDoc={pdfDoc} pageNumber={pageNumber} rotation={rotation} onViewport={handleViewport} />
                        {viewportBasePx.width > 0 && viewportBasePx.height > 0 ? (
                          <Overlay wrapperSize={scaledViewportPx} />
                          <TakeoffLegend />
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
	                {/* Drawing scale (per page) */}
	                <div className="rounded-lg border p-3">
	                  <div className="text-xs font-semibold text-muted-foreground">Drawing Scale • Page {pageNumber}</div>
	                  <div className="mt-1 text-sm">
	                    {calibration
	                      ? calibration.label
	                        ? calibration.label
	                        : `Calibrated (${calibration.displayUnit})`
	                      : "Not calibrated"}
	                  </div>
	                  <div className="mt-2 text-xs text-muted-foreground">
	                    {calibration
	                      ? `1 px = ${formatLength(calibration.metersPerDocPx, calibration.displayUnit)}`
	                      : "Calibrate by picking two points of a known real distance on this page."}
	                  </div>

	                  <div className="mt-3 flex flex-wrap gap-2">
	                    <Button size="sm" onClick={() => setToolWithTemplate("scale")}>
	                      Calibrate
	                    </Button>
	                    <Button
	                      size="sm"
	                      variant="outline"
	                      onClick={() => {
	                        persistCalibration(null);
	                        toast({ title: "Scale cleared", description: `Page ${pageNumber}` });
	                      }}
	                      disabled={!calibration}
	                    >
	                      Clear
	                    </Button>
	                  </div>
	                </div>

	                {/* Selected */}
	                <div className="rounded-lg border p-3">
	                  <div className="text-xs font-semibold text-muted-foreground">Selected</div>
	                  {selectedItem ? (
	                    <div className="mt-2 space-y-2">
	                      <div className="flex items-center gap-2">
	                        <span
	                          className="inline-block h-3 w-3 rounded-sm"
	                          style={{ backgroundColor: hsl(selectedItem.style.token) }}
	                        />
	                        <div className="min-w-0">
	                          <div className="truncate text-sm font-medium">{itemDisplayName(selectedItem)}</div>
	                          <div className="text-xs text-muted-foreground">
	                            {selectedItem.kind.toUpperCase()} • Page {selectedItem.page}
	                            {selectedItem.category ? ` • ${selectedItem.category}` : ""}
	                          </div>
	                        </div>
	                      </div>

	                      <div className="rounded-md bg-muted/40 px-2 py-1 text-sm">
	                        {(() => {
	                          if (selectedItem.kind === "count") {
	                            const v = selectedItem.value ?? 1;
	                            return `${v} ${selectedItem.uom || "ea"}`;
	                          }
	                          if (selectedItem.kind === "area") {
	                            const areaPx2 = polygonArea(selectedItem.pts);
	                            if (!calibration) return `${areaPx2.toFixed(1)} px²`;
	                            const m2 = areaPx2 * (calibration.metersPerDocPx * calibration.metersPerDocPx);
	                            return formatArea(m2, calibration.displayUnit);
	                          }
	                          const lenPx = dist(selectedItem.a, selectedItem.b);
	                          if (!calibration) return `${lenPx.toFixed(1)} px`;
	                          const m = lenPx * calibration.metersPerDocPx;
	                          return formatLength(m, calibration.displayUnit);
	                        })()}
	                      </div>

	                      <div className="flex flex-wrap gap-2">
	                        <Button size="sm" variant="outline" onClick={duplicateSelected}>
	                          Duplicate
	                        </Button>
	                        <Button size="sm" variant="destructive" onClick={deleteSelected}>
	                          Delete
	                        </Button>
	                      </div>
	                    </div>
	                  ) : (
	                    <div className="mt-2 text-sm text-muted-foreground">
	                      Use <span className="font-medium">Select</span>, then click an item on the drawing.
	                      <div className="mt-1 text-xs text-muted-foreground">Tip: Drag handles to edit. ESC cancels active drawing.</div>
	                    </div>
	                  )}
	                </div>

	                {/* Interaction */}
	                <div className="rounded-lg border p-3">
	                  <div className="text-xs font-semibold text-muted-foreground">Interaction</div>
	                  <div className="mt-2 flex flex-wrap gap-2">
	                    <Button
	                      size="sm"
	                      variant={snapEnabled ? "default" : "outline"}
	                      onClick={() => setSnapEnabled((v) => !v)}
	                      title="Snap to nearby points"
	                    >
	                      Snap
	                    </Button>
	                    <Button
	                      size="sm"
	                      variant={orthoEnabled && !shiftDown ? "default" : "outline"}
	                      onClick={() => setOrthoEnabled((v) => !v)}
	                      title="Ortho locks segments to horizontal/vertical. Hold Shift to temporarily disable while drawing."
	                    >
	                      Ortho{shiftDown ? " (Shift)" : ""}
	                    </Button>
	                    <Button size="sm" variant="outline" onClick={() => setShortcutsOpen(true)}>
	                      Shortcuts
	                    </Button>
	                  </div>
	                  <div className="mt-2 text-xs text-muted-foreground">
	                    Default: Ortho ON. Hold <span className="font-medium">Shift</span> to turn Ortho OFF.
	                  </div>
	                </div>

	                {/* Quick actions */}
	                <div className="rounded-lg border p-3">
	                  <div className="text-xs font-semibold text-muted-foreground">Quick actions</div>
	                  <div className="mt-2 flex flex-wrap gap-2">
	                    <Button size="sm" variant="outline" onClick={clearAllMarkupsForPage} disabled={!pageItems.length}>
	                      Clear page
	                    </Button>
	                    <Button size="sm" variant="outline" onClick={undo} disabled={undoCount === 0}>
	                      Undo
	                    </Button>
	                    <Button size="sm" variant="outline" onClick={redo} disabled={redoCount === 0}>
	                      Redo
	                    </Button>
	                  </div>
	                </div>

	                {/* Page summary / classification */}
	                <div className="rounded-lg border p-3">
	                  <div className="text-xs font-semibold text-muted-foreground">This page</div>
	                  <div className="mt-2 space-y-1 text-sm">
	                    <div className="flex justify-between"><span>Count</span><span>{pageItems.filter((i) => i.kind === "count").length}</span></div>
	                    <div className="flex justify-between"><span>Lines</span><span>{pageItems.filter((i) => i.kind === "line").length}</span></div>
	                    <div className="flex justify-between"><span>Areas</span><span>{pageItems.filter((i) => i.kind === "area").length}</span></div>
	                    <div className="flex justify-between"><span>Measures</span><span>{pageItems.filter((i) => i.kind === "measure").length}</span></div>
	                  </div>

	                  <div className="mt-3 border-t pt-3">
	                    <div className="text-xs font-semibold text-muted-foreground">Markup classification</div>
	                    <div className="mt-2 space-y-2">
	                      {templates.map((t) => {
	                        const its = pageItems.filter((i) => i.templateId === t.id || (i.templateName === t.name && i.kind === t.kind));
	                        if (!its.length) return null;
	
	                        const token = t.style.token;
	                        const qty = (() => {
	                          if (t.kind === "count") {
	                            const n = its.reduce((acc, it) => acc + (it.kind === "count" ? it.value ?? 1 : 0), 0);
	                            return `${n} ${t.uom || "ea"}`;
	                          }
	                          if (t.kind === "area") {
	                            const aPx2 = its.reduce((acc, it) => acc + (it.kind === "area" ? polygonArea(it.pts) : 0), 0);
	                            if (!calibration) return `${aPx2.toFixed(1)} px²`;
	                            const m2 = aPx2 * (calibration.metersPerDocPx * calibration.metersPerDocPx);
	                            return formatArea(m2, calibration.displayUnit);
	                          }
	                          const lenPx = its.reduce((acc, it) => {
	                            if (it.kind === "measure" || it.kind === "line") return acc + dist(it.a, it.b);
	                            return acc;
	                          }, 0);
	                          if (!calibration) return `${lenPx.toFixed(1)} px`;
	                          const m = lenPx * calibration.metersPerDocPx;
	                          return formatLength(m, calibration.displayUnit);
	                        })();

	                        return (
	                          <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
	                            <div className="flex min-w-0 items-center gap-2">
	                              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: hsl(token) }} />
	                              <div className="min-w-0">
	                                <div className="truncate text-sm font-medium">{t.name}</div>
	                                <div className="truncate text-xs text-muted-foreground">{t.category} • {t.kind.toUpperCase()}</div>
	                              </div>
	                            </div>
	                            <div className="text-sm">{qty}</div>
	                          </div>
	                        );
	                      })}
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
