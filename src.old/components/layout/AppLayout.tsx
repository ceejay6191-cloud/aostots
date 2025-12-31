import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogOut, LayoutDashboard, FolderKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type AppLayoutProps = {
  children: ReactNode;
  /** Use a fluid layout with 30px side padding (recommended for Takeoff). */
  fullWidth?: boolean;
  /** Extra classes for the outer wrapper */
  className?: string;
  /** Extra classes for the <main> container */
  mainClassName?: string;
};

export function AppLayout({
  children,
  fullWidth = false,
  className = "",
  mainClassName = "",
}: AppLayoutProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className={`min-h-screen bg-background ${className}`}>
      {/* Top navigation */}
      <header className="border-b bg-white">
        <div
          className={`${
            fullWidth ? "px-[30px]" : "container"
          } mx-auto flex h-14 items-center justify-between`}
        >
          <div className="flex items-center gap-8">
            <Link to="/" className="text-lg font-bold">
              Aostot
            </Link>

            <nav className="flex items-center gap-1">
              <Link to="/">
                <Button variant="ghost" size="sm" className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              <Link to="/projects">
                <Button variant="ghost" size="sm" className="gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Projects
                </Button>
              </Link>
            </nav>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>

      {/* Page content */}
      <main
        className={`${
          fullWidth ? "px-[30px]" : "container"
        } mx-auto py-4 ${mainClassName}`}
      >
        {children}
      </main>
    </div>
  );
}
