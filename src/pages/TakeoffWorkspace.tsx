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
import { useAuth } from "@/hooks/useAuth";

import { STATUS_LABELS, ProjectStatus } from "@/types/project";

// PDF.js
import { GlobalWorkerOptions, OPS, getDocument } from "pdfjs-dist";
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

const DEFAULT_LEGEND_STATE: LegendState = {
  x: 16,
  y: 16,
  w: 300,
  h: 160,
  font: 12,
  open: true,
};

const PAN_CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='white' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M7 11V6a1 1 0 0 1 2 0v5'/><path d='M9 11V5a1 1 0 1 1 2 0v6'/><path d='M11 11V4a1 1 0 1 1 2 0v7'/><path d='M13 11V5a1 1 0 1 1 2 0v6'/><path d='M5 12c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z'/></svg>";
const PAN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PAN_CURSOR_SVG)}") 8 8, grab`;
const PAN_CURSOR_GRABBING = `url("data:image/svg+xml,${encodeURIComponent(PAN_CURSOR_SVG)}") 8 8, grabbing`;



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

type LegendState = { x: number; y: number; w: number; h: number; font: number; open: boolean };

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
      pts?: Point[];
      closed?: boolean;
      strokeWidth?: number;
      dashed?: boolean;
      arrowEnd?: boolean;

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

type LineItem = Extract<TakeoffItem, { kind: "line" }>;

function isLineItem(it: TakeoffItem): it is LineItem {
  return it.kind === "line";
}

type TakeoffItemRow = {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number;
  owner_id: string;
  kind: string;
  layer_id: string | null;
  name: string | null;
  quantity: number | null;
  uom: string | null;
  meta: any;
  created_at?: string;
  updated_at?: string;
};

type TakeoffGeometryRow = {
  takeoff_item_id: string;
  geom_type: "point" | "polyline" | "polygon";
  points: Array<{ x: number; y: number }>;
};

type Segment = { a: Point; b: Point };

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

function lineItemPoints(it: TakeoffItem): Point[] {
  if (it.kind === "line" && it.pts && it.pts.length > 1) return it.pts;
  if (it.kind === "line" || it.kind === "measure") return [it.a, it.b];
  return [];
}

function lineLengthPx(it: TakeoffItem): number {
  const pts = lineItemPoints(it);
  if (pts.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    sum += dist(pts[i], pts[i + 1]);
  }
  if (it.kind === "line" && it.closed && pts.length > 2) {
    sum += dist(pts[pts.length - 1], pts[0]);
  }
  return sum;
}

function applyTransform(m: number[], p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

function multiplyTransform(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
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

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 0.000001) return null;

  const cma = { x: c.x - a.x, y: c.y - a.y };
  const t = (cma.x * s.y - cma.y * s.x) / denom;
  const u = (cma.x * r.y - cma.y * r.x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
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
  if (it.templateName) return it.templateName;
  if (it.kind === "count" && it.label) return it.label;
  return it.kind.toUpperCase();
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
  allowRightClick = false,
}: {
  containerRef: React.RefObject<HTMLElement>;
  enabled: boolean;
  allowRightClick?: boolean;
}) {
  const isDraggingRef = useRef(false);
  const startRef = useRef<
    | {
        x: number;
        y: number;
        scrollLeft: number;
        scrollTop: number;
        button: number;
      }
    | null
  >(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = enabled ? PAN_CURSOR : "";

    function onPointerDown(e: PointerEvent) {
      const isRightClick = e.button === 2;
      if (!enabled && !isRightClick) return;
      if (isRightClick && !allowRightClick) return;
      if (!isRightClick && e.button !== 0) return;

      isDraggingRef.current = true;
      startRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        button: e.button,
      };
      el.style.cursor = PAN_CURSOR_GRABBING;
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDraggingRef.current || !startRef.current) return;
      if (!enabled && startRef.current.button !== 2) return;

      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      el.scrollLeft = startRef.current.scrollLeft - dx;
      el.scrollTop = startRef.current.scrollTop - dy;
      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!enabled && startRef.current?.button !== 2) return;
      isDraggingRef.current = false;
      startRef.current = null;
      el.style.cursor = enabled ? PAN_CURSOR : "";
      e.preventDefault();
    }

    function onContextMenu(e: MouseEvent) {
      if (!allowRightClick) return;
      e.preventDefault();
    }

    el.addEventListener("pointerdown", onPointerDown, { passive: false });
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp, { passive: false });
    el.addEventListener("pointercancel", onPointerUp, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.style.cursor = "";
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [containerRef, enabled, allowRightClick]);
}

function PdfCanvasViewer({
  pdfDoc,
  pageNumber,
  rotation,
  renderScale,
  onViewport,
}: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  renderScale: number;
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

        const viewport = page.getViewport({ scale: renderScale, rotation });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "100%";

        onViewportRef.current({ width: canvas.width, height: canvas.height }, renderScale);

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
  }, [pdfDoc, pageNumber, rotation, renderScale, onViewport]);

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
  const { user } = useAuth();

  // Panels
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Items (Supabase persistence)
  const [items, setItems] = useState<TakeoffItem[]>([]);

  // Tooling
  const [tool, setTool] = useState<Tool>("select");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(true);
  const [shiftDown, setShiftDown] = useState(false);
  const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);

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
    kind: "measure";
    a: Point;
    b: Point;
    done: boolean;
  } | null>(null);

  const [areaDraft, setAreaDraft] = useState<{
    pts: Point[];
    cursor?: Point;
  } | null>(null);
  const [lineDraft, setLineDraft] = useState<{
    pts: Point[];
    cursor?: Point;
  } | null>(null);
  const areaDragRef = useRef<{
    active: boolean;
    start: Point;
    rect: boolean;
  } | null>(null);

  const [scaleDraft, setScaleDraft] = useState<{
    a?: Point;
    b?: Point;
    cursor?: Point;
  } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const lineDragRef = useRef<{
    active: boolean;
    start: Point;
    tool: "measure" | "line";
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
  const draftRef = useRef<typeof draft>(draft);
  const areaDraftRef = useRef<typeof areaDraft>(areaDraft);
  const lineDraftRef = useRef<typeof lineDraft>(lineDraft);
  const activeTemplateRef = useRef<typeof activeTemplate>(activeTemplate);
  const pageNumberRef = useRef<number>(1);
  const itemsRef = useRef<TakeoffItem[]>([]);

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
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    areaDraftRef.current = areaDraft;
  }, [areaDraft]);
  useEffect(() => {
    lineDraftRef.current = lineDraft;
  }, [lineDraft]);
  useEffect(() => {
    activeTemplateRef.current = activeTemplate;
  }, [activeTemplate]);
  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function findLastEndpoint(kind: "line" | "area" | "count") {
    const tpl = activeTemplateRef.current;
    const tplId = tpl?.id;
    const page = pageNumberRef.current;
    const list = itemsRef.current;

    for (let i = list.length - 1; i >= 0; i -= 1) {
      const it = list[i];
      if (it.page !== page) continue;
      if (it.kind !== kind) continue;
      if (tplId && it.templateId && it.templateId !== tplId) continue;

      if (kind === "count" && "p" in it) return it.p;
      if (kind === "area" && "pts" in it) {
        const pts = it.pts;
        return pts.length ? pts[pts.length - 1] : null;
      }
      if (kind === "line" && "b" in it) return it.b;
    }

    return null;
  }

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

      if (!mod && !e.altKey && (key === "n" || key === "r")) {
        e.preventDefault();
        const currentDraft = draftRef.current;
        const currentArea = areaDraftRef.current;
        const currentLine = lineDraftRef.current;
        const currentTpl = activeTemplateRef.current;
        const currentPage = pageNumberRef.current;
        const currentTool = toolRef.current;
        const lastFromItems = (kind: "line" | "area" | "count") => findLastEndpoint(kind);

        const commitLineDraft = () => {
          if (!currentLine?.pts?.length || currentLine.pts.length < 2) return;
          const tpl = currentTpl && currentTpl.kind === "line" ? currentTpl : null;
          const meta = tpl
            ? {
                templateId: tpl.id,
                templateName: tpl.name,
                category: tpl.category,
                uom: tpl.uom,
                isMarkup: tpl.isMarkup,
              }
            : {};
          const lineProps = {
            closed: false,
            dashed: false,
            strokeWidth: 3,
            arrowEnd: false,
          };
          commitItems((itemsPrev) => {
            const next = [...itemsPrev];
            for (let i = 0; i < currentLine.pts.length - 1; i += 1) {
              next.push({
                id: safeId(),
                kind: "line",
                page: currentPage,
                a: currentLine.pts[i],
                b: currentLine.pts[i + 1],
                ...lineProps,
                style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
                ...meta,
              });
            }
            return next;
          });
        };

        const commitAreaDraft = () => {
          if (!currentArea?.pts?.length || currentArea.pts.length < 3) return;
          const tpl = currentTpl && currentTpl.kind === "area" ? currentTpl : null;
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
              page: currentPage,
              pts: currentArea.pts,
              style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
              ...meta,
            },
          ]);
        };

        if (currentTool === "line") {
          const lastPoint =
            key === "r"
              ? lastFromItems("line")
              : currentLine?.pts?.length
                ? currentLine.pts[currentLine.pts.length - 1]
                : lastFromItems("line");
          if (key === "n") commitLineDraft();
          setLineDraft(lastPoint ? { pts: [lastPoint], cursor: lastPoint } : null);
          lineDragRef.current = null;
          setSnapIndicator(lastPoint ?? null);
          return;
        }

        if (currentTool === "area") {
          const lastPoint =
            key === "r"
              ? lastFromItems("area")
              : currentArea?.pts?.length
                ? currentArea.pts[currentArea.pts.length - 1]
                : lastFromItems("area");
          if (key === "n") commitAreaDraft();
          setAreaDraft(lastPoint ? { pts: [lastPoint], cursor: lastPoint } : null);
          areaDragRef.current = null;
          setSnapIndicator(lastPoint ?? null);
          return;
        }

        if (currentTool === "count") {
          const lastPoint = lastFromItems("count");
          if (key === "n" || key === "r") setSnapIndicator(lastPoint ?? null);
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
        setLineDraft(null);
        setScaleDraft(null);
        setCalibrateOpen(false);
        setCalibratePx(null);
        dragRef.current = null;
        lineDragRef.current = null;
        areaDragRef.current = null;
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
  const [signedUrl, setSignedUrl] = useState("");
  const [pdfSegments, setPdfSegments] = useState<Segment[]>([]);

  // Viewer state
  const [rotation, setRotation] = useState(0);
  const [uiZoom, setUiZoom] = useState(1);
  const uiZoomRef = useRef(uiZoom);
  const [renderScale, setRenderScale] = useState(PDF_RENDER_SCALE);
  const renderScaleTimerRef = useRef<number | null>(null);
  const zoomAnimFrameRef = useRef<number | null>(null);

  useEffect(() => {
    uiZoomRef.current = uiZoom;
  }, [uiZoom]);

  useEffect(() => {
    if (renderScaleTimerRef.current) {
      window.clearTimeout(renderScaleTimerRef.current);
    }
    renderScaleTimerRef.current = window.setTimeout(() => {
      const nextScale = clamp(Number((PDF_RENDER_SCALE * uiZoom).toFixed(3)), 0.8, 4);
      setRenderScale(nextScale);
    }, 150);

    return () => {
      if (renderScaleTimerRef.current) {
        window.clearTimeout(renderScaleTimerRef.current);
      }
    };
  }, [uiZoom]);

  const [legendState, setLegendState] = useState<LegendState>(DEFAULT_LEGEND_STATE);
  const viewerStateLoadedRef = useRef(false);
  const legendStateLoadedRef = useRef(false);
  const preferredPageRef = useRef<number | null>(null);

  useEffect(() => {
    viewerStateLoadedRef.current = false;
    preferredPageRef.current = null;

    if (!activeDocId || !projectId || !user?.id) {
      setRotation(0);
      setUiZoom(1);
      setPageNumber(1);
      viewerStateLoadedRef.current = true;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await db
          .from("takeoff_viewer_states")
          .select("page_number,rotation,ui_zoom")
          .eq("document_id", activeDocId)
          .maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        const nextPage = Math.max(1, Number(data?.page_number ?? 1));
        const nextRotation = Number(data?.rotation ?? 0);
        const nextZoom = clamp(Number(data?.ui_zoom ?? 1), 0.2, 6);

        preferredPageRef.current = nextPage;
        setRotation(nextRotation);
        setUiZoom(nextZoom);
        setPageNumber(nextPage);
      } catch {
        if (cancelled) return;
        setRotation(0);
        setUiZoom(1);
        setPageNumber(1);
      } finally {
        viewerStateLoadedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocId, projectId, user?.id]);

  useEffect(() => {
    if (!activeDocId || !projectId || !user?.id) return;
    if (!viewerStateLoadedRef.current) return;

    const handle = window.setTimeout(async () => {
      const payload = {
        project_id: projectId,
        document_id: activeDocId,
        owner_id: user.id,
        page_number: pageNumber,
        rotation,
        ui_zoom: uiZoom,
      };

      const { error } = await db
        .from("takeoff_viewer_states")
        .upsert(payload, { onConflict: "document_id" });

      if (error) {
        toast({
          title: "Viewer state not saved",
          description: error.message,
          variant: "destructive",
        });
      }
    }, 400);

    return () => {
      window.clearTimeout(handle);
    };
  }, [activeDocId, projectId, user?.id, pageNumber, rotation, uiZoom]);

  useEffect(() => {
    legendStateLoadedRef.current = false;

    if (!activeDocId || !projectId || !user?.id) {
      setLegendState(DEFAULT_LEGEND_STATE);
      legendStateLoadedRef.current = true;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await db
          .from("takeoff_legend_states")
          .select("state")
          .eq("document_id", activeDocId)
          .eq("page_number", pageNumber)
          .maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        const parsed = (data?.state ?? {}) as Partial<LegendState>;
        setLegendState({
          ...DEFAULT_LEGEND_STATE,
          ...parsed,
          open: typeof parsed.open === "boolean" ? parsed.open : DEFAULT_LEGEND_STATE.open,
        });
      } catch {
        if (cancelled) return;
        setLegendState(DEFAULT_LEGEND_STATE);
      } finally {
        legendStateLoadedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocId, pageNumber, projectId, user?.id]);

  useEffect(() => {
    if (!activeDocId || !projectId || !user?.id) return;
    if (!legendStateLoadedRef.current) return;

    const handle = window.setTimeout(async () => {
      const payload = {
        project_id: projectId,
        document_id: activeDocId,
        page_number: pageNumber,
        owner_id: user.id,
        state: legendState,
      };

      const { error } = await db
        .from("takeoff_legend_states")
        .upsert(payload, { onConflict: "document_id,page_number" });

      if (error) {
        toast({
          title: "Legend state not saved",
          description: error.message,
          variant: "destructive",
        });
      }
    }, 400);

    return () => {
      window.clearTimeout(handle);
    };
  }, [activeDocId, pageNumber, projectId, user?.id, legendState]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxRef = useRef<HTMLDivElement | null>(null);
  const viewerBoxSize = useResizeObserverSize(viewerBoxRef);

  // Base viewport size at PDF_RENDER_SCALE
  const viewportBaseRef = useRef<Size>({ width: 0, height: 0 });
  const [viewportBasePx, setViewportBasePx] = useState<Size>({ width: 0, height: 0 });

  const handleViewport = React.useCallback((nextViewport: Size, renderedAtScale: number) => {
    const scaleFactor = PDF_RENDER_SCALE / Math.max(renderedAtScale || 1, 0.0001);
    const normalized: Size = {
      width: Math.floor(nextViewport.width * scaleFactor),
      height: Math.floor(nextViewport.height * scaleFactor),
    };
    const cur = viewportBaseRef.current;
    if (cur.width === normalized.width && cur.height === normalized.height) return;
    viewportBaseRef.current = normalized;
    setViewportBasePx(normalized);
  }, []);

  useEffect(() => {
    if (!pdfDoc) {
      setPdfSegments([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE, rotation });
        const opList = await page.getOperatorList();
        if (cancelled) return;

        const segments: Segment[] = [];
        let transform = viewport.transform.slice() as number[];
        const stack: number[][] = [];
        let current: Point | null = null;
        let subpathStart: Point | null = null;

        const moveTo = (x: number, y: number) => {
          const p = applyTransform(transform, { x, y });
          current = p;
          subpathStart = p;
        };

        const lineTo = (x: number, y: number) => {
          if (!current) {
            moveTo(x, y);
            return;
          }
          const p = applyTransform(transform, { x, y });
          segments.push({ a: current, b: p });
          current = p;
        };

        const closePath = () => {
          if (current && subpathStart) {
            segments.push({ a: current, b: subpathStart });
            current = subpathStart;
          }
        };

        const handleRect = (x: number, y: number, w: number, h: number) => {
          moveTo(x, y);
          lineTo(x + w, y);
          lineTo(x + w, y + h);
          lineTo(x, y + h);
          closePath();
        };

        const handleCurve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
          // Approximate curves as straight to end point for snapping.
          lineTo(x3, y3);
        };

        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i] as any[];

          switch (fn) {
            case OPS.save:
              stack.push(transform.slice());
              break;
            case OPS.restore:
              transform = stack.pop() ?? transform;
              break;
            case OPS.transform:
              transform = multiplyTransform(transform, args as number[]);
              break;
            case OPS.moveTo:
              moveTo(args[0], args[1]);
              break;
            case OPS.lineTo:
              lineTo(args[0], args[1]);
              break;
            case OPS.curveTo:
              handleCurve(args[0], args[1], args[2], args[3], args[4], args[5]);
              break;
            case OPS.curveTo2:
              handleCurve(args[0], args[1], args[2], args[3], args[2], args[3]);
              break;
            case OPS.curveTo3:
              handleCurve(args[0], args[1], args[0], args[1], args[2], args[3]);
              break;
            case OPS.closePath:
              closePath();
              break;
            case OPS.rectangle:
              handleRect(args[0], args[1], args[2], args[3]);
              break;
            case OPS.constructPath: {
              const ops = args[0] as number[];
              const coords = args[1] as number[];
              let c = 0;
              for (const op of ops) {
                switch (op) {
                  case OPS.moveTo:
                    moveTo(coords[c++], coords[c++]);
                    break;
                  case OPS.lineTo:
                    lineTo(coords[c++], coords[c++]);
                    break;
                  case OPS.curveTo:
                    handleCurve(coords[c++], coords[c++], coords[c++], coords[c++], coords[c++], coords[c++]);
                    break;
                  case OPS.curveTo2:
                    handleCurve(coords[c++], coords[c++], coords[c++], coords[c++], coords[c - 2], coords[c - 1]);
                    break;
                  case OPS.curveTo3:
                    handleCurve(coords[c++], coords[c++], coords[c++], coords[c++], coords[c - 2], coords[c - 1]);
                    break;
                  case OPS.closePath:
                    closePath();
                    break;
                  case OPS.rectangle:
                    handleRect(coords[c++], coords[c++], coords[c++], coords[c++]);
                    break;
                  default:
                    break;
                }
              }
              break;
            }
            default:
              break;
          }
        }

        if (segments.length > 8000) {
          const step = Math.ceil(segments.length / 8000);
          setPdfSegments(segments.filter((_, idx) => idx % step === 0));
        } else {
          setPdfSegments(segments);
        }
      } catch {
        if (!cancelled) setPdfSegments([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, rotation]);

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

  function zoomAt(nextZoom: number, anchorClient?: { x: number; y: number }) {
    const el = scrollRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const localX = (anchorClient?.x ?? rect.left + rect.width / 2) - rect.left;
    const localY = (anchorClient?.y ?? rect.top + rect.height / 2) - rect.top;

    const startZoom = uiZoomRef.current;
    const docX = (el.scrollLeft + localX) / Math.max(startZoom, 0.0001);
    const docY = (el.scrollTop + localY) / Math.max(startZoom, 0.0001);

    if (zoomAnimFrameRef.current) {
      cancelAnimationFrame(zoomAnimFrameRef.current);
      zoomAnimFrameRef.current = null;
    }

    const durationMs = 60;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const z = startZoom + (nextZoom - startZoom) * ease;

      uiZoomRef.current = z;
      setUiZoom(z);

      const targetLeft = docX * z - localX;
      const targetTop = docY * z - localY;
      el.scrollLeft = Math.max(0, targetLeft);
      el.scrollTop = Math.max(0, targetTop);

      if (t < 1) {
        zoomAnimFrameRef.current = requestAnimationFrame(tick);
      } else {
        zoomAnimFrameRef.current = null;
      }
    };

    zoomAnimFrameRef.current = requestAnimationFrame(tick);
  }

  // Wheel zoom around cursor (CSS zoom only)
  function onViewerWheel(e: React.WheelEvent) {
    // Wheel = zoom only (Bluebeam/PlanSwift-style). Prevent the page / sidebars from scrolling.
    e.preventDefault();
    e.stopPropagation();

    const direction = e.deltaY > 0 ? -1 : 1;
    const step = 0.15;
    const currentZoom = uiZoomRef.current;
    const nextZoom = clamp(Number((currentZoom * (1 + direction * step)).toFixed(3)), 0.2, 6);
    zoomAt(nextZoom, { x: e.clientX, y: e.clientY });
  }

  // Drag pan with left click when tool === pan, right click for any tool.
  useDragPan({ containerRef: scrollRef, enabled: tool === "pan", allowRightClick: true });

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
          setSnapIndicator(snapped.x !== orthoP.x || snapped.y !== orthoP.y ? snapped : null);
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
          setSnapIndicator(snapped.x !== orthoP.x || snapped.y !== orthoP.y ? snapped : null);
          return { ...prev, cursor: snapped };
        });
        return;
      }

      if (tool === "line") {
        setLineDraft((prev) => {
          if (!prev) return prev;
          const anchor = prev.pts.length ? prev.pts[prev.pts.length - 1] : rawP;
          const orthoP = prev.pts.length ? applyOrtho(anchor, rawP, shiftKey) : rawP;
          const snapped = snapPointToExisting(orthoP);
          setSnapIndicator(snapped.x !== orthoP.x || snapped.y !== orthoP.y ? snapped : null);
          return { ...prev, cursor: snapped };
        });
        return;
      }

      setDraft((prev) => {
        if (!prev) return prev;
        const anchor = prev.a ?? rawP;
        const orthoP = prev.a ? applyOrtho(anchor, rawP, shiftKey) : rawP;
        const snapped = snapPointToExisting(orthoP);
        setSnapIndicator(snapped.x !== orthoP.x || snapped.y !== orthoP.y ? snapped : null);
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
  const candidates: Array<{ seg: Segment; d: number }> = [];

  const addCandidate = (a: Point, b: Point) => {
    const d = distToSegment(p, a, b);
    if (d <= tol * 2) candidates.push({ seg: { a, b }, d });
  };

  for (const seg of pdfSegments) {
    const d = distToSegment(p, seg.a, seg.b);
    if (d <= tol && (!best || d < best.d)) {
      const abx = seg.b.x - seg.a.x;
      const aby = seg.b.y - seg.a.y;
      const apx = p.x - seg.a.x;
      const apy = p.y - seg.a.y;
      const denom = abx * abx + aby * aby;
      const t = denom <= 0.000001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
      best = { p: { x: seg.a.x + t * abx, y: seg.a.y + t * aby }, d };
    }
    addCandidate(seg.a, seg.b);
  }

  for (const it of pageItems) {
    if (it.kind === "count") {
      const d = dist(p, it.p);
      if (d <= tol && (!best || d < best.d)) best = { p: it.p, d };
      continue;
    }

    if (it.kind === "area") {
      const pts = it.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const d = distToSegment(p, a, b);
        if (d <= tol && (!best || d < best.d)) {
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const apx = p.x - a.x;
          const apy = p.y - a.y;
          const denom = abx * abx + aby * aby;
          const t = denom <= 0.000001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
          best = { p: { x: a.x + t * abx, y: a.y + t * aby }, d };
        }
        addCandidate(a, b);
      }
      continue;
    }

    if (it.kind === "line" && it.pts && it.pts.length > 1) {
      for (let i = 0; i < it.pts.length - 1; i += 1) {
        const a = it.pts[i];
        const b = it.pts[i + 1];
        const endpoints = [a, b];
        for (const c of endpoints) {
          const d = dist(p, c);
          if (d <= tol && (!best || d < best.d)) best = { p: c, d };
        }
        const d = distToSegment(p, a, b);
        if (d <= tol && (!best || d < best.d)) {
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const apx = p.x - a.x;
          const apy = p.y - a.y;
          const denom = abx * abx + aby * aby;
          const t = denom <= 0.000001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
          best = { p: { x: a.x + t * abx, y: a.y + t * aby }, d };
        }
        addCandidate(a, b);
      }
      continue;
    }

    // line/measure: snap to endpoints and any point along the segment
    const endpoints = [it.a, it.b];
    for (const c of endpoints) {
      const d = dist(p, c);
      if (d <= tol && (!best || d < best.d)) best = { p: c, d };
    }
    const d = distToSegment(p, it.a, it.b);
    if (d <= tol && (!best || d < best.d)) {
      const abx = it.b.x - it.a.x;
      const aby = it.b.y - it.a.y;
      const apx = p.x - it.a.x;
      const apy = p.y - it.a.y;
      const denom = abx * abx + aby * aby;
      const t = denom <= 0.000001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
      best = { p: { x: it.a.x + t * abx, y: it.a.y + t * aby }, d };
    }
    addCandidate(it.a, it.b);
  }

  if (candidates.length > 1) {
    const limited = candidates
      .sort((a, b) => a.d - b.d)
      .slice(0, 24)
      .map((c) => c.seg);
    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        const inter = segmentIntersection(limited[i].a, limited[i].b, limited[j].a, limited[j].b);
        if (!inter) continue;
        const d = dist(p, inter);
        if (d <= tol && (!best || d < best.d)) best = { p: inter, d };
      }
    }
  }
  return best ? best.p : p;
}

function normalizePointForTool(raw: Point, shiftKey: boolean): Point {
  let p = raw;

  // Ortho is ON by default; holding Shift temporarily disables it.
  if (tool === "measure") {
    const anchor = draft?.a ?? null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  } else if (tool === "line") {
    const anchor = lineDraft?.pts?.length ? lineDraft.pts[lineDraft.pts.length - 1] : null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  } else if (tool === "scale") {
    const anchor = scaleDraft?.a ?? null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  } else if (tool === "area") {
    const anchor = areaDraft?.pts?.length ? areaDraft.pts[areaDraft.pts.length - 1] : null;
    if (anchor && orthoEnabled) p = applyOrtho(anchor, p, shiftKey);
  }

  // Snap after ortho, so snapping respects constrained direction.
  const snapped = snapPointToExisting(p);
  const didSnap = snapped.x !== p.x || snapped.y !== p.y;
  setSnapIndicator(didSnap ? snapped : null);
  p = snapped;

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
    } else if (it.kind === "line" && it.pts && it.pts.length > 1) {
      for (let i = 0; i < it.pts.length - 1; i += 1) {
        const a = it.pts[i];
        const b = it.pts[i + 1];
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

    if (it.kind === "line" && it.pts && it.pts.length > 1) {
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

function mergeConnectedLineGroup(start: TakeoffItem) {
  if (!isLineItem(start)) return start.id;
  if (start.pts && start.pts.length > 2) return start.id;
  const tol = 6 / Math.max(uiZoom, 0.0001);
  const keyFor = (pt: Point) => `${Math.round(pt.x / tol)}:${Math.round(pt.y / tol)}`;

  const matchTemplateId = start.templateId ?? null;
  const matchName = start.templateName ?? null;

  const candidates = items.filter((it): it is LineItem => {
    if (!isLineItem(it)) return false;
    if (it.page !== pageNumber) return false;
    if (it.pts && it.pts.length > 2) return false;
    if (matchTemplateId && it.templateId !== matchTemplateId) return false;
    if (!matchTemplateId && matchName && it.templateName !== matchName) return false;
    return true;
  });

  if (candidates.length <= 1) return start.id;

  const byKey = new Map<string, string[]>();
  const pointForKey = new Map<string, Point>();

  for (const it of candidates) {
    const endpoints = [it.a, it.b];
    for (const p of endpoints) {
      const key = keyFor(p);
      pointForKey.set(key, pointForKey.get(key) ?? p);
      const list = byKey.get(key) ?? [];
      list.push(it.id);
      byKey.set(key, list);
    }
  }

  const queue = [start.id];
  const groupIds = new Set<string>();

  while (queue.length) {
    const id = queue.pop()!;
    if (groupIds.has(id)) continue;
    groupIds.add(id);

    const it = candidates.find((c) => c.id === id);
    if (!it) continue;

    for (const p of [it.a, it.b]) {
      const key = keyFor(p);
      const neighbors = byKey.get(key) ?? [];
      for (const n of neighbors) {
        if (!groupIds.has(n)) queue.push(n);
      }
    }
  }

  if (groupIds.size <= 1) return start.id;

  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = adjacency.get(a) ?? [];
    list.push(b);
    adjacency.set(a, list);
  };

  for (const it of candidates) {
    if (!groupIds.has(it.id)) continue;
    const ka = keyFor(it.a);
    const kb = keyFor(it.b);
    addEdge(ka, kb);
    addEdge(kb, ka);
  }

  const endpoints = Array.from(adjacency.entries()).filter(([, v]) => v.length === 1);
  const startKey = endpoints.length ? endpoints[0][0] : Array.from(adjacency.keys())[0];
  if (!startKey) return start.id;

  const ordered: Point[] = [];
  const visitedEdges = new Set<string>();
  let prevKey: string | null = null;
  let curKey = startKey;

  while (curKey) {
    ordered.push(pointForKey.get(curKey) ?? { x: 0, y: 0 });
    const neighbors = adjacency.get(curKey) ?? [];
    const nextKey = neighbors.find((n) => n !== prevKey && !visitedEdges.has(`${curKey}:${n}`));
    if (!nextKey) break;
    visitedEdges.add(`${curKey}:${nextKey}`);
    visitedEdges.add(`${nextKey}:${curKey}`);
    prevKey = curKey;
    curKey = nextKey;
    if (curKey === startKey) break;
  }

  const closed = endpoints.length === 0 && ordered.length > 2;

  const newId = safeId();
  const lineProps = {
    closed,
    dashed: Boolean(start.dashed),
    strokeWidth: typeof start.strokeWidth === "number" ? start.strokeWidth : 3,
    arrowEnd: Boolean(start.arrowEnd),
  };

  commitItems((prev) => {
    const next = prev.filter((it) => !groupIds.has(it.id));
    next.push({
      ...start,
      id: newId,
      pts: ordered,
      a: ordered[0],
      b: ordered[ordered.length - 1],
      ...lineProps,
    });
    return next;
  });

  return newId;
}

function onOverlayPointerDown(e: React.PointerEvent, wrapperEl: HTMLElement) {
  if (e.button === 2) {
    if (tool === "measure") {
      if (draft) {
        const raw = docPointFromEvent(e, wrapperEl);
        const p = normalizePointForTool(raw, e.shiftKey);
        const tpl = activeTemplate && activeTemplate.kind === "measure" ? activeTemplate : null;
        const meta = tpl
          ? {
              templateId: tpl.id,
              templateName: tpl.name,
              category: tpl.category,
              uom: tpl.uom,
              isMarkup: tpl.isMarkup,
            }
          : {};
        if (dist(draft.a, p) > 0.01) {
          const id = safeId();
          commitItems((itemsPrev) => [
            ...itemsPrev,
            {
              id,
              kind: "measure",
              page: pageNumber,
              a: draft.a,
              b: p,
              style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
              ...meta,
            },
          ]);
          setSelectedId(id);
        }
        setDraft(null);
        lineDragRef.current = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    return;
  }
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
        if (item.kind === "line") {
          const mergedId = mergeConnectedLineGroup(item);
          setSelectedId(mergedId);
          dragRef.current = null;
          return;
        }
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
    if (areaDraft?.pts?.length) {
      const first = areaDraft.pts[0];
      const tol = 8 / Math.max(uiZoom, 0.0001);
      if (dist(p, first) <= tol && areaDraft.pts.length >= 3) {
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
            pts: areaDraft.pts,
            style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
            ...meta,
          },
        ]);
        setAreaDraft(null);
        areaDragRef.current = null;
        return;
      }

      setAreaDraft((prev) => {
        const next = prev ?? { pts: [] as Point[] };
        return { ...next, pts: [...next.pts, p] };
      });
      return;
    }

    areaDragRef.current = { active: true, start: p, rect: false };
    setAreaDraft({ pts: [p] });
    return;
  }

  if (tool === "line") {
    setLineDraft((prev) => {
      const next = prev ?? { pts: [] as Point[] };
      return { ...next, pts: [...next.pts, p] };
    });
    return;
  }

  if (tool === "measure") {
    setDraft((prev) => {
      if (!prev || prev.done) {
        lineDragRef.current = { active: true, start: p, tool };
        return { kind: "measure", a: p, b: p, done: false };
      }
      const final = { ...prev, b: p, done: true };
      if (dist(final.a, final.b) <= 0.01) return prev;
      const id = safeId();
      commitItems((itemsPrev) => [
        ...itemsPrev,
        {
          id,
          kind: "measure",
          page: pageNumber,
          a: final.a,
          b: final.b,
          style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
          ...meta,
        },
      ]);
      setSelectedId(id);
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
    setSnapIndicator(p.x !== raw.x || p.y !== raw.y ? p : null);
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
          if (origin.kind === "line" && origin.pts) {
            const pts = origin.pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
            return { ...it, pts, a: pts[0], b: pts[pts.length - 1] };
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

        if (origin.kind === "line" && origin.pts && typeof drag.handleIndex === "number") {
          const nextPts = origin.pts.slice();
          nextPts[drag.handleIndex] = p;
          return { ...it, pts: nextPts, a: nextPts[0], b: nextPts[nextPts.length - 1] };
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

  if (tool === "area" && areaDragRef.current?.active) {
    const raw = docPointFromEvent(e, wrapperEl);
    const p = normalizePointForTool(raw, e.shiftKey);
    const start = areaDragRef.current.start;
    const dx = Math.abs(p.x - start.x);
    const dy = Math.abs(p.y - start.y);
    if (dx > 2 || dy > 2) {
      areaDragRef.current.rect = true;
      const rectPts: Point[] = [
        { x: start.x, y: start.y },
        { x: p.x, y: start.y },
        { x: p.x, y: p.y },
        { x: start.x, y: p.y },
      ];
      setAreaDraft({ pts: rectPts, cursor: p });
    }
    return;
  }

  const raw = docPointFromEvent(e, wrapperEl);
  const hoverSnap = snapPointToExisting(raw);
  setSnapIndicator(hoverSnap.x !== raw.x || hoverSnap.y !== raw.y ? hoverSnap : null);

  const hasActivePreview =
    (tool === "scale" && !!scaleDraft?.a) ||
    (tool === "area" && !!areaDraft) ||
    (tool === "line" && !!lineDraft) ||
    (tool === "measure" && !!draft);

  if (!hasActivePreview) return;

  e.preventDefault();
  e.stopPropagation();

  scheduleMoveUpdate(tool, raw, e.shiftKey);
}

function onOverlayPointerUp(e: React.PointerEvent) {
  if (areaDragRef.current?.active && tool === "area") {
    const wasRect = areaDragRef.current.rect;
    const rectDraft = areaDraft;
    areaDragRef.current = null;
    if (wasRect && rectDraft?.pts?.length === 4) {
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
          pts: rectDraft.pts,
          style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
          ...meta,
        },
      ]);
      setAreaDraft(null);
      setSnapIndicator(null);
      return;
    }
  }
  if (lineDragRef.current?.active && draft && tool === "measure") {
    const didDrag = dist(draft.a, draft.b) > 0.5;
    lineDragRef.current = null;
    if (didDrag) {
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
      const id = safeId();
      commitItems((itemsPrev) => [
        ...itemsPrev,
        {
          id,
          kind: tool,
          page: pageNumber,
          a: draft.a,
          b: draft.b,
          style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
          ...meta,
        },
      ]);
      setSelectedId(id);
      setDraft(null);
      setSnapIndicator(null);
      return;
    }
  }
  if (tool === "select" && dragRef.current) {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }
  setSnapIndicator(null);
}

function onOverlayDoubleClick(e: React.MouseEvent) {
  if (tool === "line" && lineDraft?.pts?.length) {
    e.preventDefault();
    e.stopPropagation();

    const pts = lineDraft.pts;
    if (pts.length < 2) return;

    const tpl = activeTemplate && activeTemplate.kind === "line" ? activeTemplate : null;
    const meta = tpl
      ? {
          templateId: tpl.id,
          templateName: tpl.name,
          category: tpl.category,
          uom: tpl.uom,
          isMarkup: tpl.isMarkup,
        }
      : {};

    const lineProps = {
      closed: false,
      dashed: false,
      strokeWidth: 3,
      arrowEnd: false,
    };
    let lastId: string | null = null;
    commitItems((itemsPrev) => {
      const next = [...itemsPrev];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const id = safeId();
        lastId = id;
        next.push({
          id,
          kind: "line",
          page: pageNumber,
          a: pts[i],
          b: pts[i + 1],
          ...lineProps,
          style: tpl?.style ?? { token: pickNextColorToken(itemsPrev) },
          ...meta,
        });
      }
      return next;
    });
    if (lastId) setSelectedId(lastId);
    setLineDraft(null);
    return;
  }
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
  const [calibrationByPage, setCalibrationByPage] = useState<Map<number, Calibration>>(new Map());
  useEffect(() => {
    if (!activeDocId || !projectId || !user?.id) {
      setCalibration(null);
      setCalibrationByPage(new Map());
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await db
          .from("takeoff_calibrations")
          .select("meters_per_doc_px,display_unit,label")
          .eq("document_id", activeDocId)
          .eq("page_number", pageNumber)
          .maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        if (data?.meters_per_doc_px) {
          setCalibration({
            metersPerDocPx: Number(data.meters_per_doc_px),
            displayUnit: (data.display_unit as Calibration["displayUnit"]) ?? "m",
            label: data.label ?? undefined,
          });
        } else {
          setCalibration(null);
        }
      } catch {
        if (cancelled) return;
        setCalibration(null);
      } finally {
        // no-op
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocId, pageNumber, projectId, user?.id]);

  useEffect(() => {
    if (!activeDocId || !projectId || !user?.id) {
      setCalibrationByPage(new Map());
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await db
          .from("takeoff_calibrations")
          .select("page_number,meters_per_doc_px,display_unit,label")
          .eq("document_id", activeDocId);

        if (error) throw error;
        if (cancelled) return;

        const map = new Map<number, Calibration>();
        for (const row of data ?? []) {
          const page = Number(row.page_number);
          if (!page || !row.meters_per_doc_px) continue;
          map.set(page, {
            metersPerDocPx: Number(row.meters_per_doc_px),
            displayUnit: (row.display_unit as Calibration["displayUnit"]) ?? "m",
            label: row.label ?? undefined,
          });
        }
        setCalibrationByPage(map);
      } catch {
        if (!cancelled) setCalibrationByPage(new Map());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocId, projectId, user?.id]);

  function persistCalibration(next: Calibration | null) {
    void (async () => {
      if (!activeDocId || !projectId || !user?.id) {
        setCalibration(next);
        return;
      }

      if (!next) {
        setCalibration(null);
        const { error } = await db
          .from("takeoff_calibrations")
          .delete()
          .eq("document_id", activeDocId)
          .eq("page_number", pageNumber);
        if (error) {
          toast({
            title: "Scale not cleared",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }

      setCalibration(next);

      const payload = {
        project_id: projectId,
        document_id: activeDocId,
        page_number: pageNumber,
        owner_id: user.id,
        meters_per_doc_px: next.metersPerDocPx,
        display_unit: next.displayUnit,
        label: next.label ?? null,
      };

      const { error } = await db
        .from("takeoff_calibrations")
        .upsert(payload, { onConflict: "document_id,page_number" });

      if (error) {
        toast({
          title: "Scale not saved",
          description: error.message,
          variant: "destructive",
        });
      }
    })();
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

  const lineDraftMeters = useMemo(() => {
    if (!lineDraft || !calibration) return null;
    const pts = lineDraft.pts.length ? [...lineDraft.pts] : [];
    if (lineDraft.cursor) pts.push(lineDraft.cursor);
    if (pts.length < 2) return 0;
    let px = 0;
    for (let i = 0; i < pts.length - 1; i += 1) {
      px += dist(pts[i], pts[i + 1]);
    }
    return px * calibration.metersPerDocPx;
  }, [lineDraft, calibration]);

  // Load PDF when activeDoc changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPdfDoc(null);
        setPdfNumPages(0);
        setSignedUrl("");
        setPageNumber(preferredPageRef.current ?? 1);

        viewportBaseRef.current = { width: 0, height: 0 };
        setViewportBasePx({ width: 0, height: 0 });

        // reset drafts on doc change
        setDraft(null);
        setAreaDraft(null);
        setLineDraft(null);
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
        setPageNumber((prev) => clamp(preferredPageRef.current ?? prev, 1, pdf.numPages));
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

  // Items (Supabase persistence)
  const didLoadItemsRef = useRef(false);
  const loadedItemIdsRef = useRef<Set<string>>(new Set());
  const saveItemsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    didLoadItemsRef.current = false;
    loadedItemIdsRef.current = new Set();

    if (!activeDocId || !projectId || !user?.id) {
      setItems([]);
      didLoadItemsRef.current = true;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: itemRows, error } = await db
          .from("takeoff_items")
          .select("id,project_id,document_id,page_number,owner_id,kind,layer_id,name,quantity,uom,meta")
          .eq("document_id", activeDocId)
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });

        if (error) throw error;

        const rows = (itemRows ?? []) as TakeoffItemRow[];
        const ids = rows.map((row) => row.id);
        let geomRows: TakeoffGeometryRow[] = [];

        if (ids.length) {
          const { data: geomData, error: geomError } = await db
            .from("takeoff_geometries")
            .select("takeoff_item_id,geom_type,points")
            .in("takeoff_item_id", ids);

          if (geomError) throw geomError;
          geomRows = (geomData ?? []) as TakeoffGeometryRow[];
        }

        if (cancelled) return;

        const geomMap = new Map<string, TakeoffGeometryRow>();
        for (const g of geomRows) geomMap.set(g.takeoff_item_id, g);

        const nextItems = rows
          .map((row) => {
            const meta = row.meta ?? {};
            const style = meta.style ?? { token: MARKUP_COLOR_TOKENS[0] };
            const template = {
              templateId: meta.templateId,
              templateName: meta.templateName,
              category: meta.category,
              uom: meta.uom,
              isMarkup: meta.isMarkup,
            };
            const geom = geomMap.get(row.id);
            const pts = geom?.points ?? [];

            if (row.kind === "count") {
              const p = pts[0] ?? { x: 0, y: 0 };
              return {
                id: row.id,
                kind: "count",
                page: row.page_number,
                p,
                style: { ...style, shape: style.shape ?? meta.style?.shape },
                label: meta.label,
                value: meta.value,
                ...template,
              } as TakeoffItem;
            }

            if (row.kind === "area") {
              return {
                id: row.id,
                kind: "area",
                page: row.page_number,
                pts: pts.length ? pts : [],
                style,
                ...template,
              } as TakeoffItem;
            }

            if (row.kind === "line") {
              const a = pts[0] ?? { x: 0, y: 0 };
              const b = pts.length > 1 ? pts[pts.length - 1] : pts[1] ?? { x: 0, y: 0 };
              const lineMeta = meta.line ?? {};
              return {
                id: row.id,
                kind: "line",
                page: row.page_number,
                a,
                b,
                pts: pts.length > 1 ? pts : undefined,
                closed: Boolean(lineMeta.closed),
                dashed: Boolean(lineMeta.dashed),
                strokeWidth: typeof lineMeta.strokeWidth === "number" ? lineMeta.strokeWidth : undefined,
                arrowEnd: Boolean(lineMeta.arrowEnd),
                style,
                ...template,
              } as TakeoffItem;
            }

            if (row.kind === "measure") {
              const a = pts[0] ?? { x: 0, y: 0 };
              const b = pts[1] ?? { x: 0, y: 0 };
              return {
                id: row.id,
                kind: "measure",
                page: row.page_number,
                a,
                b,
                style,
                ...template,
              } as TakeoffItem;
            }

            return null;
          })
          .filter(Boolean) as TakeoffItem[];

        setItems(nextItems);
        loadedItemIdsRef.current = new Set(ids);
      } catch (err: any) {
        if (cancelled) return;
        toast({
          title: "Takeoff items not loaded",
          description: err?.message ?? "Failed to load takeoff items from Supabase.",
          variant: "destructive",
        });
        setItems([]);
      } finally {
        didLoadItemsRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDocId, projectId, user?.id]);

  async function syncTakeoffItems(currentItems: TakeoffItem[]) {
    if (!activeDocId || !projectId || !user?.id) return;

    const itemRows: TakeoffItemRow[] = currentItems.map((it) => ({
      id: it.id,
      project_id: projectId,
      document_id: activeDocId,
      page_number: it.page,
      owner_id: user.id,
      kind: it.kind,
      layer_id: null,
      name: it.templateName ?? (it.kind === "count" ? it.label ?? null : null),
      quantity: null,
      uom: it.uom ?? null,
      meta: {
        style: it.style,
        templateId: it.templateId,
        templateName: it.templateName,
        category: it.category,
        uom: it.uom,
        isMarkup: it.isMarkup,
        label: (it as any).label,
        value: (it as any).value,
        line: it.kind === "line"
          ? {
              closed: Boolean(it.closed),
              dashed: Boolean(it.dashed),
              strokeWidth: typeof it.strokeWidth === "number" ? it.strokeWidth : undefined,
              arrowEnd: Boolean(it.arrowEnd),
            }
          : undefined,
      },
    }));

    const geomRows: TakeoffGeometryRow[] = currentItems.map((it) => {
      if (it.kind === "count") {
        return { takeoff_item_id: it.id, geom_type: "point", points: [it.p] };
      }
      if (it.kind === "area") {
        return { takeoff_item_id: it.id, geom_type: "polygon", points: it.pts };
      }
      if (it.kind === "line" && it.pts && it.pts.length > 1) {
        return { takeoff_item_id: it.id, geom_type: "polyline", points: it.pts };
      }
      return { takeoff_item_id: it.id, geom_type: "polyline", points: [it.a, it.b] };
    });

    const nextIds = new Set(currentItems.map((it) => it.id));
    const removedIds = Array.from(loadedItemIdsRef.current).filter((id) => !nextIds.has(id));

    try {
      if (itemRows.length) {
        const { error } = await db.from("takeoff_items").upsert(itemRows, { onConflict: "id" });
        if (error) throw error;
      }

      if (geomRows.length) {
        const { error } = await db
          .from("takeoff_geometries")
          .upsert(geomRows, { onConflict: "takeoff_item_id" });
        if (error) throw error;
      }

      if (removedIds.length) {
        const { error } = await db.from("takeoff_items").delete().in("id", removedIds);
        if (error) throw error;
      }

      loadedItemIdsRef.current = nextIds;
    } catch (err: any) {
      toast({
        title: "Takeoff items not saved",
        description: err?.message ?? "Failed to persist takeoff items to Supabase.",
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    if (!activeDocId || !projectId || !user?.id) return;
    if (!didLoadItemsRef.current) return;

    if (saveItemsTimerRef.current) {
      window.clearTimeout(saveItemsTimerRef.current);
    }

    saveItemsTimerRef.current = window.setTimeout(() => {
      void syncTakeoffItems(items);
    }, 600);

    return () => {
      if (saveItemsTimerRef.current) {
        window.clearTimeout(saveItemsTimerRef.current);
      }
    };
  }, [activeDocId, projectId, user?.id, items]);

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

function updateSelectedLine(next: Partial<TakeoffItem>) {
  if (!selectedId) return;
  setItems((prev) =>
    prev.map((it) => {
      if (it.id !== selectedId) return it;
      if (it.kind !== "line") return it;
      const updated = { ...it, ...next } as TakeoffItem;
      if (updated.pts && updated.pts.length > 1) {
        updated.a = updated.pts[0];
        updated.b = updated.pts[updated.pts.length - 1];
      }
      return updated;
    })
  );
}

const selectedItem = useMemo(
  () =>
    selectedId
      ? items.find((it) => it.id === selectedId && it.page === pageNumber) ?? null
      : null,
  [items, selectedId, pageNumber]
);

useEffect(() => {
  // Keep active template valid
  if (activeTemplateId && templates.some((t) => t.id === activeTemplateId)) return;
  if (templates.length) setActiveTemplateId(templates[0].id);
}, [templates, activeTemplateId]);

  const pageItems = useMemo(() => items.filter((it) => it.page === pageNumber), [items, pageNumber]);

  const pageSummary = useMemo(() => {
    const linearPx = pageItems.reduce((acc, it) => {
      if (it.kind !== "line") return acc;
      return acc + lineLengthPx(it);
    }, 0);
    const areaPx2 = pageItems
      .filter((it) => it.kind === "area")
      .reduce((acc, it) => acc + polygonArea(it.pts), 0);
    const count = pageItems
      .filter((it) => it.kind === "count")
      .reduce((acc, it) => acc + (it.kind === "count" ? it.value ?? 1 : 0), 0);

    const linearLabel = calibration
      ? formatLength(linearPx * calibration.metersPerDocPx, calibration.displayUnit)
      : `${linearPx.toFixed(1)} px`;
    const areaLabel = calibration
      ? formatArea(areaPx2 * calibration.metersPerDocPx * calibration.metersPerDocPx, calibration.displayUnit)
      : `${areaPx2.toFixed(1)} px2`;

    return { linearLabel, areaLabel, count };
  }, [pageItems, calibration]);

  const pageKindCountsByPage = useMemo(() => {
    const m = new Map<number, { line: number; area: number; count: number }>();
    for (const it of items) {
      const cur = m.get(it.page) ?? { line: 0, area: 0, count: 0 };
      if (it.kind === "line") cur.line += 1;
      else if (it.kind === "area") cur.area += 1;
      else if (it.kind === "count") cur.count += 1;
      m.set(it.page, cur);
    }
    return m;
  }, [items]);

  const pageTakeoffRows = useMemo(() => {
    const byPage = new Map<
      number,
      Array<{ id: string; name: string; token: string; qty: string }>
    >();
    const perPageMaps = new Map<
      number,
      Map<
        string,
        { name: string; token: string; kind: TakeoffTemplateKind; uom?: string; qty: number }
      >
    >();

    for (const it of items) {
      if (it.kind === "measure") continue;
      const page = it.page;
      if (!perPageMaps.has(page)) perPageMaps.set(page, new Map());
      const pageMap = perPageMaps.get(page)!;

      const name = it.templateName || itemDisplayName(it);
      const key = it.templateId || `${it.kind}:${name}:${it.style.token}`;
      const existing =
        pageMap.get(key) ||
        {
          name,
          token: it.style.token,
          kind: it.kind,
          uom: it.uom,
          qty: 0,
        };

      if (it.kind === "count") {
        existing.qty += it.value ?? 1;
      } else if (it.kind === "area") {
        existing.qty += polygonArea(it.pts);
      } else if (it.kind === "line") {
        existing.qty += lineLengthPx(it);
      } else {
        existing.qty += dist(it.a, it.b);
      }

      pageMap.set(key, existing);
    }

    for (const [page, pageMap] of perPageMaps.entries()) {
      const pageCal = calibrationByPage.get(page) ?? null;
      const rows = Array.from(pageMap.values())
        .map((row, idx) => {
          if (row.kind === "count") {
            return {
              id: `${page}-${idx}`,
              name: row.name,
              token: row.token,
              qty: `${Math.round(row.qty)} ${row.uom || "ea"}`,
            };
          }
          if (row.kind === "area") {
            if (!pageCal) {
              return {
                id: `${page}-${idx}`,
                name: row.name,
                token: row.token,
                qty: `${row.qty.toFixed(1)} px²`,
              };
            }
            const m2 = row.qty * (pageCal.metersPerDocPx * pageCal.metersPerDocPx);
            return {
              id: `${page}-${idx}`,
              name: row.name,
              token: row.token,
              qty: formatArea(m2, pageCal.displayUnit),
            };
          }
          if (!pageCal) {
            return {
              id: `${page}-${idx}`,
              name: row.name,
              token: row.token,
              qty: `${row.qty.toFixed(1)} px`,
            };
          }
          const m = row.qty * pageCal.metersPerDocPx;
          return {
            id: `${page}-${idx}`,
            name: row.name,
            token: row.token,
            qty: formatLength(m, pageCal.displayUnit),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      if (rows.length) byPage.set(page, rows);
    }

    return byPage;
  }, [items, calibrationByPage]);

  // Reset drafts when page changes
  useEffect(() => {
    setDraft(null);
    setAreaDraft(null);
    setLineDraft(null);
    setScaleDraft(null);
    setCalibrateOpen(false);
    setCalibratePx(null);
    setSelectedId(null);
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
  setLineDraft(null);
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
  if (kind === "line" || kind === "area" || kind === "count") {
    openTemplateDialog(kind);
    return;
  }
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
          ["select", "↖", "Select"],
          ["pan", "✋", "Pan"],
          ["measure", "📏", "Measure"],
          ["line", "L", "Line"],
          ["area", "A", "Area"],
          ["count", "C", "Count"],
          ["scale", "Scale", "Scale"],
        ] as const
      ).map(([k, icon, label]) => (
        <Button
          key={k}
          size="sm"
          variant={tool === k ? "default" : "outline"}
          onClick={() => {
            setSelectedId(null);
            dragRef.current = null;
	            setToolWithTemplate(k as Tool);
          }}
          title={label}
          aria-label={label}
        >
          <span className="text-xs font-semibold">{icon}</span>
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

    const scale = Math.min(legendState.w / 320, legendState.h / 180);
    const effectiveFont = clamp(Math.round(legendState.font * scale), 9, 18);
    const swatchSize = clamp(Math.round(effectiveFont * 0.9), 8, 14);

    // Build per-template totals for the current page.
    const rows = templates
      .filter((t) => t.kind !== "measure")
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
            if (it.kind === "measure") return acc + dist(it.a, it.b);
            if (it.kind === "line") return acc + lineLengthPx(it);
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

				<div className="h-full overflow-auto p-2" style={{ fontSize: effectiveFont }}>
					<div className="grid gap-1">
						{rows.map((r) => (
							<div
								key={r.id}
								className="grid items-center gap-2 rounded border px-2 py-1"
								style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}
							>
								<span
									className="inline-block shrink-0 rounded-sm"
									style={{ width: swatchSize, height: swatchSize, backgroundColor: hsl(r.token) }}
								/>
								<div className="min-w-0">
									<div className="truncate font-medium">{r.name}</div>
									<div className="truncate text-[0.85em] text-muted-foreground">
                    {r.category} {" > "} {r.kind === "line" ? "LINEAR" : String(r.kind).toUpperCase()}
									</div>
								</div>
								<div className="shrink-0 text-right font-medium">{r.qty}</div>
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
          return PAN_CURSOR;
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

            const pts = lineItemPoints(selectedItem);
            if (selectedItem.kind === "line" && pts.length > 1) {
              const drawPts = selectedItem.closed ? [...pts, pts[0]] : pts;
              return (
                <g>
                  <polyline
                    points={drawPts.map((p) => `${p.x * z},${p.y * z}`).join(" ")}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={selectedItem.strokeWidth ?? 4}
                    strokeDasharray={selectedItem.dashed ? "6 6" : undefined}
                  />
                  {pts.map((p, i) => (
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

          {/* PDF vector edges (debug visualization) */}
          {pdfSegments.length ? (
            <g opacity={0.45}>
              {pdfSegments.map((seg, i) => (
                <line
                  key={`pdf-edge-${i}`}
                  x1={seg.a.x * z}
                  y1={seg.a.y * z}
                  x2={seg.b.x * z}
                  y2={seg.b.y * z}
                  stroke="#111827"
                  strokeWidth={0.6}
                />
              ))}
            </g>
          ) : null}

          {/* Snap indicator */}
          {snapIndicator ? (() => {
            const x = snapIndicator.x * z;
            const y = snapIndicator.y * z;
            const size = 10;
            return (
              <g>
                <rect
                  x={x - size / 2}
                  y={y - size / 2}
                  width={size}
                  height={size}
                  fill="white"
                  stroke="#111827"
                  strokeWidth={1.5}
                />
                <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} stroke="#111827" strokeWidth={1.5} />
                <line x1={x + 4} y1={y - 4} x2={x - 4} y2={y + 4} stroke="#111827" strokeWidth={1.5} />
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
              return <polygon key={it.id} points={pts} fill={fill} stroke={stroke} strokeWidth={2} />;
            }

            if (it.kind === "line" && it.pts && it.pts.length > 1) {
              const pts = it.pts;
              const drawPts = it.closed ? [...pts, pts[0]] : pts;
              const dash = it.dashed ? "6 6" : undefined;
              const width = it.strokeWidth ?? 3;
              const last = drawPts[drawPts.length - 1];
              const prev = drawPts[drawPts.length - 2] ?? last;
              const dx = last.x - prev.x;
              const dy = last.y - prev.y;
              const len = Math.max(1, Math.hypot(dx, dy));
              const ux = dx / len;
              const uy = dy / len;
              const arrowSize = 8;
              const ax = last.x - ux * arrowSize;
              const ay = last.y - uy * arrowSize;
              const perpX = -uy;
              const perpY = ux;
              return (
                <g key={it.id}>
                  <polyline
                    points={drawPts.map((p) => `${p.x * z},${p.y * z}`).join(" ")}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width}
                    strokeDasharray={dash}
                  />
                  {it.arrowEnd ? (
                    <g>
                      <line
                        x1={last.x * z}
                        y1={last.y * z}
                        x2={(ax + perpX * (arrowSize * 0.6)) * z}
                        y2={(ay + perpY * (arrowSize * 0.6)) * z}
                        stroke={stroke}
                        strokeWidth={width}
                      />
                      <line
                        x1={last.x * z}
                        y1={last.y * z}
                        x2={(ax - perpX * (arrowSize * 0.6)) * z}
                        y2={(ay - perpY * (arrowSize * 0.6)) * z}
                        stroke={stroke}
                        strokeWidth={width}
                      />
                    </g>
                  ) : null}
                </g>
              );
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

            const lineWidth = it.kind === "line" ? 3 : 2;

            return (
              <g key={it.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={lineWidth} />
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
          {/* Draft: measure */}
          {draft
            ? (() => {
                const x1 = draft.a.x * z;
                const y1 = draft.a.y * z;
                const x2 = draft.b.x * z;
                const y2 = draft.b.y * z;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const pxLen = dist(draft.a, draft.b);

                const label = calibration
                  ? formatLength(pxLen * calibration.metersPerDocPx, calibration.displayUnit)
                  : `${Math.round(pxLen)} px`;

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

          {/* Line draft */}
          {lineDraft?.pts?.length ? (
            <g>
              <polyline
                points={[
                  ...lineDraft.pts.map((p) => `${p.x * z},${p.y * z}`),
                  ...(lineDraft.cursor ? [`${lineDraft.cursor.x * z},${lineDraft.cursor.y * z}`] : []),
                ].join(" ")}
                fill="none"
                stroke={draftStroke}
                strokeWidth={2}
                strokeDasharray="6 6"
              />
            </g>
          ) : null}

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
            ? "Line: click points, double-click to finish (ESC to cancel)"
            : " "}
        </div>

        {/* Draft quantity */}
        {(draft && calibration && draftLengthMeters != null) ||
        (areaDraft && calibration && areaDraftMeters2 != null) ||
        (lineDraft && calibration && lineDraftMeters != null) ? (
          <div className="absolute bottom-2 left-2 rounded-md border bg-white/90 px-2 py-1 text-xs">
            {draft && calibration && draftLengthMeters != null
              ? `Length: ${formatLength(draftLengthMeters, calibration.displayUnit)}`
              : null}
            {areaDraft && calibration && areaDraftMeters2 != null
              ? `Area: ${formatArea(areaDraftMeters2, calibration.displayUnit)}`
              : null}
            {lineDraft && calibration && lineDraftMeters != null
              ? `Length: ${formatLength(lineDraftMeters, calibration.displayUnit)}`
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
        setLineDraft(null);
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
      <Card className="h-full w-full overflow-hidden flex flex-col">
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
        <div className="grid flex-1 min-h-0 grid-cols-[auto_minmax(0,1fr)_auto]">
          {/* Left panel */}
          {leftOpen ? (
            <div className="w-[280px] border-r bg-background flex flex-col h-full min-h-0 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="text-sm font-semibold">Sheets</div>
                <Button variant="ghost" size="sm" onClick={() => setLeftOpen(false)} title="Hide sheets">
                  {"<<"}
                </Button>
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="shrink-0 p-3 space-y-3">
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
                    <Input
                      placeholder="Search sheets..."
                      value={sheetSearch}
                      onChange={(e) => setSheetSearch(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground">{effectivePages.length} page(s)</div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border-t px-3 pb-6 min-h-0 scroll-pb-6">
                  <div className="divide-y">
                    {effectivePages.map((p) => (
                      <div key={p.page} className="border-b last:border-b-0">
                        <button
                          className={[
                            "w-full px-3 py-2 text-left hover:bg-muted/50",
                            pageNumber === p.page ? "bg-muted/50 text-primary" : "",
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
                        {(() => {
                          const rows = pageTakeoffRows.get(p.page);
                          if (!rows?.length) return null;
                          return (
                            <div className="px-4 pb-2">
                              {rows.map((row) => (
                                <div key={row.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span
                                    className="h-3 w-3 rounded-sm border"
                                    style={{ backgroundColor: hsl(row.token), borderColor: hsl(row.token) }}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.name}</span>
                                  <span className="text-[11px] text-blue-600 tabular-nums">{row.qty}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
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
          <div className="bg-muted/20 flex flex-col min-h-0">
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

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => zoomAt(clamp(Number((uiZoom * 0.9).toFixed(3)), 0.2, 6))}
                >
                  -
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => zoomAt(clamp(Number((uiZoom * 1.1).toFixed(3)), 0.2, 6))}
                >
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
            <div className="flex-1 min-h-0 p-3 min-w-0 flex flex-col">
              <div ref={viewerBoxRef} className="flex-1 min-h-0 w-full rounded-lg border bg-muted/60 overflow-hidden">
                <div
                  ref={scrollRef}
                  className="h-full w-full overflow-hidden no-scrollbar bg-muted/60 p-6"
                  style={{ ...(hideScrollbarStyle as any), overscrollBehavior: "none", touchAction: "none" }}
                  onWheel={onViewerWheel}
                  onContextMenu={(e) => e.preventDefault()}
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
                        <PdfCanvasViewer
                          pdfDoc={pdfDoc}
                          pageNumber={pageNumber}
                          rotation={rotation}
                          renderScale={renderScale}
                          onViewport={handleViewport}
                        />
                        {viewportBasePx.width > 0 && viewportBasePx.height > 0 ? (
                          <>
                            <Overlay wrapperSize={scaledViewportPx} />
                            <TakeoffLegend />
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 border-t bg-background px-2 py-1 text-[11px] shrink-0">
                <Button
                  size="sm"
                  className={[
                    "h-5 px-2 text-[10px] rounded-none border-b-2",
                    snapEnabled ? "border-b-primary bg-muted/50" : "border-b-transparent",
                  ].join(" ")}
                  variant="outline"
                  onClick={() => setSnapEnabled((v) => !v)}
                  title="Snap to nearby points"
                >
                  Snap
                </Button>
                <Button
                  size="sm"
                  className={[
                    "h-5 px-2 text-[10px] rounded-none border-b-2",
                    orthoEnabled && !shiftDown ? "border-b-primary bg-muted/50" : "border-b-transparent",
                  ].join(" ")}
                  variant="outline"
                  onClick={() => setOrthoEnabled((v) => !v)}
                  title="Ortho locks segments to horizontal/vertical. Hold Shift to temporarily disable while drawing."
                >
                  Ortho{shiftDown ? " (Shift)" : ""}
                </Button>
                <div className="ml-auto text-[10px] text-muted-foreground">
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
            <div className="w-[320px] border-l bg-background flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="text-sm font-semibold">Properties</div>
                <Button variant="ghost" size="sm" onClick={() => setRightOpen(false)} title="Hide properties">
                  {">>"}
                </Button>
              </div>
	              <div className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
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
	                          const lenPx = selectedItem.kind === "line" ? lineLengthPx(selectedItem) : dist(selectedItem.a, selectedItem.b);
	                          if (!calibration) return `${lenPx.toFixed(1)} px`;
	                          const m = lenPx * calibration.metersPerDocPx;
	                          return formatLength(m, calibration.displayUnit);
	                        })()}
	                      </div>

	                      {selectedItem.kind === "line" ? (
	                        <div className="space-y-3">
	                          <div className="grid gap-2">
	                            <div className="text-xs font-semibold text-muted-foreground">Polyline properties</div>
	                            <Input
	                              value={selectedItem.templateName ?? ""}
	                              onChange={(e) => updateSelectedLine({ templateName: e.target.value })}
	                              placeholder="Name"
	                            />
	                            <Input
	                              value={selectedItem.category ?? ""}
	                              onChange={(e) => updateSelectedLine({ category: e.target.value })}
	                              placeholder="Category"
	                            />
	                          </div>

	                          <div className="space-y-2">
	                            <div className="text-xs font-semibold text-muted-foreground">Color</div>
	                            <div className="flex flex-wrap gap-2">
	                              {MARKUP_COLOR_TOKENS.map((t) => {
	                                const active = t === selectedItem.style.token;
	                                return (
	                                  <button
	                                    key={t}
	                                    type="button"
	                                    className={"h-7 w-7 rounded-md border " + (active ? "ring-2 ring-primary" : "")}
	                                    style={{ backgroundColor: hsl(t) }}
	                                    onClick={() => updateSelectedLine({ style: { ...selectedItem.style, token: t } })}
	                                    title={t}
	                                  />
	                                );
	                              })}
	                            </div>
	                          </div>

	                          <div className="grid grid-cols-2 gap-2 text-xs">
	                            <Button
	                              size="sm"
	                              variant={selectedItem.closed ? "default" : "outline"}
	                              onClick={() => updateSelectedLine({ closed: !selectedItem.closed })}
	                            >
	                              Closed
	                            </Button>
	                            <Button
	                              size="sm"
	                              variant={selectedItem.dashed ? "default" : "outline"}
	                              onClick={() => updateSelectedLine({ dashed: !selectedItem.dashed })}
	                            >
	                              Dashed
	                            </Button>
	                            <Button
	                              size="sm"
	                              variant={selectedItem.arrowEnd ? "default" : "outline"}
	                              onClick={() => updateSelectedLine({ arrowEnd: !selectedItem.arrowEnd })}
	                            >
	                              Arrow end
	                            </Button>
	                            <select
	                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
	                              value={selectedItem.strokeWidth ?? 3}
	                              onChange={(e) => updateSelectedLine({ strokeWidth: Number(e.target.value) })}
	                            >
	                              <option value={2}>Width 2</option>
	                              <option value={3}>Width 3</option>
	                              <option value={4}>Width 4</option>
	                              <option value={5}>Width 5</option>
	                            </select>
	                          </div>
	                        </div>
	                      ) : null}

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
	                    <div className="flex justify-between"><span>Linear</span><span>{pageSummary.linearLabel}</span></div>
	                    <div className="flex justify-between"><span>Area</span><span>{pageSummary.areaLabel}</span></div>
	                    <div className="flex justify-between"><span>Count</span><span>{pageSummary.count}</span></div>
	                  </div>

	                  <div className="mt-3 border-t pt-3">
	                    <div className="text-xs font-semibold text-muted-foreground">Markup classification</div>
	                    <div className="mt-2 space-y-2">
	                      {templates.filter((t) => t.kind !== "measure").map((t) => {
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
                            if (it.kind === "measure") return acc + dist(it.a, it.b);
                            if (it.kind === "line") return acc + lineLengthPx(it);
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
	                                <div className="truncate text-xs text-muted-foreground">
	                                  {t.category} {" > "} {t.kind === "line" ? "LINEAR" : t.kind.toUpperCase()}
	                                </div>
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
