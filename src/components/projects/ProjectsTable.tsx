import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects, useUpdateProjectStatus } from '@/hooks/useProjects';
import { STATUS_LABELS, STATUS_COLORS, ProjectStatus, Project } from '@/types/project';
import { format } from 'date-fns';
import { FileQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

interface ProjectsTableProps {
  statusFilter?: ProjectStatus;
}

export function ProjectsTable({ statusFilter }: ProjectsTableProps) {
  const { data: projects, isLoading } = useProjects();
  const updateStatus = useUpdateProjectStatus();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const filteredProjects = statusFilter
    ? projects?.filter((p) => p.status === statusFilter)
    : projects;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const handleStatusChange = (projectId: string, newStatus: ProjectStatus) => {
    updateStatus.mutate({ id: projectId, status: newStatus });
  };

  useEffect(() => {
    if (highlightId) {
      const element = document.getElementById(`project-${highlightId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightId, projects]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!filteredProjects || filteredProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileQuestion className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground mb-4">
          {statusFilter
            ? `No ${STATUS_LABELS[statusFilter].toLowerCase()} projects`
            : 'No projects yet'}
        </p>
        <Button onClick={() => navigate('/projects/new')}>Create a project</Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold">Name</TableHead>
            <TableHead className="font-semibold">Client</TableHead>
            <TableHead className="font-semibold text-right">Total Sales</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
            <TableHead className="font-semibold">Update Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredProjects.map((project) => (
            <TableRow
              key={project.id}
              id={`project-${project.id}`}
              className={cn(
                'transition-colors',
                highlightId === project.id && 'bg-primary/5 animate-pulse'
              )}
            >
              <TableCell className="font-medium">{project.name}</TableCell>
              <TableCell className="text-muted-foreground">{project.client_name}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formatCurrency(Number(project.total_sales))}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_COLORS[project.status as ProjectStatus] as any}>
                  {STATUS_LABELS[project.status as ProjectStatus]}
                </Badge>
              </TableCell>
              <TableCell>
                <Select
                  value={project.status}
                  onValueChange={(value) => handleStatusChange(project.id, value as ProjectStatus)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
