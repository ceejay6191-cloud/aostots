import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const TABS = ["overview", "documents", "takeoff", "estimating", "proposal"] as const;

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");

  // If no id in URL, go back to projects
  if (!id) return <Navigate to="/projects" replace />;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-muted-foreground">
              <Link to="/projects" className="hover:underline">
                Projects
              </Link>{" "}
              <span className="mx-1">/</span>
              <span className="text-foreground font-semibold">Project</span>
            </div>

            <h1 className="text-3xl font-display font-bold tracking-tight">
              Project
            </h1>

            <p className="text-muted-foreground mt-1">
              Project ID: <span className="font-mono">{id}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/projects">Back to Projects</Link>
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="mb-6">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {titleCase(t)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <div className="rounded-2xl border bg-card p-6">
              <div className="text-lg font-semibold">Overview</div>
              <p className="text-muted-foreground mt-2">
                Next: load project record from Supabase and allow editing (client, estimator, status, notes).
              </p>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <div className="rounded-2xl border bg-card p-6">
              <div className="text-lg font-semibold">Documents</div>
              <p className="text-muted-foreground mt-2">
                Next: upload plans to Supabase Storage and list revisions per project.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="takeoff" className="mt-0">
            <div className="rounded-2xl border bg-card p-6">
              <div className="text-lg font-semibold">Takeoff</div>
              <p className="text-muted-foreground mt-2">
                Next: takeoff canvas (PDF viewer + overlay) and save quantities linked to estimating.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="estimating" className="mt-0">
            <div className="rounded-2xl border bg-card p-6">
              <div className="text-lg font-semibold">Estimating</div>
              <p className="text-muted-foreground mt-2">
                Next: spreadsheet-like estimate table connected to takeoff objects.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="proposal" className="mt-0">
            <div className="rounded-2xl border bg-card p-6">
              <div className="text-lg font-semibold">Proposal</div>
              <p className="text-muted-foreground mt-2">
                Next: generate printable proposal + markups + estimate summary.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

export type ProjectStatus = 'templates' | 'estimating' | 'preliminaries' | 'accepted';

export interface Project {
  id: string;
  name: string;
  client_name: string;
  client_email?: string;
  client_phone?: string;
  total_sales: number;
  status: ProjectStatus;
  owner_id: string;
  created_at: string;
  updated_at: string;

  // NEW
  estimator_name?: string | null;
  notes?: string | null;
}
