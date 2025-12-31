"use client";

import React, { useMemo, useState } from "react";
import {
  Check,
  Zap,
  Ruler,
  Layers,
  Cloud,
  ShieldCheck,
  Wand2,
  GitCompare,
  Keyboard,
  FileSpreadsheet,
  Boxes,
  Workflow,
  ArrowRight,
} from "lucide-react";

/**
 * MarketingSite
 * (Restores the original “first layout” landing page)
 */

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
    {children}
  </span>
);

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
    {children}
  </span>
);

const Button = ({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) => {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition";
  const styles =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
};

const Card = ({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex items-start gap-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
        <Icon className="h-5 w-5 text-slate-800" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div>
      </div>
    </div>
  </div>
);

const SectionTitle = ({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) => (
  <div className="mx-auto max-w-3xl text-center">
    {kicker ? (
      <div className="mb-3 flex justify-center">
        <Badge>{kicker}</Badge>
      </div>
    ) : null}
    <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
      {title}
    </h2>
    {subtitle ? (
      <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{subtitle}</p>
    ) : null}
  </div>
);

const FeatureList = ({ items }: { items: string[] }) => (
  <ul className="space-y-3">
    {items.map((t) => (
      <li key={t} className="flex gap-2 text-sm text-slate-700">
        <Check className="mt-0.5 h-4 w-4 text-slate-900" />
        <span>{t}</span>
      </li>
    ))}
  </ul>
);

export default function MarketingSite() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");

  const shortcuts = useMemo(
    () => [
      { k: "L", v: "Line" },
      { k: "S", v: "Segment / Polyline" },
      { k: "A", v: "Area / Polygon" },
      { k: "C", v: "Count" },
      { k: "Shift+C", v: "Auto Count" },
      { k: "AL", v: "Auto Line (box trace)" },
      { k: "R", v: "Record (re-edit geometry)" },
      { k: "R (Shape)", v: "Rectangle / Square (Line & Area)" },
      { k: "O", v: "Circle / Ellipse (Line & Area)" },
      { k: "Enter", v: "Commit" },
      { k: "Esc", v: "Cancel" },
      { k: "Ctrl+Z / Ctrl+Y", v: "Undo / Redo" },
      { k: "Ctrl+D", v: "Duplicate" },
    ],
    []
  );

  const mvp = useMemo(
    () => [
      "Browser-based PDF viewer with takeoff overlay (objects are structured data, not just drawings).",
      "Core tools: Line, Segment/Polyline, Area/Polygon, Count, with customizable hotkeys.",
      "Shape primitives: Rectangle/Square and Circle/Ellipse for both Line and Area modes.",
      "Snap + constraints: endpoints/midpoints/intersections, angle locks, typed lengths, nudge.",
      "Quantities Grid: filters, totals, custom fields, and clean Excel export.",
      "Revision workflow: sheet versions, overlay/compare, and re-check flags.",
      "Auto Line (box trace): preview + confirm + editable output.",
      "Record Mode (R): re-edit any line/area without losing metadata or assemblies.",
      "Cloud projects, permissions, audit log, and shareable review links.",
    ],
    []
  );

  const v1 = useMemo(
    () => [
      "Typical groups/repeating areas/pages: take off once, apply to multiple units with multipliers.",
      "Auto Count with symbol libraries, confidence preview, and batch processing across sheets.",
      "Assemblies + cost catalog: link takeoffs to materials/labor; totals update instantly.",
      "Collaboration: concurrent editing with conflict-safe merging and comments/reviews.",
      "2D + 3D quantities (optional tier): model-based quantities for BIM workflows.",
      "Desktop companion (optional): offline mode + high-performance takeoff for heavy sets.",
    ],
    []
  );

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge>Cloud-first</Badge>
              <Badge>Estimator-speed hotkeys</Badge>
              <Badge>Revision-ready</Badge>
              <Badge>Data-first quantities</Badge>
            </div>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Aostot combines the best takeoff workflows into one platform.
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
              A cloud-based on-screen takeoff platform built for speed, trust, and traceability—
              with Auto Line, Auto Count, revision overlays, a quantities grid, and Record Mode
              for edit-in-place corrections.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href="#waitlist">
                <Button variant="primary" className="px-5 py-3">
                  Request early access <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
              <a href="#features">
                <Button variant="secondary" className="px-5 py-3">
                  See the feature set
                </Button>
              </a>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-500">Core tools</div>
                <div className="mt-1 text-sm font-semibold">Line • Area • Count</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-500">Automation</div>
                <div className="mt-1 text-sm font-semibold">Auto Line • Auto Count</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-500">QA/QC</div>
                <div className="mt-1 text-sm font-semibold">Overlay • Audit • Status</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-500">Outputs</div>
                <div className="mt-1 text-sm font-semibold">Excel • Reports • API</div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Takeoff Workspace Preview</div>
              <div className="flex gap-2">
                <Pill>R: Record</Pill>
                <Pill>AL: Auto Line</Pill>
                <Pill>Shift+C: Auto Count</Pill>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-700">Tools</div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Line</span>
                    <span className="text-xs text-slate-500">L</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Area</span>
                    <span className="text-xs text-slate-500">A</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Count</span>
                    <span className="text-xs text-slate-500">C</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Auto Line</span>
                    <span className="text-xs text-slate-500">AL</span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-700">Sheet</div>
                  <div className="text-xs text-slate-500">Scale: 1:100 • Rev B</div>
                </div>
                <div className="mt-3 h-48 rounded-xl border border-dashed border-slate-300 bg-slate-50" />
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    Live Length: <span className="font-semibold text-slate-900">12.40m</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    Live Area: <span className="font-semibold text-slate-900">18.9m²</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    Status: <span className="font-semibold text-slate-900">Checked</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionTitle
            kicker="Feature set"
            title="Automation that stays controllable, with estimator-grade editing"
            subtitle="Every automation step is previewable, editable, auditable, and exportable."
          />

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card title="Core takeoff speed" icon={Zap}>
              Hotkeys, snapping/constraints, shape tools (square/circle for line & area), copy/array, and heads-up live totals.
            </Card>
            <Card title="Quantities Grid" icon={FileSpreadsheet}>
              A takeoff database: custom fields, formulas, filters, statuses, totals, and clean Excel exports.
            </Card>
            <Card title="Revisions + overlays" icon={GitCompare}>
              Sheet versioning, overlay/compare, and re-check flags to keep quantities accurate across addenda.
            </Card>
            <Card title="Auto Line (box trace)" icon={Wand2}>
              Draw a box to trace internal linework. Preview + confirm. Anchor mode for noisy plans. Editable polylines.
            </Card>
            <Card title="Auto Count" icon={Boxes}>
              Symbol libraries, confidence preview, batch processing, and fast correction tools.
            </Card>
            <Card title="Record Mode (R)" icon={Ruler}>
              Re-edit any line/area geometry without deleting. Preserve item metadata, assemblies, and audit history.
            </Card>
            <Card title="Collaboration" icon={Cloud}>
              Browser-first access, permissions, concurrent editing, comments, shareable review links, and audit logs.
            </Card>
            <Card title="Typical groups" icon={Layers}>
              Take off once and apply to repeating units/pages with multipliers and clear documentation.
            </Card>
            <Card title="Security & governance" icon={ShieldCheck}>
              Workspace controls, SSO-ready auth, retention policies, exports, and activity trails.
            </Card>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionTitle
            kicker="Workflow"
            title="Designed around estimator muscle memory"
            subtitle="Fast tool switching, predictable objects, and edit-in-place corrections keep production moving."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-slate-900" />
                <h3 className="text-base font-semibold">Typical takeoff flow</h3>
              </div>
              <div className="mt-4">
                <FeatureList
                  items={[
                    "Import sheet set (PDF). Auto page naming + per-sheet scale presets.",
                    "Take off with hotkeys (Line/Area/Count), shapes (Square/Circle), snapping and constraints.",
                    "Use Auto Line and Auto Count with preview-first confirmation.",
                    "Use Record Mode (R) to correct geometry without losing metadata or assemblies.",
                    "Review in Quantities Grid (filters, statuses, audit), then export Excel or push via API.",
                    "When revisions arrive: overlay/compare, re-check flagged items, and export deltas.",
                  ]}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Keyboard className="h-5 w-5 text-slate-900" />
                <h3 className="text-base font-semibold">Shortcut baseline</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                All shortcuts are user-configurable. This is a sensible default set for rapid adoption.
              </p>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">Key</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortcuts.map((row) => (
                      <tr key={row.k} className="border-t border-slate-200">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.k}</td>
                        <td className="px-4 py-3 text-slate-700">{row.v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section id="roadmap" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionTitle
            kicker="Roadmap"
            title="Ship an MVP that wins trust, then scale into automation and bidding depth"
            subtitle="Start with reliability and speed. Add typicals, catalogs, and advanced automation as adoption grows."
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center gap-2">
                <Badge>MVP</Badge>
                <span className="text-sm font-semibold text-slate-900">Core takeoff + revisions</span>
              </div>
              <div className="mt-4">
                <FeatureList items={mvp} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center gap-2">
                <Badge>V1</Badge>
                <span className="text-sm font-semibold text-slate-900">Automation + bidding links</span>
              </div>
              <div className="mt-4">
                <FeatureList items={v1} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionTitle
            kicker="Early access"
            title="Build a waitlist and validate workflows"
            subtitle="This form is a placeholder. It can be wired to Supabase later."
          />

          <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">Work email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Company / trade</label>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="GC, Electrical, QS, etc."
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <Button
              variant="primary"
              className="mt-4 w-full px-5 py-3"
              onClick={() => alert("Demo only. Connect this to a real waitlist backend.")}
            >
              Request access
            </Button>

            <p className="mt-3 text-xs text-slate-500">
              No spam. Use this to schedule demos, collect requirements, and prioritize MVP.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-xl bg-slate-900" />
            <span className="font-semibold text-slate-900">Aostot</span>
            <span className="text-slate-400">•</span>
            <span>Cloud On-Screen Takeoff</span>
          </div>
          <div className="flex gap-5">
            <a className="hover:text-slate-900" href="#features">
              Features
            </a>
            <a className="hover:text-slate-900" href="#roadmap">
              Roadmap
            </a>
            <a className="hover:text-slate-900" href="#waitlist">
              Waitlist
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
