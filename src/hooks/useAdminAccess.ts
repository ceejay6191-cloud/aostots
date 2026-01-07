import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchCurrentRole } from "@/services/adminService";
import { AdminRole } from "@/types/admin";
import { isDemoMode } from "@/demo/isDemo";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export function useAdminAccess() {
  const { user } = useAuth();
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemoMode()) {
        if (!cancelled) {
          setRole("owner");
          setLoading(false);
        }
        return;
      }

      if (!user?.id) {
        if (!cancelled) {
          setRole(null);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        const fetchedRole = await fetchCurrentRole(user.id);
        if (!fetchedRole) {
          if (!cancelled) setRole(null);
          return;
        }

        const { data } = await db
          .from("app_users")
          .select("status,approval_status")
          .eq("user_id", user.id)
          .maybeSingle();

        const status = data?.status ?? "active";
        const approval = data?.approval_status ?? "pending";

        if (fetchedRole === "owner" || fetchedRole === "admin") {
          if (!cancelled) setRole(fetchedRole);
          return;
        }

        if (status !== "active" || approval !== "approved") {
          if (!cancelled) setRole(null);
          return;
        }

        if (!cancelled) setRole(fetchedRole);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const permissions = useMemo(() => {
    const canAccess = role !== null;
    const canManageUsers = role === "owner" || role === "admin" || role === "manager";
    const canAssignAdmin = role === "owner";
    const canDelete = role === "owner" || role === "admin";
    const canEditBilling = role === "owner" || role === "admin" || role === "manager";
    return { canAccess, canManageUsers, canAssignAdmin, canDelete, canEditBilling };
  }, [role]);

  return { role, loading, ...permissions };
}
