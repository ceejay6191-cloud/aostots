import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  BarChart3,
  Settings,
  Shield,
  Building2,
  Layers3,
  Package,
} from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";

const navItems = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/organizations", label: "Organizations", icon: Building2 },
  { to: "/admin/teams", label: "Teams", icon: Users },
  { to: "/admin/subscriptions", label: "Subscriptions", icon: Layers3 },
  { to: "/admin/plans", label: "Plans", icon: Package },
  { to: "/admin/billing", label: "Billing", icon: CreditCard },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminLayout() {
  const { role } = useAdminAccess();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-slate-900">AOSTOTS Admin</div>
              <div className="text-xs text-slate-500">Central control for operations & billing</div>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Role: <span className="font-semibold text-slate-900">{role ?? "viewer"}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
        <aside className="rounded-2xl border bg-white p-3 md:w-60">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                    active
                      ? "bg-slate-900 text-white shadow"
                      : "text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
