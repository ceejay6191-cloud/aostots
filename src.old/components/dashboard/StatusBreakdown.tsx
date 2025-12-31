import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, ProjectStatus } from '@/types/project';

interface StatusBreakdownProps {
  stats: {
    templates: number;
    estimating: number;
    preliminaries: number;
    accepted: number;
  };
}

export function StatusBreakdown({ stats }: StatusBreakdownProps) {
  const statuses: { key: ProjectStatus; count: number }[] = [
    { key: 'templates', count: stats.templates },
    { key: 'estimating', count: stats.estimating },
    { key: 'preliminaries', count: stats.preliminaries },
    { key: 'accepted', count: stats.accepted },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium">Projects by Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {statuses.map(({ key, count }) => (
            <div key={key} className="flex items-center justify-between">
              <Badge variant={key}>{STATUS_LABELS[key]}</Badge>
              <span className="font-medium tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
