import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import type { Project, ProjectStatus } from '@/types/project';
import { mapLegacyStatusToV2 } from '@/types/project';
import { isDemoMode } from '@/demo/isDemo';
import { demoStore } from '@/demo/store';

/**
 * Projects data hooks
 * - Keeps compatibility with existing pages/components (ProjectsTable, Dashboard, ProjectDetails)
 * - Supports BOTH legacy statuses (templates/estimating/preliminaries/accepted) and
 *   new pipeline statuses (active/bidding/won/lost) via mapLegacyStatusToV2().
 */

export function useProjects() {
  const { user } = useAuth();
  const demo = isDemoMode();

  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      if (!user) return [];

      if (demo) {
        return demoStore.listProjects(user.id);
      }

      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Project[];
    },
    enabled: !!user,
  });
}

export function useProjectStats() {
  const { user } = useAuth();
  const demo = isDemoMode();

  return useQuery({
    queryKey: ['project-stats'],
    queryFn: async () => {
      if (!user) {
        return {
          total: 0,
          totalSales: 0,

          // normalized pipeline buckets
          active: 0,
          bidding: 0,
          won: 0,
          lost: 0,

          // legacy buckets (kept for backward compatibility)
          templates: 0,
          estimating: 0,
          preliminaries: 0,
          accepted: 0,
        };
      }

      if (demo) {
        const projects = demoStore.listProjects(user.id) as Array<Pick<Project, 'status' | 'total_sales'>>;
        return computeStats(projects);
      }

      const { data, error } = await supabase
        .from('projects')
        .select('status,total_sales')
        .eq('owner_id', user.id);

      if (error) throw error;

      const projects = (data || []) as Array<Pick<Project, 'status' | 'total_sales'>>;
      return computeStats(projects);
    },
    enabled: !!user,
  });
}

function computeStats(projects: Array<Pick<Project, 'status' | 'total_sales'>>) {
  const totalSales = projects.reduce((sum, p) => sum + Number(p.total_sales || 0), 0);

  // legacy buckets (if still used anywhere)
  const templates = projects.filter((p) => p.status === 'templates').length;
  const estimating = projects.filter((p) => p.status === 'estimating').length;
  const preliminaries = projects.filter((p) => p.status === 'preliminaries').length;
  const accepted = projects.filter((p) => p.status === 'accepted').length;

  // normalized pipeline buckets
  let active = 0;
  let bidding = 0;
  let won = 0;
  let lost = 0;

  for (const p of projects) {
    const s = mapLegacyStatusToV2(p.status as any);
    if (s === 'active') active++;
    else if (s === 'bidding') bidding++;
    else if (s === 'won') won++;
    else lost++;
  }

  return {
    total: projects.length,
    totalSales,

    active,
    bidding,
    won,
    lost,

    templates,
    estimating,
    preliminaries,
    accepted,
  };
}

export function useRecentProjects(limit: number = 5) {
  const { user } = useAuth();
  const demo = isDemoMode();

  return useQuery({
    queryKey: ['recent-projects', limit],
    queryFn: async () => {
      if (!user) return [];

      if (demo) {
        return demoStore.recentProjects(user.id, limit);
      }

      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as Project[];
    },
    enabled: !!user,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const demo = isDemoMode();

  return useMutation({
    mutationFn: async (project: Omit<Project, 'id' | 'created_at' | 'updated_at' | 'owner_id'>) => {
      if (!user) throw new Error('Not signed in.');

      if (demo) {
        return demoStore.createProject({
          owner_id: user.id,
          name: project.name,
          client_name: project.client_name || 'Client',
          client_email: project.client_email ?? undefined,
          client_phone: project.client_phone ?? undefined,
          status: project.status,
          total_sales: project.total_sales ?? 0,
          estimator_name: project.estimator_name ?? undefined,
          notes: project.notes ?? undefined,
        });
      }

      const { data, error } = await supabase
        .from('projects')
        .insert([{ ...project, owner_id: user.id }])
        .select()
        .single();

      if (error) throw error;
      return data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-projects'] });
      toast({ title: 'Project created', description: 'Your new project has been created successfully.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error?.message ?? 'Unknown error', variant: 'destructive' });
    },
  });
}

export function useUpdateProjectStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const demo = isDemoMode();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProjectStatus }) => {
      if (!user) throw new Error('Not signed in.');

      if (demo) {
        return demoStore.updateStatus(user.id, id, status);
      }

      const { data, error } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', id)
        .eq('owner_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-projects'] });
      toast({ title: 'Status updated', description: 'Project status has been updated.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error?.message ?? 'Unknown error', variant: 'destructive' });
    },
  });
}

export function useProject(id?: string) {
  const { user } = useAuth();
  const demo = isDemoMode();

  return useQuery({
    queryKey: ['project', id],
    enabled: !!id && (!!user || demo),
    queryFn: async () => {
      if (!id) throw new Error('Missing project id');

      if (demo && user) {
        const p = demoStore.getProject(user.id, id);
        if (!p) throw new Error('Project not found');
        return p as Project;
      }

      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Project;
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const demo = isDemoMode();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<
        Pick<
          Project,
          'name' | 'client_name' | 'client_email' | 'client_phone' | 'status' | 'estimator_name' | 'notes' | 'total_sales'
        >
      >;
    }) => {
      if (!user) throw new Error('Not signed in.');

      if (demo) {
        return demoStore.updateProject(user.id, id, patch);
      }

      const { data, error } = await supabase
        .from('projects')
        .update(patch)
        .eq('id', id)
        .eq('owner_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data as Project;
    },
    onSuccess: (updated: Project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', updated.id] });
      toast({ title: 'Saved', description: 'Project updated successfully.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error?.message ?? 'Unknown error', variant: 'destructive' });
    },
  });
}
