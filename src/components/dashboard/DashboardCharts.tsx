import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import type { ProjectStatus } from "@/types/project";

type Pt = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatCurrencyCompact(n: number) {
  // Compact formatting (e.g., $12k, $1.2M)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function startOfWeek(d: Date) {
  // Monday start
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0=Mon
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtShort(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

export function DashboardCharts() {
  const navigate = useNavigate();
  const { data: stats } = useProjectStats();
  const { data: projects = [] } = useProjects();
  const [mode, setMode] = useState<"value" | "count">("value");

  const series = useMemo(() => {
    // last 8 weeks (including this week)
    const now = new Date();
    const w0 = startOfWeek(addDays(now, -7 * 7));
    const weeks: { start: Date; value: number; count: number }[] = [];
    for (let i = 0; i < 8; i++) {
      weeks.push({ start: addDays(w0, i * 7), value: 0, count: 0 });
    }

    for (const p of projects) {
      const created = p.created_at ? new Date(p.created_at) : null;
      if (!created || isNaN(created.getTime())) continue;
      const s = startOfWeek(created);
      const idx = Math.floor((s.getTime() - weeks[0].start.getTime()) / (7 * 24 * 3600 * 1000));
      if (idx < 0 || idx >= weeks.length) continue;
      weeks[idx].count += 1;
      weeks[idx].value += Number(p.total_sales || 0);
    }
    return weeks;
  }, [projects]);

  const line = useMemo(() => {
    const w = 540;
    const h = 180;
    const pad = 24;
    const maxY = Math.max(
      1,
      ...series.map((s) => (mode === "value" ? s.value : s.count))
    );
    const minY = 0;
    const xs = series.map((_, i) => (series.length === 1 ? pad : pad + (i * (w - pad * 2)) / (series.length - 1)));
    const ys = series.map((s) => {
      const v = mode === "value" ? s.value : s.count;
      const t = (v - minY) / (maxY - minY);
      return h - pad - t * (h - pad * 2);
    });
    const pts: Pt[] = xs.map((x, i) => ({ x, y: ys[i] }));
    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    return { w, h, pad, maxY, pts, d };
  }, [series, mode]);

  const donut = useMemo(() => {
    const total = stats?.total ?? 0;
    const parts: { key: ProjectStatus; label: string; value: number }[] = [
      { key: "active", label: "Active", value: stats?.active ?? 0 },
      { key: "bidding", label: "Bidding", value: stats?.bidding ?? 0 },
      { key: "won", label: "Won", value: stats?.won ?? 0 },
      { key: "lost", label: "Lost", value: stats?.lost ?? 0 },
    ];

    // If there are no projects yet, render as empty ring.
    if (!total) return { total: 0, parts: parts.map((p) => ({ ...p, a0: 0, a1: 0 })) };

    let a = -Math.PI / 2;
    const out = parts.map((p) => {
      const frac = p.value / total;
      const a0 = a;
      const a1 = a + frac * Math.PI * 2;
      a = a1;
      return { ...p, a0, a1 };
    });
    return { total, parts: out };
  }, [stats]);

  // Simple palette for chart legibility (kept subtle via opacity).
  const donutClass: Record<ProjectStatus, string> = {
    active: "fill-sky-500/15 stroke-sky-600/60",
    bidding: "fill-amber-500/15 stroke-amber-600/60",
    won: "fill-emerald-500/15 stroke-emerald-600/60",
    lost: "fill-rose-500/15 stroke-rose-600/60",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Pipeline trend</div>
            <div className="text-xs text-muted-foreground">Last 8 weeks</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={mode === "value" ? "default" : "outline"}
              onClick={() => setMode("value")}
            >
              Value
            </Button>
            <Button
              size="sm"
              variant={mode === "count" ? "default" : "outline"}
              onClick={() => setMode("count")}
            >
              Count
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <svg width={line.w} height={line.h} className="block">
            {/* Grid */}
            <g className="stroke-border" strokeWidth={1} opacity={0.7}>
              {Array.from({ length: 4 }).map((_, i) => {
                const y = line.pad + (i * (line.h - line.pad * 2)) / 3;
                return <line key={i} x1={line.pad} y1={y} x2={line.w - line.pad} y2={y} />;
              })}
            </g>

            {/* Line */}
            <path d={line.d} className="stroke-primary" strokeWidth={2.5} fill="none" />

            {/* Points */}
            {line.pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} className="fill-primary" />
            ))}

            {/* X labels (sparse) */}
            <g className="fill-muted-foreground" fontSize={10}>
              {series.map((s, i) => {
                if (i % 2 === 1 && i !== series.length - 1) return null;
                const x = line.pad + (i * (line.w - line.pad * 2)) / (series.length - 1);
                return (
                  <text key={i} x={x} y={line.h - 8} textAnchor="middle">
                    {fmtShort(s.start)}
                  </text>
                );
              })}
            </g>
          </svg>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Tip: This is computed from <span className="font-medium">created date</span> and <span className="font-medium">total sales</span>. Next enhancement: toggle by <span className="font-medium">status</span> and add hover tooltips.
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Status distribution</div>
        <div className="text-xs text-muted-foreground">Click a segment to filter Projects</div>

        <div className="mt-4 flex items-center gap-4">
          <svg width={140} height={140} viewBox="0 0 140 140" className="shrink-0">
            {/* Ring */}
            <circle cx={70} cy={70} r={52} className="fill-none stroke-border" strokeWidth={18} />

            {/* Segments */}
            {donut.total ? (
              donut.parts.map((p) => (
                <path
                  key={p.key}
                  d={arcPath(70, 70, 60, p.a0, p.a1)}
                  className={`${donutClass[p.key]} cursor-pointer`}
                  strokeWidth={1}
                  onClick={() => navigate(`/projects?status=${p.key}`)}
                />
              ))
            ) : (
              <circle cx={70} cy={70} r={60} className="fill-muted/30" />
            )}

            {/* Center */}
            <circle cx={70} cy={70} r={44} className="fill-background" />
            <text x={70} y={70} textAnchor="middle" dominantBaseline="central" className="fill-foreground" fontSize={18} fontWeight={700}>
              {donut.total}
            </text>
            <text x={70} y={92} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
              projects
            </text>
          </svg>

          <div className="min-w-0 space-y-2 text-sm">
            {donut.parts.map((p) => (
              <button
                key={p.key}
                type="button"
                className="w-full text-left rounded-md px-2 py-1 hover:bg-muted/50"
                onClick={() => navigate(`/projects?status=${p.key}`)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">{p.label}</div>
                  <div className="font-medium tabular-nums">{p.value}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
