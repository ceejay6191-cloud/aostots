import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/dashboard/StatCard';
import { StatusBreakdown } from '@/components/dashboard/StatusBreakdown';
import { RecentProjectsTable } from '@/components/dashboard/RecentProjectsTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjectStats } from '@/hooks/useProjects';
import { FolderKanban, DollarSign, Clock, CheckCircle2, Plus, ArrowRight } from 'lucide-react';

export default function Dashboard() {
  const { data: stats, isLoading } = useProjectStats();
  const navigate = useNavigate();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Overview of your estimating activity</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate('/projects')}>
              <ArrowRight className="mr-2 h-4 w-4" />
              Go to Projects
            </Button>
            <Button onClick={() => navigate('/projects/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Projects"
              value={stats.total}
              icon={<FolderKanban className="h-5 w-5 text-primary" />}
              description="All time"
            />
            <StatCard
              title="Total Sales"
              value={formatCurrency(stats.totalSales)}
              icon={<DollarSign className="h-5 w-5 text-accent" />}
              description="Combined value"
              accent
            />
            <StatCard
              title="Estimating"
              value={stats.estimating}
              icon={<Clock className="h-5 w-5 text-status-estimating" />}
              description="In progress"
            />
            <StatCard
              title="Accepted"
              value={stats.accepted}
              icon={<CheckCircle2 className="h-5 w-5 text-status-accepted" />}
              description="Completed"
            />
          </div>
        ) : null}

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentProjectsTable />
          </div>
          <div>
            {isLoading ? (
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
