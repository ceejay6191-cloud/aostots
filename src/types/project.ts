export type ProjectStatus = 'templates' | 'estimating' | 'preliminaries' | 'accepted';

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  status: ProjectStatus;
  total_sales: number;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  templates: 'Templates',
  estimating: 'Estimating',
  preliminaries: 'Preliminaries',
  accepted: 'Accepted',
};

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  templates: 'templates',
  estimating: 'estimating',
  preliminaries: 'preliminaries',
  accepted: 'accepted',
};
