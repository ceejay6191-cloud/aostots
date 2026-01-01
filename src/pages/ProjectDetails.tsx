import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABELS, ProjectStatus } from "@/types/project";
import { TakeoffWorkspaceContent } from "@/pages/TakeoffWorkspace";
import { EstimatingWorkspaceContent } from "@/pages/EstimatingWorkspace";
import { ProposalWorkspaceContent } from "@/pages/ProposalWorkspace";
import { ScanWorkspaceContent } from "@/pages/ScanWorkspace";

import {
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  TrendingUp,
  FileText,
  Ruler,
  Calculator,
  Send,
} from "lucide-react";

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  client_email: string | null;
  status: ProjectStatus;
  total_sales: number | null;
  notes: string | null;
  created_at: string;

  // persisted fields (if present in DB)
  location: string | null;
  description: string | null;
  start_date: string | null; // YYYY-MM-DD
  completion_date: string | null; // YYYY-MM-DD

  // optional (if present in DB)
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  primary_contact_phone?: string | null;
};

type TabKey = "overview" | "documents" | "takeoff" | "estimating" | "proposal" | "scan";

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

function stableStringify(v: unknown) {
  return JSON.stringify(v, Object.keys(v as any).sort());
}

function clampPct(v: number) {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function formatMoney(n?: number | null) {
  const v = Number(n ?? 0);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ActivityItem = { at: number; actor?: string; action: string; meta?: Record<string, unknown> };

function readActivity(projectId: string): ActivityItem[] {
  try {
    const raw = localStorage.getItem(`aostot:activity:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => typeof (x as any)?.at === "number" && typeof (x as any)?.action === "string")
      .slice(0, 30);
  } catch {
    return [];
  }
}

function pushActivity(projectId: string, item: ActivityItem) {
  try {
    const list = readActivity(projectId);
    const next = [item, ...list].slice(0, 30);
    localStorage.setItem(`aostot:activity:${projectId}`, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function ProgressBar({ value }: { value: number }) {
  const v = clampPct(value);
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}

/**
 * Progress calculations (derived; not stored in DB yet)
 * - docs_pct: default target_docs = 1 (first PDF => 100%)
 * - takeoff_pct: placeholder (requires takeoff persistence/stats) => 0 for now
 * - estimating_pct: based on non-empty estimate lines stored by EstimatingWorkspace in localStorage
 * - proposal_pct: based on ProposalWorkspace draft status stored in localStorage
 * - overall_pct: weighted average
 */
const TARGET_DOCS = 1;
const TARGET_LINES = 20;

type EstimateRow = {
  id?: string;
  code?: string;
  description?: string;
  unit?: string;
  qty?: number | string;
  rate?: number | string;
};

function readEstimateRows(projectId: string): EstimateRow[] {
  try {
    const raw = localStorage.getItem(`aostot:estimate:${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as EstimateRow[];
  } catch {
    return [];
  }
}

type ProposalDraft = { status?: string };

function readProposalStatus(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(`aostot:proposal:${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProposalDraft;
    return (parsed?.status ?? null) as string | null;
  } catch {
    return null;
  }
}

function computeDocsPct(docsCount: number) {
  if (TARGET_DOCS <= 0) return 0;
  return clampPct((Math.min(docsCount, TARGET_DOCS) / TARGET_DOCS) * 100);
}

function computeEstimatingPct(rows: EstimateRow[]) {
  const nonempty = rows.filter((r) => {
    const desc = String(r.description ?? "").trim();
    const qty = Number(r.qty ?? 0);
    const rate = Number(r.rate ?? 0);
    return Boolean(desc) || qty > 0 || rate > 0;
  }).length;

  if (TARGET_LINES <= 0) return 0;
  return clampPct((nonempty / TARGET_LINES) * 100);
}

function computeProposalPct(statusRaw: string | null) {
  const s = String(statusRaw ?? "").trim().toLowerCase();
  if (!s) return 0;

  if (s === "draft") return 50;
  if (s === "sent") return 90;
  if (s === "accepted") return 100;
  if (s === "rejected") return 100;

  // allow variants
  if (s.includes("draft")) return 50;
  if (s.includes("sent")) return 90;
  if (s.includes("accept")) return 100;
  if (s.includes("reject")) return 100;

  return 0;
}

function computeOverallPct(docsPct: number, takeoffPct: number, estimatingPct: number, proposalPct: number) {
  return clampPct(docsPct * 0.2 + takeoffPct * 0.35 + estimatingPct * 0.3 + proposalPct * 0.15);
}

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // ------------------------------------------------------------
  // Project query
  // NOTE: We cast supabase to `any` to avoid "No matching export / relation" issues
  // when local generated types are out-of-date. You can regenerate types later.
  // ------------------------------------------------------------
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select(
          "id,name,client_name,client_email,status,total_sales,notes,created_at,location,description,start_date,completion_date,primary_contact_name,primary_contact_email,primary_contact_phone"
        )
        .eq("id", projectId)
        .single();

      if (error) throw error;
      return data as ProjectRow;
    },
  });

  // ------------------------------------------------------------
  // Documents query
  // ------------------------------------------------------------
  const { data: documents, isLoading: docsLoading } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("project_documents")
        .select("id,project_id,owner_id,bucket,path,file_name,mime_type,size_bytes,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
  });

  // ------------------------------------------------------------
  // Local editable form state + autosave
  // ------------------------------------------------------------
  const statusOptions = useMemo(() => Object.keys(STATUS_LABELS) as ProjectStatus[], []);

  const [form, setForm] = useState({
    name: "",
    client_name: "",
    client_email: "",
    status: "bidding" as ProjectStatus,
    notes: "",

    location: "",
    description: "",
    start_date: "",
    completion_date: "",

    primary_contact_name: "",
    primary_contact_email: "",
    primary_contact_phone: "",
  });

  // ------------------------------------------------------------
  // Inline edit: Project title (click to edit)
  // ------------------------------------------------------------
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitleDraft(form.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!editingTitle) return;
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [editingTitle]);

  function commitTitle() {
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(form.name);
      setEditingTitle(false);
      return;
    }
    setForm((p) => ({ ...p, name: next }));
    setTitleDraft(next);
    setEditingTitle(false);
  }

  const didInitFormRef = useRef(false);

  useEffect(() => {
    didInitFormRef.current = false;
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    if (didInitFormRef.current) return;

    setForm({
      name: project.name ?? "",
      client_name: project.client_name ?? "",
      client_email: project.client_email ?? "",
      status: project.status ?? "bidding",
      notes: project.notes ?? "",

      location: project.location ?? "",
      description: project.description ?? "",
      start_date: project.start_date ?? "",
      completion_date: project.completion_date ?? "",

      primary_contact_name: project.primary_contact_name ?? "",
      primary_contact_email: project.primary_contact_email ?? "",
      primary_contact_phone: project.primary_contact_phone ?? "",
    });

    didInitFormRef.current = true;
  }, [project]);

  const lastSavedKeyRef = useRef<string>("");
  const autosaveTimerRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const autosaveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!projectId) throw new Error("Missing projectId");
      const { error } = await (supabase as any).from("projects").update(payload).eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSaveState("saved");
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      await qc.invalidateQueries({ queryKey: ["projects"] });

      try {
        const { data } = await supabase.auth.getUser();
        const actor = data.user?.email ?? "Unknown user";
        pushActivity(projectId!, { at: Date.now(), actor, action: "Updated project details" });
      } catch {
        pushActivity(projectId!, { at: Date.now(), action: "Updated project details" });
      }
    },
    onError: (e: any) => {
      setSaveState("idle");
      toast({
        title: "Autosave failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!projectId) return;
    if (!project) return;

    const payload = {
      name: form.name.trim(),
      client_name: form.client_name.trim() || null,
      client_email: form.client_email.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,

      location: form.location.trim() || null,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      completion_date: form.completion_date || null,

      primary_contact_name: form.primary_contact_name.trim() || null,
      primary_contact_email: form.primary_contact_email.trim() || null,
      primary_contact_phone: form.primary_contact_phone.trim() || null,
    };

    const key = stableStringify(payload);

    if (!lastSavedKeyRef.current) {
      lastSavedKeyRef.current = key;
      return;
    }

    if (key === lastSavedKeyRef.current) return;

    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    setSaveState("saving");

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveMutation.mutate(payload, {
        onSuccess: () => {
          lastSavedKeyRef.current = key;
        },
      });
    }, 650);

    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, projectId, project?.id]);

  // ------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------
  async function handleUpload(file: File) {
    if (!projectId) return;

    const { data: authRes, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      toast({ title: "Auth error", description: authErr.message, variant: "destructive" });
      return;
    }
    const uid = authRes.user?.id;
    if (!uid) {
      toast({ title: "Not signed in", description: "Please sign in again.", variant: "destructive" });
      return;
    }

    const bucket = "project-documents";
    const path = `${uid}/${projectId}/${Date.now()}-${file.name}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

    if (upErr) {
      toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
      return;
    }

    const { error: insErr } = await (supabase as any).from("project_documents").insert({
      project_id: projectId,
      owner_id: uid,
      bucket,
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size || null,
    });

    if (insErr) {
      toast({
        title: "Uploaded, but failed to save metadata",
        description: insErr.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Uploaded", description: "Document uploaded and added to the list." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  // ------------------------------------------------------------
  // Document actions
  // ------------------------------------------------------------
  async function renameDocument(doc: DocumentRow) {
    const next = window.prompt("Rename document to:", doc.file_name);
    if (!next) return;

    const trimmed = next.trim();
    if (!trimmed) return;

    const { error } = await (supabase as any).from("project_documents").update({ file_name: trimmed }).eq("id", doc.id);

    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Renamed", description: "Document name updated." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  async function deleteDocument(doc: DocumentRow) {
    const ok = window.confirm(`Delete "${doc.file_name}"? This cannot be undone.`);
    if (!ok) return;

    const { error: rmErr } = await supabase.storage.from(doc.bucket).remove([doc.path]);
    if (rmErr) {
      toast({ title: "Delete failed", description: rmErr.message, variant: "destructive" });
      return;
    }

    const { error: dbErr } = await (supabase as any).from("project_documents").delete().eq("id", doc.id);

    if (dbErr) {
      toast({ title: "Deleted file, but failed to delete record", description: dbErr.message, variant: "destructive" });
      return;
    }

    toast({ title: "Deleted", description: "Document removed." });
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  }

  // ------------------------------------------------------------
  // Loading / error states
  // ------------------------------------------------------------
  if (isLoading) {
    return (
      <AppLayout fullWidth>
        <Card className="p-6">Loading…</Card>
      </AppLayout>
    );
  }

  if (error || !project) {
    return (
      <AppLayout fullWidth>
        <Card className="p-6">
          <div className="text-xl font-semibold">Project not found</div>
          <div className="mt-2 text-sm text-muted-foreground">{String((error as any)?.message ?? "No record returned.")}</div>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate("/projects")}>Back to Projects</Button>
          </div>
        </Card>
      </AppLayout>
    );
  }

  // ------------------------------------------------------------
  // Derived progress (auto)
  // ------------------------------------------------------------
  const docsCount = documents?.length ?? 0;
  const estimateRows = projectId ? readEstimateRows(projectId) : [];
  const proposalStatus = projectId ? readProposalStatus(projectId) : null;

  const documents_progress = computeDocsPct(docsCount);
  const takeoff_progress = 0; // TODO: compute from takeoff items once persisted
  const estimating_progress = computeEstimatingPct(estimateRows);
  const proposal_progress = computeProposalPct(proposalStatus);

  const overall_progress = computeOverallPct(
    documents_progress,
    takeoff_progress,
    estimating_progress,
    proposal_progress
  );

  const recentActivity = projectId ? readActivity(projectId) : [];

  const tabPills = {
    overview: overall_progress,
    documents: documents_progress,
    takeoff: takeoff_progress,
    estimating: estimating_progress,
    proposal: proposal_progress,
    scan: 0,
  } as const;

  return (
    <AppLayout fullWidth>
      <Card className="p-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          {/* Header row */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0">
                  {editingTitle ? (
                    <Input
                      ref={titleInputRef}
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => commitTitle()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitTitle();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingTitle(false);
                          setTitleDraft(form.name);
                        }
                      }}
                      className="h-9 max-w-[520px] text-2xl font-display font-bold tracking-tight"
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-left text-2xl font-display font-bold tracking-tight hover:underline"
                      title="Click to edit project name"
                      onClick={() => {
                        setTitleDraft(form.name);
                        setEditingTitle(true);
                      }}
                    >
                      {form.name}
                    </button>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge>
                    <span>•</span>
                    <span className="truncate">{project.client_name || "No client set"}</span>
                    {saveState === "saving" ? (
                      <>
                        <span>•</span>
                        <span>Saving…</span>
                      </>
                    ) : saveState === "saved" ? (
                      <>
                        <span>•</span>
                        <span>Saved</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <TabsList className="bg-transparent p-0 flex flex-wrap gap-2 mt-3">
                {(Object.keys(tabPills) as TabKey[]).map((k) => (
                  <TabsTrigger key={k} value={k}>
                    <span className="capitalize">{k}</span>
                    {k !== "scan" ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                        {tabPills[k]}%
                      </span>
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/projects")}>Back</Button>
            </div>
          </div>

          {/* Content */}
          <div className="mt-5">
            {/* Overview */}
            <TabsContent value="overview">
              <div className="space-y-6">
                <Card className="p-6">
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="text-xs text-muted-foreground">Client</div>
                          <Input value={form.client_name} onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))} placeholder="Client name" />
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <MapPin className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="text-xs text-muted-foreground">Location</div>
                          <Input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Project location" />
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <DollarSign className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="text-xs text-muted-foreground">Estimated Value</div>
                          <div className="mt-1 text-2xl font-semibold">{formatMoney(project.total_sales)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">(from Estimating total)</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="text-xs text-muted-foreground">Start Date</div>
                          <Input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="text-xs text-muted-foreground">Completion Date</div>
                          <Input type="date" value={form.completion_date} onChange={(e) => setForm((p) => ({ ...p, completion_date: e.target.value }))} />
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <TrendingUp className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <div className="w-full">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground">Overall Progress</div>
                            <div className="text-sm font-medium tabular-nums">{overall_progress}%</div>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={overall_progress} />
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Weighted: docs 20% · takeoff 35% · estimating 30% · proposal 15%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="text-lg font-semibold">Client Contact</div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Name</div>
                      <Input value={form.primary_contact_name} onChange={(e) => setForm((p) => ({ ...p, primary_contact_name: e.target.value }))} placeholder="Contact name" />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Email</div>
                      <Input value={form.primary_contact_email} onChange={(e) => setForm((p) => ({ ...p, primary_contact_email: e.target.value }))} placeholder="name@company.com" />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Contact Number</div>
                      <Input value={form.primary_contact_phone} onChange={(e) => setForm((p) => ({ ...p, primary_contact_phone: e.target.value }))} placeholder="+63 …" />
                    </div>
                  </div>
                </Card>

                <div className="grid gap-4 md:grid-cols-4">
                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Documents</div>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{docsCount}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <ProgressBar value={documents_progress} />
                      <span className="text-sm tabular-nums">{documents_progress}%</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Target docs: {TARGET_DOCS}</div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Takeoff Progress</div>
                      <Ruler className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{takeoff_progress}%</div>
                    <div className="mt-3">
                      <ProgressBar value={takeoff_progress} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Next: compute from takeoff items.</div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">BOQ Completion</div>
                      <Calculator className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{estimating_progress}%</div>
                    <div className="mt-3">
                      <ProgressBar value={estimating_progress} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Target lines: {TARGET_LINES}</div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Proposals</div>
                      <Send className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{proposal_progress}%</div>
                    <div className="mt-3">
                      <ProgressBar value={proposal_progress} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Status: {proposalStatus ?? "—"}</div>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="p-6 lg:col-span-2">
                    <div className="text-lg font-semibold">Project Timeline (Bidding)</div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      Next step: persist bidding milestones in Supabase (currently UI-only).
                    </div>
                  </Card>

                  <Card className="p-6">
                    <div className="text-lg font-semibold">Recent Activity</div>
                    <div className="mt-4 space-y-3">
                      {recentActivity.length ? (
                        recentActivity.slice(0, 8).map((a, idx) => (
                          <div key={`${a.at}-${idx}`} className="text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{a.action}</div>
                                <div className="text-xs text-muted-foreground truncate">{a.actor ?? "Unknown"}</div>
                              </div>
                              <div className="text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(a.at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">No recent activity yet.</div>
                      )}
                    </div>
                  </Card>
                </div>

                <Card className="p-6">
                  <div className="text-lg font-semibold">Internal Notes</div>
                  <div className="mt-3">
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Internal notes…"
                      className="min-h-[120px]"
                    />
                  </div>
                </Card>
              </div>
            </TabsContent>

            {/* Documents */}
            <TabsContent value="documents">
              <div className="space-y-4">
                <div>
                  <div className="text-lg font-semibold">Documents</div>
                  <div className="text-sm text-muted-foreground">
                    Upload plans (PDF). Files are stored in Supabase Storage bucket:
                    <span className="font-semibold"> project-documents</span>.
                  </div>
                </div>

                <Input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />

                <div className="pt-2">
                  <div className="text-sm font-semibold">Uploaded files</div>

                  <div className="mt-3 overflow-auto rounded-xl border border-border">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">File</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Size</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">Uploaded</th>
                          <th className="px-4 py-3 text-xs font-semibold text-muted-foreground text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docsLoading ? (
                          <tr>
                            <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                              Loading documents…
                            </td>
                          </tr>
                        ) : (documents?.length ?? 0) === 0 ? (
                          <tr>
                            <td className="px-4 py-4 text-sm text-muted-foreground" colSpan={4}>
                              No documents uploaded yet.
                            </td>
                          </tr>
                        ) : (
                          documents!.map((doc) => (
                            <tr key={doc.id} className="border-t border-border">
                              <td className="px-4 py-3 font-medium">{doc.file_name}</td>
                              <td className="px-4 py-3 text-muted-foreground">{formatBytes(doc.size_bytes)}</td>
                              <td className="px-4 py-3 text-muted-foreground">{new Date(doc.created_at).toLocaleString()}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" onClick={() => navigate(`/projects/${projectId}/documents/${doc.id}`)}>
                                    Open
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => void renameDocument(doc)}>
                                    Rename
                                  </Button>
                                  <Button variant="destructive" size="sm" onClick={() => void deleteDocument(doc)}>
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground">Open a document to see its pages and rename them.</div>
                </div>
              </div>
            </TabsContent>

            {/* Takeoff */}
            <TabsContent value="takeoff" className="mt-0">
              <div className="-mx-2 sm:-mx-4">
                <div className="h-[calc(100vh-260px)] min-h-[560px] bg-muted/20 rounded-xl border border-border overflow-hidden">
                  <TakeoffWorkspaceContent projectId={projectId!} embedded />
                </div>
              </div>
            </TabsContent>

            {/* Estimating */}
            <TabsContent value="estimating" className="mt-0">
              <div className="-mx-2 sm:-mx-4">
                <div className="h-[calc(100vh-260px)] min-h-[560px] bg-muted/20 rounded-xl border border-border overflow-hidden">
                  <EstimatingWorkspaceContent projectId={projectId!} embedded />
                </div>
              </div>
            </TabsContent>

            {/* Proposal */}
            <TabsContent value="proposal" className="mt-0">
              <div className="-mx-2 sm:-mx-4">
                <div className="h-[calc(100vh-260px)] min-h-[560px] bg-muted/20 rounded-xl border border-border overflow-hidden">
                  <ProposalWorkspaceContent projectId={projectId!} embedded />
                </div>
              </div>
            </TabsContent>

            {/* Scan */}
            <TabsContent value="scan" className="mt-0">
              <div className="-mx-2 sm:-mx-4">
                <div className="h-[calc(100vh-260px)] min-h-[560px] bg-muted/20 rounded-xl border border-border overflow-hidden">
                  <ScanWorkspaceContent projectId={projectId!} embedded />
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </AppLayout>
  );
}
