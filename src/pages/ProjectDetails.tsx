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
  estimator_name: string | null;
  status: ProjectStatus;
  total_sales: number | null;
  notes: string | null;
  created_at: string;

  // NEW (persisted fields that were resetting)
  location: string | null;
  description: string | null;
  start_date: string | null;       // ISO date string: "YYYY-MM-DD"
  completion_date: string | null;  // ISO date string: "YYYY-MM-DD"

  // If you already added these in DB, keep them here too:
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
      .filter((x) => typeof x?.at === "number" && typeof x?.action === "string")
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

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // ------------------------------------------------------------
  // Project query
  // ------------------------------------------------------------
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(
  "id,name,client_name,client_email,estimator_name,status,total_sales,notes,created_at,location,description,start_date,completion_date,primary_contact_name,primary_contact_email,primary_contact_phone"
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
      const { data, error } = await supabase
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
  estimator_name: "",
  status: "estimating" as ProjectStatus,
  notes: "",

  // NEW
  location: "",
  description: "",
  start_date: "",        // "YYYY-MM-DD"
  completion_date: "",   // "YYYY-MM-DD"

  // Primary contact (if you added them)
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
  // keep draft in sync when project loads
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
  // When switching to another projectId, allow re-init
  didInitFormRef.current = false;
}, [projectId]);

useEffect(() => {
  if (!project) return;
  if (didInitFormRef.current) return;

  setForm({
    name: project.name ?? "",
    client_name: project.client_name ?? "",
    client_email: project.client_email ?? "",
    estimator_name: project.estimator_name ?? "",
    status: project.status ?? "estimating",
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
      const { error } = await supabase.from("projects").update(payload).eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSaveState("saved");
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      await qc.invalidateQueries({ queryKey: ["projects"] });

      // local recent activity (DB-based activity comes later)
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
  estimator_name: form.estimator_name.trim() || null,
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

    const { error: insErr } = await supabase.from("project_documents").insert({
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

    setForm((p) => ({ ...p, documents_progress: Math.max(p.documents_progress, 25) }));
  }

  // ------------------------------------------------------------
  // Document actions
  // ------------------------------------------------------------
  async function renameDocument(doc: DocumentRow) {
    const next = window.prompt("Rename document to:", doc.file_name);
    if (!next) return;

    const trimmed = next.trim();
    if (!trimmed) return;

    const { error } = await supabase.from("project_documents").update({ file_name: trimmed }).eq("id", doc.id);

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

    const { error: dbErr } = await supabase.from("project_documents").delete().eq("id", doc.id);

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

  const docsCount = documents?.length ?? 0;
  const recentActivity = projectId ? readActivity(projectId) : [];

  const tabPills = {
    overview: clampPct(form.overall_progress),
    documents: clampPct(form.documents_progress),
    takeoff: clampPct(form.takeoff_progress),
    estimating: clampPct(form.estimating_progress),
    proposal: clampPct(form.proposal_progress),
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
                {/* Top summary card (matches the design you referenced) */}
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
                            <div className="text-sm font-medium tabular-nums">{clampPct(form.overall_progress)}%</div>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={form.overall_progress} />
                          </div>
                          <div className="mt-2">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              value={form.overall_progress}
                              onChange={(e) => setForm((p) => ({ ...p, overall_progress: clampPct(Number(e.target.value)) }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Primary Contact */}
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

                {/* Summary cards row */}
                <div className="grid gap-4 md:grid-cols-4">
                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Documents</div>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{docsCount}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <ProgressBar value={form.documents_progress} />
                      <span className="text-sm tabular-nums">{clampPct(form.documents_progress)}%</span>
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Takeoff Progress</div>
                      <Ruler className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{clampPct(form.takeoff_progress)}%</div>
                    <div className="mt-3">
                      <ProgressBar value={form.takeoff_progress} />
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">BOQ Completion</div>
                      <Calculator className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{clampPct(form.estimating_progress)}%</div>
                    <div className="mt-3">
                      <ProgressBar value={form.estimating_progress} />
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Proposals</div>
                      <Send className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-3xl font-semibold">{clampPct(form.proposal_progress)}%</div>
                    <div className="mt-3">
                      <ProgressBar value={form.proposal_progress} />
                    </div>
                  </Card>
                </div>

                {/* Timeline + Progress/Activity */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="p-6 lg:col-span-2">
                    <div className="text-lg font-semibold">Project Timeline (Bidding)</div>
                    <div className="mt-4 grid gap-4">
                      {(
                        [
                          ["bid_submission_for_tender", "Submission for Tender"],
                          ["bid_estimation", "Estimation"],
                          ["bid_review", "Review"],
                          ["bid_deadline", "Bidding Deadline"],
                          ["bid_sent_proposal", "Sent Proposal"],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
                          <div>
                            <div className="font-medium">{label}</div>
                            <div className="text-xs text-muted-foreground">Bidding milestone</div>
                          </div>
                          <Input
                            type="date"
                            value={(form as any)[key] as string}
                            onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value } as any))}
                          />
                        </div>
                      ))}
                    </div>
                  </Card>

                  <div className="space-y-4">
                    <Card className="p-6">
                      <div className="text-lg font-semibold">Project Progress</div>
                      <div className="mt-4 space-y-4">
                        {(
                          [
                            ["Documents", form.documents_progress],
                            ["Takeoff", form.takeoff_progress],
                            ["Estimating", form.estimating_progress],
                            ["Proposal", form.proposal_progress],
                          ] as const
                        ).map(([label, v]) => (
                          <div key={label}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{label}</span>
                              <span className="tabular-nums">{clampPct(v)}%</span>
                            </div>
                            <div className="mt-2">
                              <ProgressBar value={v} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setForm((p) => ({ ...p, documents_progress: clampPct(p.documents_progress + 5) }))}
                        >
                          + Docs
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setForm((p) => ({ ...p, overall_progress: clampPct(p.overall_progress + 5) }))}
                        >
                          + Overall
                        </Button>
                      </div>

                      <div className="mt-3 text-xs text-muted-foreground">
                        Next step: make these update automatically from Documents/Takeoff/Estimating/Proposal events.
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
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            pushActivity(projectId!, {
                              at: Date.now(),
                              action: "Manual note",
                              actor: "You",
                            });
                            toast({ title: "Added activity" });
                          }}
                        >
                          Add activity (test)
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Next step: store activity + quote versions in Supabase for audit trail.
                      </div>
                    </Card>
                  </div>
                </div>

                {/* Notes */}
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
