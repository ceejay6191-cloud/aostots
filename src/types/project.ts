export type ProjectStatusLegacy = 'templates' | 'estimating' | 'preliminaries' | 'accepted';
export type ProjectStatusV2 = 'active' | 'bidding' | 'won' | 'lost';
export type ProjectStatus = ProjectStatusLegacy | ProjectStatusV2;

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
  estimator_name?: string | null;
  notes?: string | null;
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  bidding: 'Bidding',
  won: 'Won',
  lost: 'Lost',
};

// Used by badge styling in the app (tailwind variants mapped elsewhere)
export const STATUS_COLORS: Record<ProjectStatus, string> = {
  active: 'active',
  bidding: 'bidding',
  won: 'won',
  lost: 'lost',
};

// Normalize any legacy status into the current funnel buckets.
export function normalizePipelineStatus(status: ProjectStatus | string): 'active' | 'bidding' | 'won' | 'lost' {
  switch (status) {
    case 'active':
    case 'bidding':
    case 'won':
    case 'lost':
      return status;
    // legacy mapping
  }
}
export function mapLegacyStatusToV2(status: string | null | undefined): ProjectStatusV2 {
  const s = (status ?? "").toLowerCase();

  // v2 passthrough
  if (s === "active") return "active";
  if (s === "bidding") return "bidding";
  if (s === "won") return "won";
  if (s === "lost") return "lost";

  // legacy -> v2
  if (s === "templates") return "active";
  if (s === "estimating") return "bidding";
  if (s === "preliminaries") return "bidding";
  if (s === "accepted") return "won";

  // fallback
  return "bidding";
}
