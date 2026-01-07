import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatusBreakdown } from "@/components/dashboard/StatusBreakdown";
import { RecentProjectsTable } from "@/components/dashboard/RecentProjectsTable";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { PipelineInsights } from "@/components/dashboard/PipelineInsights";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ProjectPresenceCard } from "@/components/dashboard/ProjectPresenceCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import { FolderKanban, DollarSign, Clock, CheckCircle2, XCircle, Plus } from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useProjectStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const navigate = useNavigate();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const loading = statsLoading || projectsLoading || !stats;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Portfolio snapshot, pipeline signals, and operational alerts.
            </p>
          </div>
          <Button onClick={() => navigate("/projects/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Stat cards (keep the previous visual style) */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard
              title="Total Projects"
              value={stats.total}
              icon={<FolderKanban className="h-5 w-5 text-primary" />}
            />
            <StatCard
              title="Total Value"
              value={formatCurrency(stats.totalSales)}
              icon={<DollarSign className="h-5 w-5 text-primary" />}
            />
            <StatCard
              title="Bidding"
              value={stats.bidding ?? stats.estimating + stats.preliminaries}
              icon={<Clock className="h-5 w-5 text-primary" />}
            />
            <StatCard
              title="Won"
              value={stats.won ?? stats.accepted}
              icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
            />
            <StatCard
              title="Lost"
              value={stats.lost ?? 0}
              icon={<XCircle className="h-5 w-5 text-primary" />}
            />
          </div>
        )}

        {/* Charts row (interactive) */}
        <DashboardCharts />

        {/* Insights + Alerts */}
        {projectsLoading ? (
          <Skeleton className="h-52 w-full rounded-xl" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <PipelineInsights projects={projects} />
            <AlertsPanel projects={projects} />
          </div>
        )}

        {/* Bottom grid: recent projects + status + activity */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <RecentProjectsTable />
            <ActivityFeed />
          </div>
          <div className="space-y-4">
            <ProjectPresenceCard />
            {loading ? (
              <Skeleton className="h-64" />
            ) : stats ? (
              <StatusBreakdown stats={stats} />
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
