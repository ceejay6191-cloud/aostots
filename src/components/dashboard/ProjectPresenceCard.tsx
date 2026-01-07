import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/useProjects";
import { useProjectsPresence } from "@/hooks/useProjectPresence";

export function ProjectPresenceCard() {
  const { data: projects = [], isLoading } = useProjects();
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const presenceByProject = useProjectsPresence(projectIds);

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="text-sm font-semibold">Online now</div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Online now</div>
        <div className="text-xs text-muted-foreground">By project</div>
      </div>
      <div className="mt-3 space-y-2">
        {projects.length === 0 ? (
          <div className="text-sm text-muted-foreground">No projects yet.</div>
        ) : (
          projects.map((project) => {
            const users = presenceByProject[project.id] ?? {};
            const list = Object.values(users);
            return (
              <div key={project.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {list.length ? `${list.length} online` : "No one online"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {list.slice(0, 4).map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex h-2.5 w-2.5 rounded-full border border-white"
                      style={{ backgroundColor: u.color }}
                      title={u.name}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
