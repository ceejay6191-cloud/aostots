import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from './TopBar';
import { Skeleton } from '@/components/ui/skeleton';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card">
          <div className="container h-16 flex items-center">
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <main className="container py-8">
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="container py-8">{children}</main>
    </div>
  );
}
