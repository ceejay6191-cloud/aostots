import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Boxes, LogOut, Users, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type AppLayoutProps = {
  children: ReactNode;
  /**
   * Use a fluid layout (recommended for Takeoff).
   * When false, uses the default container width.
   */
  fullWidth?: boolean;
  /**
   * Layout mode allows tighter padding for dense tools like Takeoff.
   */
  mode?: "default" | "takeoff";
  /** Extra classes for the outer wrapper */
  className?: string;
  /** Extra classes for the <main> container */
  mainClassName?: string;
};

function NavLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: ReactNode;
}) {
  const loc = useLocation();
  const active = loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));

  return (
    <Link
      to={to}
      className={[
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm",
        active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function AppLayout({
  children,
  fullWidth = false,
  mode = "default",
  className = "",
  mainClassName = "",
}: AppLayoutProps) {
  const { canAccess, loading: adminLoading } = useAdminAccess();

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  const padding = fullWidth ? "px-[30px]" : "container";
  const padTight = mode === "takeoff" ? "py-3" : "py-4";

  return (
    <div className={["min-h-screen bg-background", className].join(" ")}>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className={`${padding} mx-auto flex items-center justify-between py-3`}>
          <div className="flex items-center gap-3">
            <Link to="/" className="font-semibold tracking-tight">
              AOSTOT
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              <NavLink to="/dashboard" label="Dashboard" icon={<LayoutDashboard className="h-4 w-4" />} />
              <NavLink to="/projects" label="Projects" icon={<FolderKanban className="h-4 w-4" />} />
              <NavLink to="/assemblies" label="Assemblies" icon={<Boxes className="h-4 w-4" />} />
              <NavLink to="/companies" label="Teams" icon={<Users className="h-4 w-4" />} />
              {!adminLoading && canAccess ? (
                <NavLink to="/admin/dashboard" label="Admin" icon={<Shield className="h-4 w-4" />} />
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className={`${padding} mx-auto ${padTight} ${mainClassName}`}>{children}</main>
    </div>
  );
}
