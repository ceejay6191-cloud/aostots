import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProjectActivityRow = {
  id: string;
  project_id: string;
  actor_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export function useProjectActivity(projectId: string | null | undefined, limit = 25) {
  return useQuery({
    queryKey: ["project-activity", projectId, limit],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) return [] as ProjectActivityRow[];

      const { data, error } = await supabase
        .from("project_activity")
        .select("id,project_id,actor_id,action,entity_type,entity_id,meta,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as ProjectActivityRow[];
    },
  });
}
