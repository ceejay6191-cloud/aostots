import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, Plus, Trash2, MoreVertical } from "lucide-react";

// Supabase types in this repo are generated only for "projects".
// Use untyped client for takeoff tables to avoid TS errors.
const db = supabase as any;

type EstLine = {
  id: string;
  code: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  wastePct?: number;
  categoryId?: string;
};

type Point = { x: number; y: number };

type TakeoffItemRow = {
  id: string;
  document_id: string;
  page_number: number;
  kind: string;
  meta: any;
};

type TakeoffGeometryRow = {
  takeoff_item_id: string;
  points: Point[];
};

type TakeoffLine = {
  key: string;
  description: string;
  unit: string;
  qty: number;
  kind: string;
  category: string | null;
  uncalibrated?: boolean;
};

type TakeoffOverride = {
  code?: string;
  description?: string;
  unit?: string;
  qty?: number;
  wastePct?: number;
  categoryId?: string;
};

type EstimateCategory = {
  id: string;
  name: string;
};

type EstimateRowKey = `cat:${string}` | `line:${string}` | `takeoff:${string}`;

export type EstimatingStats = {
  nonemptyLines: number;
  targetLines: number;
  total: number;
};

function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function clampPct(v: number) {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

const DEFAULT_CATEGORY_NAME = "Uncategorized";

function lineAmount(qty: number, rate: number, wastePct = 0) {
  const waste = Number(wastePct) || 0;
  return (Number(qty) || 0) * (Number(rate) || 0) * (1 + waste / 100);
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

function formatMeters(m: number) {
  return `${m.toFixed(2)} m`;
}

function formatMeters2(m2: number) {
  return `${m2.toFixed(2)} m2`;
}

function readLines(projectId: string): EstLine[] {
  try {
    const raw = localStorage.getItem(`aostot:estimating:lines:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}
function writeLines(projectId: string, lines: EstLine[]) {
  try {
    localStorage.setItem(`aostot:estimating:lines:${projectId}`, JSON.stringify(lines));
  } catch {
    // ignore
  }
}

function readTakeoffRates(projectId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`aostot:estimating:takeoffRates:${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeTakeoffRates(projectId: string, rates: Record<string, number>) {
  try {
    localStorage.setItem(`aostot:estimating:takeoffRates:${projectId}`, JSON.stringify(rates));
  } catch {
    // ignore
  }
}

function readTakeoffOverrides(projectId: string): Record<string, TakeoffOverride> {
  try {
    const raw = localStorage.getItem(`aostot:estimating:takeoffOverrides:${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeTakeoffOverrides(projectId: string, overrides: Record<string, TakeoffOverride>) {
  try {
    localStorage.setItem(`aostot:estimating:takeoffOverrides:${projectId}`, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

function readCategories(projectId: string): EstimateCategory[] {
  try {
    const raw = localStorage.getItem(`aostot:estimating:categories:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

function writeCategories(projectId: string, categories: EstimateCategory[]) {
  try {
    localStorage.setItem(`aostot:estimating:categories:${projectId}`, JSON.stringify(categories));
  } catch {
    // ignore
  }
}

function readRowOrder(projectId: string): EstimateRowKey[] {
  try {
    const raw = localStorage.getItem(`aostot:estimating:rowOrder:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

function writeRowOrder(projectId: string, order: EstimateRowKey[]) {
  try {
    localStorage.setItem(`aostot:estimating:rowOrder:${projectId}`, JSON.stringify(order));
  } catch {
    // ignore
  }
}

function readCollapsedCategories(projectId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`aostot:estimating:catCollapsed:${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeCollapsedCategories(projectId: string, collapsed: Record<string, boolean>) {
  try {
    localStorage.setItem(`aostot:estimating:catCollapsed:${projectId}`, JSON.stringify(collapsed));
  } catch {
    // ignore
  }
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

type DragHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
};

function SortableRow({
  id,
  className,
  children,
}: {
  id: EstimateRowKey;
  className?: string;
  children: (handle: DragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <tr ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {children({ attributes, listeners, setActivatorNodeRef })}
    </tr>
  );
}

export function EstimatingWorkspaceContent({
  projectId,
  embedded,
  onStats,
  targetLines = 10,
}: {
  projectId: string;
  embedded?: boolean;
  onStats?: (s: EstimatingStats) => void;
  targetLines?: number; // used for estimating_pct calculation
}) {
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [lines, setLines] = useState<EstLine[]>(() => readLines(projectId));
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [takeoffLines, setTakeoffLines] = useState<TakeoffLine[]>([]);
  const [takeoffRates, setTakeoffRates] = useState<Record<string, number>>(() => readTakeoffRates(projectId));
  const [takeoffOverrides, setTakeoffOverrides] = useState<Record<string, TakeoffOverride>>(() =>
    readTakeoffOverrides(projectId)
  );
  const [categories, setCategories] = useState<EstimateCategory[]>(() => readCategories(projectId));
  const [rowOrder, setRowOrder] = useState<EstimateRowKey[]>(() => readRowOrder(projectId));
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() =>
    readCollapsedCategories(projectId)
  );
  const [takeoffSummary, setTakeoffSummary] = useState<{
    linearLabel: string;
    areaLabel: string;
    count: number;
    note: string | null;
  }>({ linearLabel: "--", areaLabel: "--", count: 0, note: null });
  const [takeoffLoading, setTakeoffLoading] = useState(false);
  

  // Keep storage key aligned if project changes
  useEffect(() => {
    setLines(readLines(projectId));
    setSelectedIds({});
    setTakeoffRates(readTakeoffRates(projectId));
    setTakeoffOverrides(readTakeoffOverrides(projectId));
    setCategories(readCategories(projectId));
    setRowOrder(readRowOrder(projectId));
    setCollapsedCategories(readCollapsedCategories(projectId));
  }, [projectId]);

  // Persist to localStorage
  useEffect(() => {
    writeLines(projectId, lines);
  }, [projectId, lines]);

  useEffect(() => {
    writeTakeoffRates(projectId, takeoffRates);
  }, [projectId, takeoffRates]);

  useEffect(() => {
    writeTakeoffOverrides(projectId, takeoffOverrides);
  }, [projectId, takeoffOverrides]);

  useEffect(() => {
    writeCategories(projectId, categories);
  }, [projectId, categories]);

  useEffect(() => {
    writeRowOrder(projectId, rowOrder);
  }, [projectId, rowOrder]);

  useEffect(() => {
    writeCollapsedCategories(projectId, collapsedCategories);
  }, [projectId, collapsedCategories]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setTakeoffLoading(true);

    (async () => {
      try {
        const { data: items, error } = await db
          .from("takeoff_items")
          .select("id,document_id,page_number,kind,meta")
          .eq("project_id", projectId);

        if (error) throw error;

        const filtered = ((items ?? []) as TakeoffItemRow[]).filter((it) => it.kind !== "measure");
        const ids = filtered.map((it) => it.id);

        let geomRows: TakeoffGeometryRow[] = [];
        if (ids.length) {
          const { data: geoms, error: geomError } = await db
            .from("takeoff_geometries")
            .select("takeoff_item_id,points")
            .in("takeoff_item_id", ids);
          if (geomError) throw geomError;
          geomRows = (geoms ?? []) as TakeoffGeometryRow[];
        }

        const { data: calibrations, error: calError } = await db
          .from("takeoff_calibrations")
          .select("document_id,page_number,meters_per_doc_px")
          .eq("project_id", projectId);

        if (calError) throw calError;

        if (cancelled) return;

        const geomMap = new Map<string, Point[]>();
        for (const g of geomRows) geomMap.set(g.takeoff_item_id, g.points || []);

        const calMap = new Map<string, number>();
        for (const c of calibrations ?? []) {
          const key = `${c.document_id}:${c.page_number}`;
          calMap.set(key, Number(c.meters_per_doc_px));
        }

        let linearM = 0;
        let areaM2 = 0;
        let count = 0;
        let linearMissing = 0;
        let areaMissing = 0;

        const takeoffGroup = new Map<string, TakeoffLine>();

        for (const it of filtered) {
          if (it.meta?.isMarkup) continue;
          if (it.kind === "count") {
            const val = Number(it.meta?.value ?? 1);
            count += isFinite(val) ? val : 1;
            const qty = isFinite(val) ? val : 1;
            const unit = it.meta?.uom ?? "ea";
            const name = it.meta?.templateName ?? it.meta?.label ?? "Count";
            const category = it.meta?.category ?? null;
            const key = `${it.meta?.templateId ?? name}:${unit}:${it.kind}:${category ?? ""}`;
            const existing = takeoffGroup.get(key);
            if (existing) {
              existing.qty += qty;
            } else {
              takeoffGroup.set(key, {
                key,
                description: category ? `${name} (${category})` : name,
                unit,
                qty,
                kind: it.kind,
                category,
              });
            }
            continue;
          }

          const pts = geomMap.get(it.id) ?? [];
          if (!pts.length) continue;

          const calKey = `${it.document_id}:${it.page_number}`;
          const mpp = calMap.get(calKey);

          if (it.kind === "line") {
            if (pts.length < 2) continue;
            let px = 0;
            for (let i = 0; i < pts.length - 1; i += 1) {
              px += dist(pts[i], pts[i + 1]);
            }
            const unit = it.meta?.uom ?? "m";
            const name = it.meta?.templateName ?? "Line";
            const category = it.meta?.category ?? null;
            const key = `${it.meta?.templateId ?? name}:${unit}:${it.kind}:${category ?? ""}`;
            if (mpp) {
              const qty = px * mpp;
              linearM += qty;
              const existing = takeoffGroup.get(key);
              if (existing) existing.qty += qty;
              else {
                takeoffGroup.set(key, {
                  key,
                  description: category ? `${name} (${category})` : name,
                  unit,
                  qty,
                  kind: it.kind,
                  category,
                });
              }
            } else {
              linearMissing += 1;
              const existing = takeoffGroup.get(key);
              if (existing) existing.uncalibrated = true;
              else {
                takeoffGroup.set(key, {
                  key,
                  description: category ? `${name} (${category})` : name,
                  unit,
                  qty: 0,
                  kind: it.kind,
                  category,
                  uncalibrated: true,
                });
              }
            }
            continue;
          }

          if (it.kind === "area") {
            const px2 = polygonArea(pts);
            const unit = it.meta?.uom ?? "m2";
            const name = it.meta?.templateName ?? "Area";
            const category = it.meta?.category ?? null;
            const key = `${it.meta?.templateId ?? name}:${unit}:${it.kind}:${category ?? ""}`;
            if (mpp) {
              const qty = px2 * mpp * mpp;
              areaM2 += qty;
              const existing = takeoffGroup.get(key);
              if (existing) existing.qty += qty;
              else {
                takeoffGroup.set(key, {
                  key,
                  description: category ? `${name} (${category})` : name,
                  unit,
                  qty,
                  kind: it.kind,
                  category,
                });
              }
            } else {
              areaMissing += 1;
              const existing = takeoffGroup.get(key);
              if (existing) existing.uncalibrated = true;
              else {
                takeoffGroup.set(key, {
                  key,
                  description: category ? `${name} (${category})` : name,
                  unit,
                  qty: 0,
                  kind: it.kind,
                  category,
                  uncalibrated: true,
                });
              }
            }
          }
        }

        setTakeoffLines(Array.from(takeoffGroup.values()));

        const linearLabel =
          linearM > 0 ? formatMeters(linearM) : linearMissing ? `Uncalibrated (${linearMissing})` : "--";
        const areaLabel =
          areaM2 > 0 ? formatMeters2(areaM2) : areaMissing ? `Uncalibrated (${areaMissing})` : "--";
        const note =
          linearMissing || areaMissing
            ? "Some takeoffs are missing calibration."
            : null;

        setTakeoffSummary({ linearLabel, areaLabel, count, note });
      } catch (e: any) {
        if (cancelled) return;
        setTakeoffLines([]);
        setTakeoffSummary({ linearLabel: "--", areaLabel: "--", count: 0, note: "Failed to load takeoffs." });
      } finally {
        if (!cancelled) setTakeoffLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const names = new Map<string, string>();
    names.set(DEFAULT_CATEGORY_NAME.toLowerCase(), DEFAULT_CATEGORY_NAME);
    for (const line of takeoffLines) {
      const raw = (line.category ?? "").trim();
      const name = raw.length ? raw : DEFAULT_CATEGORY_NAME;
      names.set(name.toLowerCase(), name);
    }

    setCategories((prev) => {
      const next = [...prev];
      const existing = new Map<string, EstimateCategory>();
      for (const cat of prev) existing.set(cat.name.toLowerCase(), cat);
      for (const [key, name] of names.entries()) {
        if (!existing.has(key)) {
          next.push({ id: uid(), name });
        }
      }
      return next;
    });
  }, [takeoffLines]);

  const categoryByName = useMemo(() => {
    const map = new Map<string, EstimateCategory>();
    for (const cat of categories) {
      map.set(cat.name.toLowerCase(), cat);
    }
    return map;
  }, [categories]);

  const defaultCategoryId = useMemo(() => {
    return categoryByName.get(DEFAULT_CATEGORY_NAME.toLowerCase())?.id ?? null;
  }, [categoryByName]);

  const takeoffRows = useMemo(() => {
    return takeoffLines.map((line, idx) => {
      const override = takeoffOverrides[line.key];
      const rawCategory = (line.category ?? "").trim();
      const categoryName = rawCategory.length ? rawCategory : DEFAULT_CATEGORY_NAME;
      const categoryId =
        override?.categoryId ??
        categoryByName.get(categoryName.toLowerCase())?.id ??
        defaultCategoryId;
      return {
        key: `takeoff:${line.key}` as const,
        line,
        categoryId,
        displayIndex: idx,
      };
    });
  }, [takeoffLines, takeoffOverrides, categoryByName, defaultCategoryId]);

  const manualRows = useMemo(() => {
    return lines.map((line) => ({
      key: `line:${line.id}` as const,
      line,
      categoryId: line.categoryId ?? defaultCategoryId,
    }));
  }, [lines, defaultCategoryId]);

  const categoryRows = useMemo(() => {
    return categories.map((cat) => ({
      key: `cat:${cat.id}` as const,
      category: cat,
    }));
  }, [categories]);

  const rowByKey = useMemo(() => {
    const map = new Map<EstimateRowKey, { type: "category" | "manual" | "takeoff"; data: any }>();
    for (const row of categoryRows) {
      map.set(row.key, { type: "category", data: row.category });
    }
    for (const row of manualRows) {
      map.set(row.key, { type: "manual", data: row });
    }
    for (const row of takeoffRows) {
      map.set(row.key, { type: "takeoff", data: row });
    }
    return map;
  }, [categoryRows, manualRows, takeoffRows]);

  const collapsedSet = useMemo(() => {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(collapsedCategories)) {
      if (value) set.add(key);
    }
    return set;
  }, [collapsedCategories]);

  const categoryTotals = useMemo(() => {
    if (!defaultCategoryId) return new Map<string, number>();
    const totals = new Map<string, number>();

    for (const line of lines) {
      const catId = line.categoryId ?? defaultCategoryId;
      const amount = lineAmount(Number(line.qty) || 0, Number(line.rate) || 0, line.wastePct ?? 0);
      totals.set(catId, (totals.get(catId) ?? 0) + amount);
    }

    for (const line of takeoffLines) {
      const override = takeoffOverrides[line.key];
      const catId = override?.categoryId ?? defaultCategoryId;
      const qty = typeof override?.qty === "number" ? override.qty : line.qty;
      const rate = Number(takeoffRates[line.key]) || 0;
      const waste = override?.wastePct ?? 0;
      const amount = lineAmount(Number(qty) || 0, rate, waste);
      totals.set(catId, (totals.get(catId) ?? 0) + amount);
    }

    return totals;
  }, [lines, takeoffLines, takeoffOverrides, takeoffRates, defaultCategoryId]);

  useEffect(() => {
    const allKeys = new Set<EstimateRowKey>([
      ...categoryRows.map((r) => r.key),
      ...manualRows.map((r) => r.key),
      ...takeoffRows.map((r) => r.key),
    ]);

    setRowOrder((prev) => {
      const next = prev.filter((k) => allKeys.has(k));
      const missing = Array.from(allKeys).filter((k) => !next.includes(k));
      if (!next.length) {
        const grouped: EstimateRowKey[] = [];
        for (const cat of categoryRows) {
          grouped.push(cat.key);
          for (const row of takeoffRows) if (row.categoryId === cat.category.id) grouped.push(row.key);
          for (const row of manualRows) if (row.categoryId === cat.category.id) grouped.push(row.key);
        }
        const leftover = [...takeoffRows, ...manualRows]
          .filter((row) => !grouped.includes(row.key))
          .map((row) => row.key);
        return [...grouped, ...leftover];
      }
      return [...next, ...missing];
    });
  }, [categoryRows, manualRows, takeoffRows]);

  useEffect(() => {
    if (!rowOrder.length) return;
    if (!defaultCategoryId) return;

    const nextLineCats = new Map<string, string>();
    const nextTakeoffCats = new Map<string, string>();

    let currentCategoryId: string | null = defaultCategoryId;
    for (const key of rowOrder) {
      if (key.startsWith("cat:")) {
        currentCategoryId = key.slice(4);
        continue;
      }
      if (key.startsWith("line:")) {
        nextLineCats.set(key.slice(5), currentCategoryId ?? defaultCategoryId);
        continue;
      }
      if (key.startsWith("takeoff:")) {
        nextTakeoffCats.set(key.slice(8), currentCategoryId ?? defaultCategoryId);
      }
    }

    if (nextLineCats.size) {
      setLines((prev) =>
        prev.map((line) => {
          const nextCat = nextLineCats.get(line.id);
          return nextCat && line.categoryId !== nextCat ? { ...line, categoryId: nextCat } : line;
        })
      );
    }

    if (nextTakeoffCats.size) {
      setTakeoffOverrides((prev) => {
        const next = { ...prev };
        for (const [key, catId] of nextTakeoffCats.entries()) {
          if (next[key]?.categoryId === catId) continue;
          next[key] = { ...next[key], categoryId: catId };
        }
        return next;
      });
    }
  }, [rowOrder, defaultCategoryId]);

  const subtotal = useMemo(() => {
    const manualTotal = lines.reduce(
      (sum, l) => sum + lineAmount(Number(l.qty) || 0, Number(l.rate) || 0, l.wastePct ?? 0),
      0
    );
    const takeoffTotal = takeoffLines.reduce(
      (sum, l) => {
        const override = takeoffOverrides[l.key];
        const qty = typeof override?.qty === "number" ? override.qty : l.qty;
        const waste = override?.wastePct ?? 0;
        return sum + lineAmount(Number(qty) || 0, Number(takeoffRates[l.key]) || 0, waste);
      },
      0
    );
    return manualTotal + takeoffTotal;
  }, [lines, takeoffLines, takeoffRates, takeoffOverrides]);

  const total = subtotal;

  const nonemptyLines = useMemo(() => {
    return lines.filter((l) => {
      const hasDesc = (l.description || "").trim().length > 0;
      const hasQty = Number(l.qty) > 0;
      const hasRate = Number(l.rate) > 0;
      return hasDesc || hasQty || hasRate;
    }).length;
  }, [lines]);

  // Emit stats upward for progress bars
  useEffect(() => {
    onStats?.({ nonemptyLines, targetLines, total });
  }, [nonemptyLines, targetLines, total, onStats]);

  // Debounced save total_sales to projects (ONLY column we touch)
  const saveTimer = useRef<number | null>(null);
  const lastSavedTotal = useRef<number | null>(null);

  useEffect(() => {
    if (!projectId) return;

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        if (lastSavedTotal.current === total) return;
        lastSavedTotal.current = total;

        const { error } = await supabase
          .from("projects")
          .update({ total_sales: total })
          .eq("id", projectId);

        if (error) throw error;

        await qc.invalidateQueries({ queryKey: ["project", projectId] });
        await qc.invalidateQueries({ queryKey: ["projects"] });
      } catch (e: any) {
        toast({
          title: "Failed to update total sales",
          description: e?.message ?? "Unknown error",
          variant: "destructive",
        });
      }
    }, 650);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, projectId]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: uid(),
        code: String(p.length + 1).padStart(2, "0"),
        description: "",
        unit: "ls",
        qty: 1,
        rate: 0,
        wastePct: 0,
        categoryId: defaultCategoryId ?? undefined,
      },
    ]);
  }

  function addCategory() {
    const count = categories.length + 1;
    setCategories((prev) => [...prev, { id: uid(), name: `Category ${count}` }]);
  }

  function deleteCategory(categoryId: string) {
    if (categoryId === defaultCategoryId) return;
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    setRowOrder((prev) => prev.filter((k) => k !== `cat:${categoryId}`));
    setCollapsedCategories((prev) => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });

    if (defaultCategoryId) {
      setLines((prev) =>
        prev.map((line) => (line.categoryId === categoryId ? { ...line, categoryId: defaultCategoryId } : line))
      );
      setTakeoffOverrides((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(next)) {
          if (value?.categoryId === categoryId) {
            next[key] = { ...value, categoryId: defaultCategoryId };
          }
        }
        return next;
      });
    }
  }

  function deleteSelected() {
    const ids = new Set(Object.keys(selectedIds).filter((k) => selectedIds[k]));
    if (ids.size === 0) return;
    setLines((p) => p.filter((l) => !ids.has(l.id)));
    setSelectedIds({});
  }

  function importFromTakeoff() {
    toast({
      title: "Import from Takeoff",
      description: "Next step: map takeoff items to estimate lines (we can do this after takeoff persistence).",
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRowOrder((prev) => {
      const from = prev.indexOf(active.id as EstimateRowKey);
      const to = prev.indexOf(over.id as EstimateRowKey);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  }

  const containerClass = embedded ? "h-full" : "";

  const pct = clampPct((nonemptyLines / Math.max(1, targetLines)) * 100);

  return (
    <div className={containerClass}>
      <Card className={embedded ? "h-full border-0 shadow-none" : "p-4"}>
        <div className={embedded ? "p-4" : ""}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">Estimating</div>
              <div className="text-sm text-muted-foreground">
                Spreadsheet-like estimate. Totals are calculated live.{" "}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                  BOQ completion: {pct}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums">
                Subtotal: ${money(subtotal)}
              </div>
              <div className="rounded-full border border-border bg-background px-3 py-1 text-sm tabular-nums font-semibold">
                Total: ${money(total)}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={addLine}>Add line</Button>
            <Button variant="outline" onClick={addCategory}>
              Add category
            </Button>
            <Button variant="outline" onClick={deleteSelected}>
              Delete
            </Button>
            <Button variant="outline" onClick={importFromTakeoff}>
              Import from Takeoff
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1 overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-[48px] px-3 py-3 text-xs font-semibold text-muted-foreground"></th>
                  <th className="min-w-[320px] px-3 py-3 text-xs font-semibold text-muted-foreground">Cost item</th>
                  <th className="w-[160px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Budget code</th>
                  <th className="w-[160px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Quantity</th>
                  <th className="w-[140px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Unit cost ($)</th>
                  <th className="w-[120px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">Waste (%)</th>
                  <th className="w-[180px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right">
                    Subtotal item cost ($)
                  </th>
                  <th className="w-[64px] px-3 py-3 text-xs font-semibold text-muted-foreground text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rowOrder.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={8}>
                      No estimate lines yet.
                    </td>
                  </tr>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={rowOrder} strategy={verticalListSortingStrategy}>
                      {rowOrder.map((rowKey) => {
                        const row = rowByKey.get(rowKey);
                        if (!row) return null;

                        if (row.type === "category") {
                          const cat = row.data as EstimateCategory;
                          const total = categoryTotals.get(cat.id) ?? 0;
                          const isCollapsed = collapsedSet.has(cat.id);
                          return (
                            <SortableRow key={rowKey} id={rowKey} className="border-t border-border bg-muted/30">
                              {() => (
                                <>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center gap-2">
                                      <input type="checkbox" />
                                      <button
                                        type="button"
                                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                        onClick={() =>
                                          setCollapsedCategories((prev) => ({
                                            ...prev,
                                            [cat.id]: !prev[cat.id],
                                          }))
                                        }
                                      >
                                        {isCollapsed ? (
                                          <ChevronRight className="h-4 w-4" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4" />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-3">
                                      <Input
                                        value={cat.name}
                                        className="h-8 border-0 bg-transparent px-0 font-semibold focus-visible:ring-0"
                                        onChange={(e) =>
                                          setCategories((prev) =>
                                            prev.map((c) => (c.id === cat.id ? { ...c, name: e.target.value } : c))
                                          )
                                        }
                                      />
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Button variant="link" className="h-8 px-0 text-blue-600">
                                      Select
                                    </Button>
                                  </td>
                                  <td className="px-3 py-2 text-right text-sm tabular-nums text-blue-600">1 x</td>
                                  <td className="px-3 py-2 text-right"></td>
                                  <td className="px-3 py-2 text-right text-sm tabular-nums text-blue-600">0.00</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">${money(total)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                      {cat.id !== defaultCategoryId ? (
                                        <button
                                          type="button"
                                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                          onClick={() => deleteCategory(cat.id)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </>
                              )}
                            </SortableRow>
                          );
                        }

                        if (row.type === "takeoff") {
                          const entry = row.data as (typeof takeoffRows)[number];
                          const l = entry.line;
                          if (entry.categoryId && collapsedSet.has(entry.categoryId)) return null;
                          const override = takeoffOverrides[l.key];
                          const rate = Number(takeoffRates[l.key]) || 0;
                          const code =
                            override?.code ??
                            `TO-${String(entry.displayIndex + 1).padStart(2, "0")}`;
                          const description =
                            override?.description ?? (l.uncalibrated ? `${l.description} (uncalibrated)` : l.description);
                          const unit = override?.unit ?? l.unit;
                          const qty = typeof override?.qty === "number" ? override.qty : l.qty;
                          const waste = override?.wastePct ?? 0;
                          const amount = lineAmount(Number(qty) || 0, rate, waste);
                          return (
                            <SortableRow key={rowKey} id={rowKey} className="border-t border-border bg-muted/10">
                              {() => (
                                <>
                                  <td className="px-2 py-2">
                                    <input type="checkbox" />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      value={description}
                                      className="h-8 pl-8"
                                      onChange={(e) =>
                                        setTakeoffOverrides((p) => ({
                                          ...p,
                                          [l.key]: { ...p[l.key], description: e.target.value },
                                        }))
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Button variant="link" className="h-8 px-0 text-blue-600">
                                      Select
                                    </Button>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex items-center gap-2 rounded border border-blue-600 px-2 py-1 text-xs tabular-nums text-blue-600">
                                      {Number(qty).toFixed(2)} {unit}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Input
                                      type="number"
                                      value={rate}
                                      className="h-8 text-right"
                                      onChange={(e) =>
                                        setTakeoffRates((p) => ({ ...p, [l.key]: Number(e.target.value) }))
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <Input
                                      type="number"
                                      value={waste}
                                      className="h-8 text-right"
                                      onChange={(e) =>
                                        setTakeoffOverrides((p) => ({
                                          ...p,
                                          [l.key]: { ...p[l.key], wastePct: Number(e.target.value) },
                                        }))
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                    ${money(amount)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                  </td>
                                </>
                              )}
                            </SortableRow>
                          );
                        }

                        const entry = row.data as (typeof manualRows)[number];
                        const l = entry.line;
                        if (entry.categoryId && collapsedSet.has(entry.categoryId)) return null;
                        const amount = lineAmount(Number(l.qty) || 0, Number(l.rate) || 0, l.wastePct ?? 0);
                        return (
                          <SortableRow key={rowKey} id={rowKey} className="border-t border-border">
                            {() => (
                              <>
                                <td className="px-2 py-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={!!selectedIds[l.id]}
                                      onChange={(e) => setSelectedIds((p) => ({ ...p, [l.id]: e.target.checked }))}
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <Input
                                    value={l.description}
                                    className="h-8 pl-8"
                                    onChange={(e) =>
                                      setLines((p) =>
                                        p.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x))
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <Button variant="link" className="h-8 px-0 text-blue-600">
                                    Select
                                  </Button>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="inline-flex items-center gap-2 rounded border border-blue-600 px-2 py-1 text-xs tabular-nums text-blue-600">
                                    {Number(l.qty).toFixed(2)} {l.unit}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <Input
                                    type="number"
                                    value={l.rate}
                                    className="h-8 text-right"
                                    onChange={(e) =>
                                      setLines((p) =>
                                        p.map((x) => (x.id === l.id ? { ...x, rate: Number(e.target.value) } : x))
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <Input
                                    type="number"
                                    value={l.wastePct ?? 0}
                                    className="h-8 text-right"
                                    onChange={(e) =>
                                      setLines((p) =>
                                        p.map((x) =>
                                          x.id === l.id ? { ...x, wastePct: Number(e.target.value) } : x
                                        )
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                  ${money(amount)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                </td>
                              </>
                            )}
                          </SortableRow>
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                )}
              </tbody>
              </table>
            </div>

            <div className="w-full lg:w-[280px]">
              <div className="rounded-xl border border-border p-3">
                <div className="text-sm font-semibold">Takeoff summary</div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Linear</span>
                    <span className="font-medium">{takeoffSummary.linearLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Area</span>
                    <span className="font-medium">{takeoffSummary.areaLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Count</span>
                    <span className="font-medium">{takeoffSummary.count}</span>
                  </div>
                </div>
                {takeoffLoading ? (
                  <div className="mt-2 text-xs text-muted-foreground">Loading takeoffs...</div>
                ) : takeoffSummary.note ? (
                  <div className="mt-2 text-xs text-muted-foreground">{takeoffSummary.note}</div>
                ) : null}
              </div>
              
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground"></div>
        </div>
      </Card>
    </div>
  );
}

export default function EstimatingWorkspace() {
  // Standalone page use (if you route directly here)
  // You likely wrap this via ProjectDetails; keep this for safety.
  return (
    <div className="p-4">
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Open this workspace via a project to load projectId.</div>
      </Card>
    </div>
  );
}
