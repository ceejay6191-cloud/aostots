import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  description?: string;
  className?: string;
  accent?: boolean;
}

export function StatCard({ title, value, icon, description, className, accent }: StatCardProps) {
  return (
    <Card className={cn(
      'overflow-hidden transition-all hover:shadow-md',
      accent && 'gradient-primary text-primary-foreground',
      className
    )}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className={cn(
              'text-sm font-medium',
              accent ? 'text-primary-foreground/80' : 'text-muted-foreground'
            )}>
              {title}
            </p>
            <p className="text-3xl font-display font-bold tracking-tight">{value}</p>
            {description && (
              <p className={cn(
                'text-xs',
                accent ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}>
                {description}
              </p>
            )}
          </div>
          <div className={cn(
            'rounded-lg p-3',
            accent ? 'bg-primary-foreground/10' : 'bg-secondary'
          )}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
