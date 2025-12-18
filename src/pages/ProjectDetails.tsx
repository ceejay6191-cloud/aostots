import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_LABELS, type ProjectStatus } from "@/types/project";
import { supabase } from "@/lib/supabaseClient"; // adjust if your client is in a different file

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  estimator_name: string | null;
  notes: string | null;
  status: ProjectStatus;
  total_sales: number | null;
  created_at: string;
};

const TAB_KEYS = ["overview", "documents", "takeoff", "estimating", "proposal"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function ProjectDetails() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();

  const tabFromUrl = (params.get("tab") || "overview").toLowerCase();
  const activeTab: TabKey = (TAB_KEYS.includes(tabFromUrl as TabKey) ? (tabFromUrl as TabKey) : "overview");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState<ProjectRow | null>(null);

  // Editable fields (Overview)
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [estimatorName, setEstimatorName] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("estimating");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!projectId) return;

    (async () => {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("projects")
        .select("id,name,client_name,estimator_name,notes,status,total_sales,created_at")
        .eq("id", projectId)
        .single();

      if (error) {
        setError(error.message);
        setProject(null);
        setLoading(false);
        return;
      }

      setProject(data as ProjectRow);

      // hydrate form fields
      setName(data.name || "");
      setClientName(data.client_name || "");
      setEstimatorName(data.estimator_name || "");
      setStatus(data.status as ProjectStatus);
      setNotes(data.notes || "");

      setLoading(false);
    })();
  }, [projectId]);

  const statusOptions = useMemo(() => {
    return Object.keys(STATUS_LABELS) as ProjectStatus[];
  }, []);

  function setTab(next: TabKey) {
    params.set("tab", next);
    setParams(params, { replace: true });
  }

  async function saveOverview() {
    if (!projectId) return;
    setSaving(true);
    setError(null);

    const { error } = await supabase
      .from("projects")
      .update({
        name: name.trim(),
        client_name: clientName.trim() || null,
        estimator_name: estimatorName.trim() || null,
        status,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    // update local view header too
    setProject((p) =>
      p
        ? {
            ...p,
            name: name.trim(),
            client_name: clientName.trim() || null,
            estimator_name: estimatorName.trim() || null,
            status,
            notes: notes.trim() || null,
          }
        : p
    );

    setSaving(false);
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Project</div>

            {loading ? (
              <div className="text-2xl font-bold">Loading…</div>
            ) : project ? (
              <>
                <div className="text-3xl font-display font-bold tracking-tight">{project.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>Client: {project.client_name || "—"}</span>
                  <span>•</span>
                  <Badge variant="secondary">{STATUS_LABELS[project.status]}</Badge>
                </div>
              </>
            ) : (
              <div className="text-2xl font-bold">Not found</div>
            )}

            {error ? <div className="text-sm text-red-600">{error}</div> : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/projects")}>
              Back to Projects
            </Button>
            <Button onClick={saveOverview} disabled={loading || !project || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="takeoff">Takeoff</TabsTrigger>
            <TabsTrigger value="estimating">Estimating</TabsTrigger>
            <TabsTrigger value="proposal">Proposal</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-6">
            <div className="rounded-2xl border bg-white p-6 space-y-4">
              <div className="text-lg font-semibold">Overview</div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Project Name</div>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Client</div>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Client name"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Estimator</div>
                  <Input
                    value={estimatorName}
                    onChange={(e) => setEstimatorName(e.target.value)}
                    placeholder="Estimator name"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Status</div>
                  <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Notes</div>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes…" />
              </div>
            </div>
          </TabsContent>

          {/* Documents */}
          <TabsContent value="documents" className="space-y-4">
            <div className="rounded-2xl border bg-white p-6 space-y-2">
              <div className="text-lg font-semibold">Documents</div>
              <div className="text-sm text-muted-foreground">
                Upload plans (PDF) here. Next step will be a Supabase Storage bucket + file list per project.
              </div>

              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Placeholder: Drag & drop upload UI goes here.
              </div>
            </div>
          </TabsContent>

          {/* Takeoff */}
          <TabsContent value="takeoff" className="space-y-4">
            <div className="rounded-2xl border bg-white p-6 space-y-2">
              <div className="text-lg font-semibold">Takeoff</div>
              <div className="text-sm text-muted-foreground">
                This will be the takeoff workspace. Measurements saved here should feed the Estimating BOQ.
              </div>

              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Placeholder: PDF viewer + overlay engine goes here.
              </div>
            </div>
          </TabsContent>

          {/* Estimating */}
          <TabsContent value="estimating" className="space-y-4">
            <div className="rounded-2xl border bg-white p-6 space-y-2">
              <div className="text-lg font-semibold">Estimating</div>
              <div className="text-sm text-muted-foreground">
                Excel-like BOQ connected to takeoff quantities. Next step: create `estimate_items` table + editable grid.
              </div>

              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Placeholder: BOQ grid goes here.
              </div>
            </div>
          </TabsContent>

          {/* Proposal */}
          <TabsContent value="proposal" className="space-y-4">
            <div className="rounded-2xl border bg-white p-6 space-y-2">
              <div className="text-lg font-semibold">Proposal</div>
              <div className="text-sm text-muted-foreground">
                Print/export markups and estimating documents. Next step: generate PDF summary from BOQ + markups.
              </div>

              <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Placeholder: Proposal builder + export buttons go here.
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
