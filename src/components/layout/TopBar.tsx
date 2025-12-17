import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, LayoutDashboard, FolderKanban } from 'lucide-react';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/projects', label: 'Projects', icon: FolderKanban },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="font-display text-xl font-bold text-foreground hover:text-primary transition-colors"
          >
            Aostot
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <Button
                  key={item.path}
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => navigate(item.path)}
                  className="gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <span className="hidden sm:block text-sm text-muted-foreground">
              {user.email}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
