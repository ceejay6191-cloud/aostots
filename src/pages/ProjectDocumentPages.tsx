import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  label_template: any | null; // jsonb
};

type PageRow = {
  id: string;
  document_id: string;
  project_id: string;
  owner_id: string;
  page_number: number;
  page_name: string | null;
  width_px: number | null;
  height_px: number | null;
  rotation: number;
  created_at: string;
  updated_at: string;
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

/* -----------------------------
   Small utilities
----------------------------- */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/* -----------------------------
   Auto-Rename template types
----------------------------- */
type NormRect = { x0: number; y0: number; x1: number; y1: number }; // 0..1

// Legacy v1 (A/B)
type LabelTemplateV1 = {
  version: 1;
  rotation: number;
  regionA?: NormRect;
  regionB?: NormRect;
};

// New v2 (Region 1..N)
type LabelTemplateV2 = {
  version: 2;
  rotation: number;
  regions: NormRect[];
};

type AnyTemplate = LabelTemplateV1 | LabelTemplateV2;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number
): NormRect {
  const x0 = clamp01(Math.min(a.x, b.x) / w);
  const y0 = clamp01(Math.min(a.y, b.y) / h);
  const x1 = clamp01(Math.max(a.x, b.x) / w);
  const y1 = clamp01(Math.max(a.y, b.y) / h);
  return { x0, y0, x1, y1 };
}

function denormRect(r: NormRect, w: number, h: number) {
  return {
    x0: r.x0 * w,
    y0: r.y0 * h,
    x1: r.x1 * w,
    y1: r.y1 * h,
  };
}

function cleanName(s: string) {
  return (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmptyLine(s: string) {
  for (const line of (s || "").split("\n")) {
    const t = cleanName(line);
    if (t) return t;
  }
  return "";
}

function buildSuggestedNameFromParts(parts: string[]) {
  const cleaned = parts.map(firstNonEmptyLine).filter(Boolean);
  if (!cleaned.length) return "";
  return cleaned.join(" - ");
}

function coerceTemplateToV2(lt: AnyTemplate | null): LabelTemplateV2 {
  if (lt && lt.version === 2) {
    return {
      version: 2,
      rotation: typeof lt.rotation === "number" ? lt.rotation : 0,
      regions: Array.isArray(lt.regions) ? lt.regions : [],
    };
  }

  // Migrate legacy v1 to v2 while preserving old "B - A" ordering:
  // Region 1 = B, Region 2 = A.
  if (lt && lt.version === 1) {
    const regions: NormRect[] = [];
    if (lt.regionB) regions.push(lt.regionB);
    if (lt.regionA) regions.push(lt.regionA);
    return {
      version: 2,
      rotation: typeof lt.rotation === "number" ? lt.rotation : 0,
      regions,
    };
  }

  return { version: 2, rotation: 0, regions: [] };
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
  pdfDoc: any | null; // PDFDocumentProxy
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

        // backing store in device pixels
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);

        // css size in layout pixels
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

  return <canvas ref={canvasRef} className="block rounded border bg-white" />;
}

/* -----------------------------
   Pan (drag-to-scroll)
----------------------------- */
function useDragPan(
  scrollRef: React.RefObject<HTMLDivElement>,
  allowLeftDrag: boolean
) {
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  function hasOverflow(el: HTMLDivElement) {
    return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
  }

  function canStart(e: React.PointerEvent, el: HTMLDivElement) {
    if (!hasOverflow(el)) return false;
    if (e.button === 2) return true; // right always
    if (allowLeftDrag && e.button === 0) return true; // left when allowed
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

function getScrollPos(el: HTMLDivElement | null) {
  return { left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 };
}
function setScrollPos(el: HTMLDivElement | null, pos: { left: number; top: number }) {
  if (!el) return;
  el.scrollLeft = pos.left;
  el.scrollTop = pos.top;
}

export default function ProjectDocumentPages() {
  const { projectId, documentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [busyCreatingPages, setBusyCreatingPages] = useState(false);

  // Viewer state
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [viewPage, setViewPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.0);
  const [viewerRotation, setViewerRotation] = useState<number>(0);
  const [viewportPx, setViewportPx] = useState<{ width: number; height: number }>({
    width: 1,
    height: 1,
  });

  // Page naming drafts
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  // Auto-Rename modal + template
  const [autoRenameOpen, setAutoRenameOpen] = useState(false);
  const [template, setTemplate] = useState<LabelTemplateV2>({
    version: 2,
    rotation: 0,
    regions: [],
  });

  // Drawing state
  const [activeRegionIndex, setActiveRegionIndex] = useState<number | null>(null); // 0-based
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // Extract results
  const [lastSuggested, setLastSuggested] = useState<string>("");

  // Separate scroll refs (prevents "reset" when switching modal/page)
  const scrollRefPage = useRef<HTMLDivElement | null>(null);
  const scrollRefModal = useRef<HTMLDivElement | null>(null);

  // page viewer: always allow left-drag pan
  const panPage = useDragPan(scrollRefPage, true);

  // modal viewer: disable left-drag pan while drawing regions (right drag always works)
  const panModal = useDragPan(scrollRefModal, activeRegionIndex === null);

  const { data: authUser } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
  });
  const uid = authUser?.id;

  const { data: doc, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ["project-document", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_documents")
        .select(
          "id,project_id,owner_id,bucket,path,file_name,mime_type,size_bytes,created_at,label_template"
        )
        .eq("id", documentId)
        .single();

      if (error) throw error;
      return data as DocumentRow;
    },
  });

  useEffect(() => {
    if (!doc || !projectId) return;
    if (doc.project_id !== projectId) {
      toast({
        title: "Invalid link",
        description: "That document does not belong to this project.",
        variant: "destructive",
      });
      navigate(`/projects/${projectId}`);
    }
  }, [doc, projectId, navigate]);

  const { data: pages, isLoading: pagesLoading } = useQuery({
    queryKey: ["document-pages", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_pages")
        .select(
          "id,document_id,project_id,owner_id,page_number,page_name,width_px,height_px,rotation,created_at,updated_at"
        )
        .eq("document_id", documentId)
        .order("page_number", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  const pageCount = useMemo(() => pages?.length ?? 0, [pages]);

  async function getSignedPdfUrl(d: DocumentRow) {
    const { data, error } = await supabase.storage
      .from(d.bucket)
      .createSignedUrl(d.path, 60 * 10);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("No signed URL returned.");
    return data.signedUrl;
  }

  // Load template
  useEffect(() => {
    if (!doc) return;
    const lt = (doc.label_template as AnyTemplate | null) ?? null;
    setTemplate(coerceTemplateToV2(lt));
  }, [doc?.id]);

  // Load PDF
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!doc) return;
      try {
        const url = await getSignedPdfUrl(doc);
        if (cancelled) return;
        setSignedUrl(url);

        const pdf = await getDocument(url).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: "Failed to load PDF",
            description: e?.message ?? "Unknown error",
            variant: "destructive",
          });
          setPdfDoc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc?.id]);

  async function ensurePagesExist() {
    if (!doc || !uid || !projectId) return;

    setBusyCreatingPages(true);
    try {
      const url = signedUrl || (await getSignedPdfUrl(doc));
      if (!signedUrl) setSignedUrl(url);

      const pdf = await getDocument(url).promise;
      const numPages = pdf.numPages;

      if ((pages?.length ?? 0) === numPages) {
        toast({ title: "Pages already created", description: `Detected ${numPages} pages.` });
        return;
      }

      const inserts = Array.from({ length: numPages }, (_, i) => ({
        document_id: doc.id,
        project_id: projectId,
        owner_id: uid,
        page_number: i + 1,
        page_name: null,
        width_px: null,
        height_px: null,
        rotation: 0,
      }));

      const { error } = await supabase
        .from("document_pages")
        .upsert(inserts, { onConflict: "document_id,page_number" });

      if (error) throw error;

      toast({ title: "Pages created", description: `Detected and saved ${numPages} pages.` });
      await qc.invalidateQueries({ queryKey: ["document-pages", documentId] });
    } catch (e: any) {
      toast({
        title: "Failed to create pages",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyCreatingPages(false);
    }
  }

  useEffect(() => {
    if (!doc || !uid) return;
    if (pagesLoading) return;
    if ((pages?.length ?? 0) > 0) return;
    void ensurePagesExist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, uid, pagesLoading]);

  useEffect(() => {
    if (!pages) return;
    setDraftNames((prev) => {
      const next = { ...prev };
      for (const p of pages) {
        if (next[p.id] === undefined) next[p.id] = p.page_name ?? "";
      }
      return next;
    });
  }, [pages]);

  const savePageNameMutation = useMutation({
    mutationFn: async (payload: { pageId: string; pageName: string }) => {
      const { error } = await supabase
        .from("document_pages")
        .update({ page_name: payload.pageName.trim() || null })
        .eq("id", payload.pageId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["document-pages", documentId] });
      toast({ title: "Saved", description: "Page name updated." });
    },
    onError: (e: any) => {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (payload: LabelTemplateV2) => {
      if (!doc) throw new Error("Missing doc");
      const { error } = await supabase
        .from("project_documents")
        .update({ label_template: payload })
        .eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: "Saved", description: "Auto-Rename template saved for this document." });
      await qc.invalidateQueries({ queryKey: ["project-document", documentId] });
    },
    onError: (e: any) => {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // stable callbacks (avoid render loops)
  const handleViewport = useCallback((vp: { width: number; height: number }) => {
    setViewportPx((prev) => (prev.width === vp.width && prev.height === vp.height ? prev : vp));
  }, []);

  const handleViewerError = useCallback((msg: string) => {
    toast({
      title: "Viewer error",
      description: msg,
      variant: "destructive",
    });
  }, []);

  // On page change: reset zoom + center (both viewers)
  useEffect(() => {
    setZoom(1.0);
    setTimeout(() => {
      centerScroll(scrollRefPage.current);
      centerScroll(scrollRefModal.current);
    }, 80);
  }, [viewPage]);

  /* -----------------------------
     Regions overlay
  ----------------------------- */
  const drawingRef = useRef<HTMLDivElement | null>(null);
  const drawingActiveRef = useRef(false);

  function rectPx(r?: NormRect) {
    if (!r) return null;
    return denormRect(r, viewportPx.width, viewportPx.height);
  }

  const regionRectsPx = useMemo(() => {
    return template.regions.map((r) => rectPx(r));
  }, [template.regions, viewportPx.width, viewportPx.height]);

  const dragRect =
    dragStart && dragCurrent
      ? {
          x0: Math.min(dragStart.x, dragCurrent.x),
          y0: Math.min(dragStart.y, dragCurrent.y),
          x1: Math.max(dragStart.x, dragCurrent.x),
          y1: Math.max(dragStart.y, dragCurrent.y),
        }
      : null;

  function getLocalPointFromEl(el: HTMLDivElement | null, e: React.PointerEvent) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const onDrawPointerDown = (e: React.PointerEvent) => {
    if (activeRegionIndex === null) return;
    if (e.button !== 0) return;
    const el = drawingRef.current;
    const pt = getLocalPointFromEl(el, e);
    if (!pt) return;

    drawingActiveRef.current = true;
    setDragStart(pt);
    setDragCurrent(pt);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    e.preventDefault();
  };

  const onDrawPointerMove = (e: React.PointerEvent) => {
    if (!drawingActiveRef.current) return;
    if (activeRegionIndex === null) return;
    const el = drawingRef.current;
    const pt = getLocalPointFromEl(el, e);
    if (!pt) return;
    setDragCurrent(pt);
    e.preventDefault();
  };

  const onDrawPointerUp = (e: React.PointerEvent) => {
    if (!drawingActiveRef.current) return;
    drawingActiveRef.current = false;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (activeRegionIndex === null || !dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const w = viewportPx.width;
    const h = viewportPx.height;
    if (w <= 1 || h <= 1) {
      setDragStart(null);
      setDragCurrent(null);
      setActiveRegionIndex(null);
      return;
    }

    const r = normalizeRect(dragStart, dragCurrent, w, h);

    setTemplate((prev) => {
      const nextRegions = [...prev.regions];
      nextRegions[activeRegionIndex] = r;
      return { version: 2, rotation: viewerRotation, regions: nextRegions };
    });

    toast({ title: "Region set", description: `Region ${activeRegionIndex + 1} updated.` });

    setActiveRegionIndex(null);
    setDragStart(null);
    setDragCurrent(null);

    e.preventDefault();
  };

  /* -----------------------------
     Extraction
  ----------------------------- */
  async function extractTextFromNormRect(pageNumber: number, r?: NormRect) {
    if (!pdfDoc || !r) return "";
    const page = await pdfDoc.getPage(pageNumber);

    const useRotation = typeof template.rotation === "number" ? template.rotation : 0;
    const viewport = page.getViewport({ scale: 1, rotation: useRotation });

    const clip = {
      x0: r.x0 * viewport.width,
      y0: r.y0 * viewport.height,
      x1: r.x1 * viewport.width,
      y1: r.y1 * viewport.height,
    };

    const content = await page.getTextContent({ includeMarkedContent: false });

    const hits: { x: number; y: number; str: string }[] = [];
    for (const item of content.items as any[]) {
      const str = String(item.str ?? "").trim();
      if (!str) continue;

      const tx = item.transform;
      const xPage = tx[4];
      const yPage = tx[5];

      const [xVp, yVp] = viewport.convertToViewportPoint(xPage, yPage);

      const w = Math.abs((item.width ?? 0) * viewport.scale);
      const h = Math.abs((item.height ?? 0) * viewport.scale) || 10;

      const left = xVp;
      const right = xVp + w;
      const top = yVp - h;
      const bottom = yVp;

      const intersects =
        right >= clip.x0 && left <= clip.x1 && bottom >= clip.y0 && top <= clip.y1;
      if (intersects) hits.push({ x: left, y: top, str });
    }

    if (!hits.length) return "";

    hits.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    const lines: string[] = [];
    let cur: { y: number; parts: string[] } | null = null;
    const Y_THRESH = 8;

    for (const h of hits) {
      if (!cur) {
        cur = { y: h.y, parts: [h.str] };
        continue;
      }
      if (Math.abs(h.y - cur.y) <= Y_THRESH) cur.parts.push(h.str);
      else {
        lines.push(cur.parts.join(" ").trim());
        cur = { y: h.y, parts: [h.str] };
      }
    }
    if (cur) lines.push(cur.parts.join(" ").trim());

    return lines.filter(Boolean).join("\n").trim();
  }

  async function testExtractCurrentPage() {
    try {
      if (!template.regions.length) {
        toast({
          title: "No regions defined",
          description: "Click Region and draw at least one region.",
          variant: "destructive",
        });
        return;
      }
      if (!pdfDoc) {
        toast({
          title: "PDF not ready",
          description: "Wait for the PDF to load.",
          variant: "destructive",
        });
        return;
      }

      const extracts: string[] = [];
      for (const r of template.regions) extracts.push(await extractTextFromNormRect(viewPage, r));

      const sug = buildSuggestedNameFromParts(extracts);
      setLastSuggested(sug);

      toast({
        title: "Extracted",
        description: sug
          ? `Suggested: ${sug}`
          : "No text found in the defined regions for this page.",
      });
    } catch (e: any) {
      toast({
        title: "Extraction failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function applyToThisPage() {
    try {
      if (!pages || !pages.length) return;
      const pageRow = pages.find((p) => p.page_number === viewPage);
      if (!pageRow) return;

      if (!template.regions.length) {
        toast({
          title: "No regions defined",
          description: "Click Region and draw at least one region.",
          variant: "destructive",
        });
        return;
      }

      const extracts: string[] = [];
      for (const r of template.regions) extracts.push(await extractTextFromNormRect(viewPage, r));

      const sug = buildSuggestedNameFromParts(extracts);
      if (!sug) {
        toast({ title: "No suggestion", description: "No text extracted for this page." });
        return;
      }

      savePageNameMutation.mutate({ pageId: pageCount ? (pages!.find(p=>p.page_number===viewPage)!.id) : "", pageName: sug });
    } catch (e: any) {
      toast({
        title: "Apply failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function applyToAllPages() {
    try {
      if (!pages || !pages.length) return;
      if (!template.regions.length) {
        toast({
          title: "No regions defined",
          description: "Click Region and draw at least one region.",
          variant: "destructive",
        });
        return;
      }
      if (!pdfDoc) {
        toast({
          title: "PDF not ready",
          description: "Wait for the PDF to load.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Applying…", description: "Generating names for all pages." });

      const updates: { id: string; page_name: string | null }[] = [];
      for (const p of pages) {
        const extracts: string[] = [];
        for (const r of template.regions) {
          extracts.push(await extractTextFromNormRect(p.page_number, r));
        }
        const sug = buildSuggestedNameFromParts(extracts);
        updates.push({ id: p.id, page_name: sug || null });
      }

      const { error } = await supabase
        .from("document_pages")
        .upsert(updates, { onConflict: "id" });
      if (error) throw error;

      await qc.invalidateQueries({ queryKey: ["document-pages", documentId] });
      toast({ title: "Done", description: "Applied suggested names to all pages." });
    } catch (e: any) {
      toast({
        title: "Apply-all failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  if (docLoading) {
    return (
      <AppLayout>
        <Card className="p-6">Loading document…</Card>
      </AppLayout>
    );
  }

  if (docError || !doc) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">Document not found</div>
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
              Back
            </Button>
          </div>
          <Card className="p-6 text-sm text-muted-foreground">
            {String((docError as any)?.message ?? "No record returned.")}
          </Card>
        </div>
      </AppLayout>
    );
  }

  function Viewer({ variant }: { variant: "page" | "modal" }) {
    const isModal = variant === "modal";
    const heightClass = isModal ? "h-[calc(100vh-260px)]" : "max-h-[75vh]";
    const thisScrollRef = isModal ? scrollRefModal : scrollRefPage;
    const thisPan = isModal ? panModal : panPage;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{isModal ? "Plan" : "Viewer"}</div>
            <div className="text-xs text-muted-foreground">
              {signedUrl ? `Page ${viewPage}${pageCount ? ` of ${pageCount}` : ""}` : "Preparing…"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewPage((p) => Math.max(1, p - 1))}
              disabled={viewPage <= 1}
            >
              ◀
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewPage((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))}
              disabled={pageCount ? viewPage >= pageCount : false}
            >
              ▶
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.1).toFixed(2))))}
            >
              -
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.1).toFixed(2))))}
            >
              +
            </Button>

            <Button variant="outline" size="sm" onClick={() => setViewerRotation((r) => (r + 90) % 360)}>
              Rotate
            </Button>

            {!isModal ? (
              <Button
                size="sm"
                onClick={() => {
                  setAutoRenameOpen(true);
                  setActiveRegionIndex(null);
                  setDragStart(null);
                  setDragCurrent(null);
                }}
              >
                Auto-Rename
              </Button>
            ) : null}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Zoom: {zoom.toFixed(2)} • Rotation: {viewerRotation}° • Pan: drag (left) • Draw: only when Region mode is active
        </div>

        <div
          ref={thisScrollRef}
          className={`${heightClass} overflow-auto rounded-xl border border-border bg-muted/10`}
          onPointerDown={thisPan.onPointerDown}
          onPointerMove={thisPan.onPointerMove}
          onPointerUp={thisPan.onPointerUp}
          onContextMenu={thisPan.onContextMenu}
          style={{ cursor: activeRegionIndex === null ? "grab" : "default" }}
        >
          <div className="p-3">
            <div className="relative inline-block" style={{ width: viewportPx.width, height: viewportPx.height }}>
              <PdfCanvasViewer
                pdfDoc={pdfDoc}
                pageNumber={viewPage}
                scale={zoom}
                rotation={viewerRotation}
                onViewport={handleViewport}
                onError={handleViewerError}
              />

              <div className="absolute inset-0 pointer-events-none">
                {regionRectsPx.map((rp, idx) => {
                  if (!rp) return null;
                  return (
                    <div
                      key={idx}
                      className="absolute border-2 bg-blue-500/10 border-blue-500"
                      style={{
                        left: rp.x0,
                        top: rp.y0,
                        width: Math.max(1, rp.x1 - rp.x0),
                        height: Math.max(1, rp.y1 - rp.y0),
                      }}
                    >
                      <div className="absolute -top-6 left-0 text-[11px] bg-background/90 px-2 py-0.5 border rounded">
                        Region {idx + 1}
                      </div>
                    </div>
                  );
                })}

                {dragStart && dragCurrent ? (
                  <div
                    className="absolute border-2 border-red-500 bg-red-500/10"
                    style={{
                      left: Math.min(dragStart.x, dragCurrent.x),
                      top: Math.min(dragStart.y, dragCurrent.y),
                      width: Math.max(1, Math.abs(dragCurrent.x - dragStart.x)),
                      height: Math.max(1, Math.abs(dragCurrent.y - dragStart.y)),
                    }}
                  />
                ) : null}
              </div>

              <div
                ref={drawingRef}
                className="absolute inset-0"
                style={{
                  pointerEvents: activeRegionIndex === null ? "none" : "auto",
                  cursor: activeRegionIndex === null ? "default" : "crosshair",
                  touchAction: "none",
                }}
                onPointerDown={onDrawPointerDown}
                onPointerMove={onDrawPointerMove}
                onPointerUp={onDrawPointerUp}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-bold">Document Pages</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{doc.file_name}</Badge>
              <span>•</span>
              <span>{formatBytes(doc.size_bytes)}</span>
              <span>•</span>
              <span>{pageCount} pages in DB</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
              Back to Project
            </Button>
            <Button variant="outline" onClick={() => void ensurePagesExist()} disabled={busyCreatingPages}>
              {busyCreatingPages ? "Scanning PDF…" : "Rescan PDF"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-6 p-6 space-y-4">
            <div className="text-sm text-muted-foreground">
              Rename pages to match plan sheets (e.g., “Cover Sheet”, “General Notes”, “Electrical”, “Roof”).
            </div>

            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Meta</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagesLoading ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                        Loading pages…
                      </td>
                    </tr>
                  ) : (pages?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                        No pages created yet. Click “Rescan PDF”.
                      </td>
                    </tr>
                  ) : (
                    pages!.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{p.page_number}</td>
                        <td className="px-4 py-3">
                          <Input
                            value={draftNames[p.id] ?? ""}
                            placeholder="(optional) Page name…"
                            onChange={(e) =>
                              setDraftNames((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            onBlur={() => {
                              const next = (draftNames[p.id] ?? "").trim();
                              const cur = (p.page_name ?? "").trim();
                              if (next === cur) return;
                              savePageNameMutation.mutate({ pageId: p.id, pageName: next });
                            }}
                          />
                          <div className="mt-1 text-xs text-muted-foreground">
                            {p.page_name ? "Saved" : "Not saved yet"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.width_px && p.height_px ? `${p.width_px}×${p.height_px}` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setViewPage(p.page_number)}
                            >
                              Open
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="lg:col-span-6 p-6 space-y-4">
            <Viewer variant="page" />
          </Card>
        </div>

        {/* Auto-Rename popup (modal) */}
        {autoRenameOpen ? (
          <div className="fixed inset-0 z-50 bg-black/60">
            <div className="absolute inset-0 bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{doc.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Auto-Rename • Page {viewPage}
                    {pageCount ? ` / ${pageCount}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setZoom(1.0);
                      setTimeout(() => centerScroll(scrollRefModal.current), 80);
                    }}
                  >
                    Center
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setActiveRegionIndex(null);
                      setDragStart(null);
                      setDragCurrent(null);
                      setAutoRenameOpen(false);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>

              <div className="p-4">
                <div className="max-w-6xl mx-auto grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* Settings */}
                  <Card className="lg:col-span-4 p-4 space-y-3">
                    <div>
                      <div className="text-sm font-medium">Auto-Rename Settings</div>
                      <div className="text-xs text-muted-foreground">
                        Click Region, then drag on the plan. Each click adds the next Region (1, 2, 3, …).
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const pos = getScrollPos(scrollRefModal.current);

                          const nextIdx = template.regions.length;
                          setActiveRegionIndex(nextIdx);
                          setDragStart(null);
                          setDragCurrent(null);

                          requestAnimationFrame(() => {
                            setScrollPos(scrollRefModal.current, pos);
                          });

                          toast({
                            title: "Draw region",
                            description: `Drag on the plan to set Region ${nextIdx + 1}.`,
                          });
                        }}
                      >
                        Region
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTemplate({ version: 2, rotation: viewerRotation, regions: [] });
                          setActiveRegionIndex(null);
                          setDragStart(null);
                          setDragCurrent(null);
                          setLastSuggested("");
                        }}
                      >
                        Clear
                      </Button>

                      <Button
                        size="sm"
                        onClick={() =>
                          saveTemplateMutation.mutate({
                            ...template,
                            version: 2,
                            rotation: viewerRotation,
                          })
                        }
                        disabled={saveTemplateMutation.isPending}
                      >
                        {saveTemplateMutation.isPending ? "Saving…" : "Save"}
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{template.regions.length} region(s)</Badge>
                      {activeRegionIndex !== null ? (
                        <Badge>Drawing Region {activeRegionIndex + 1}</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        Rotation basis: {template.rotation ?? 0}°
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void testExtractCurrentPage()}>
                        Test (this page)
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void applyToThisPage()}>
                        Apply (this page)
                      </Button>
                      <Button size="sm" onClick={() => void applyToAllPages()}>
                        Apply (all pages)
                      </Button>
                    </div>

                    {lastSuggested ? (
                      <div className="text-sm">
                        <div className="font-medium">Suggested:</div>
                        <div className="mt-1 rounded border border-border bg-muted/30 px-3 py-2">
                          {lastSuggested}
                        </div>
                      </div>
                    ) : null}

                    <div className="text-xs text-muted-foreground">
                      Tip: Legacy Region A/B active were migrated to Region 1/2 automatically,
                      preserving “B - A” ordering.
                    </div>
                  </Card>

                  {/* Plan viewer inside modal */}
                  <div className="lg:col-span-8">
                    <Viewer variant="modal" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}
