import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAdminAccess } from "@/hooks/useAdminAccess";

export function AdminRoute({ children }: { children: ReactNode }) {
  const { loading, canAccess } = useAdminAccess();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading admin access...
      </div>
    );
  }

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
