import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecentProjects } from '@/hooks/useProjects';
import { STATUS_LABELS, STATUS_COLORS, ProjectStatus } from '@/types/project';
import { format } from 'date-fns';
import { ExternalLink, FileQuestion } from 'lucide-react';

export function RecentProjectsTable() {
  const { data: projects, isLoading } = useRecentProjects(5);
  const navigate = useNavigate();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg font-medium">Recent Projects</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
          View all
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Sales</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell className="text-muted-foreground">{project.client_name}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[project.status as ProjectStatus] as any}>
                      {STATUS_LABELS[project.status as ProjectStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Number(project.total_sales))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {format(new Date(project.created_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/projects?highlight=${project.id}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground mb-4">No projects yet</p>
            <Button onClick={() => navigate('/projects/new')}>Create your first project</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
