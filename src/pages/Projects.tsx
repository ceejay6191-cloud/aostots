import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  LayoutGrid,
  Table as TableIcon,
  Filter,
  Save,
  X,
  FolderKanban,
  Activity,
  FileText,
  Trophy,
  Ban,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { ProjectsTable } from "@/components/projects/ProjectsTable";
import { ProjectsCards } from "@/components/projects/ProjectsCards";
import type { ProjectStatus } from "@/types/project";

type ViewMode = "table" | "cards";

type SavedView = {
  id: string;
  name: string;
  status: "all" | ProjectStatus;
  q: string;
  view: ViewMode;
};

const SAVED_VIEWS_KEY = "aostot:saved_project_views:v1";

function safeId() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Projects() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { data: projects = [] } = useProjects();

  const statusParam = (sp.get("status") as SavedView["status"]) || "all";
  const qParam = sp.get("q") || "";
  const viewParam = (sp.get("view") as ViewMode) || "table";

  const [q, setQ] = useState(qParam);
  useEffect(() => setQ(qParam), [qParam]);

  const counts = useMemo(() => {
    const c = { all: projects.length, active: 0, bidding: 0, won: 0, lost: 0 };
    for (const p of projects) {
      if (p.status === "active") c.active++;
      if (p.status === "bidding") c.bidding++;
      if (p.status === "won") c.won++;
      if (p.status === "lost") c.lost++;
    }
    return c;
  }, [projects]);

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      return raw ? (JSON.parse(raw) as SavedView[]) : [];
    } catch {
      return [];
    }
  });

  function persistSavedViews(next: SavedView[]) {
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  }

  function setStatus(next: SavedView["status"]) {
    const nextSp = new URLSearchParams(sp);
    if (next === "all") nextSp.delete("status");
    else nextSp.set("status", next);
    setSp(nextSp, { replace: true });
  }

  function setQuery(next: string) {
    const nextSp = new URLSearchParams(sp);
    if (!next.trim()) nextSp.delete("q");
    else nextSp.set("q", next);
    setSp(nextSp, { replace: true });
  }

  function setView(next: ViewMode) {
    const nextSp = new URLSearchParams(sp);
    nextSp.set("view", next);
    setSp(nextSp, { replace: true });
  }

  const activeLabel = useMemo(() => {
    if (statusParam === "all") return "All Projects";
    if (statusParam === "active") return "Active";
    if (statusParam === "bidding") return "Bidding";
    if (statusParam === "won") return "Won";
    return "Lost";
  }, [statusParam]);

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-3xl font-bold tracking-tight">Projects</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Manage your construction projects and track their progress.
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => navigate("/projects/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>

        {/* Tabs like your reference */}
        <div className="border-b">
          <Tabs value={statusParam} onValueChange={(v) => setStatus(v as any)}>
            <TabsList className="bg-transparent p-0 gap-8">
              {(
                [
                  { key: "all" as const, label: "All Projects", count: counts.all, Icon: FolderKanban },
                  { key: "active" as const, label: "Active", count: counts.active, Icon: Activity },
                  { key: "bidding" as const, label: "Bidding", count: counts.bidding, Icon: FileText },
                  { key: "won" as const, label: "Won", count: counts.won, Icon: Trophy },
                  { key: "lost" as const, label: "Lost", count: counts.lost, Icon: Ban },
                ]
              ).map(({ key, label, count, Icon }) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="px-0 pb-3 pt-2 bg-transparent shadow-none rounded-none border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {label}
                    <Badge variant="secondary" className="ml-1">
                      {count}
                    </Badge>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Filters / Views / Saved filters */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative w-full max-w-md">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${activeLabel.toLowerCase()}…`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQuery(q);
                }}
              />
              {qParam ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setQ("");
                    setQuery("");
                  }}
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <Button variant="outline" onClick={() => setQuery(q)}>
              <Filter className="mr-2 h-4 w-4" />
              Apply
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Views toggle */}
            <Button
              variant={viewParam === "table" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("table")}
              title="Table view"
            >
              <TableIcon className="h-4 w-4" />
            </Button>
            <Button
              variant={viewParam === "cards" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("cards")}
              title="Cards view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>

            {/* Saved filters */}
            <div className="h-6 w-px bg-border mx-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const name = window.prompt("Name this view (example: 'My bids', 'High value won'):");
                if (!name) return;
                const next: SavedView = {
                  id: safeId(),
                  name: name.trim() || "Saved view",
                  status: statusParam,
                  q: qParam,
                  view: viewParam,
                };
                persistSavedViews([next, ...savedViews].slice(0, 12));
              }}
              title="Save current filters"
            >
              <Save className="mr-2 h-4 w-4" />
              Save view
            </Button>

            {savedViews.length ? (
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  const v = savedViews.find((s) => s.id === id);
                  if (!v) return;
                  const nextSp = new URLSearchParams(sp);
                  if (v.status === "all") nextSp.delete("status");
                  else nextSp.set("status", v.status);
                  if (!v.q) nextSp.delete("q");
                  else nextSp.set("q", v.q);
                  nextSp.set("view", v.view);
                  setSp(nextSp, { replace: true });
                  e.currentTarget.value = "";
                }}
                title="Load saved view"
              >
                <option value="">Saved views…</option>
                {savedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}

            {savedViews.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const ok = window.confirm("Clear all saved views?");
                  if (!ok) return;
                  persistSavedViews([]);
                }}
                title="Clear saved views"
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {/* Main */}
        {viewParam === "cards" ? (
          <ProjectsCards statusFilter={statusParam === "all" ? undefined : (statusParam as ProjectStatus)} query={qParam} />
        ) : (
          <ProjectsTable statusFilter={statusParam === "all" ? undefined : (statusParam as ProjectStatus)} query={qParam} />
        )}
      </div>
    </AppLayout>
  );
}
