import type { Project, ProjectStatus } from "@/types/project";

/**
 * Demo-mode local store (no Supabase required).
 * Controlled by VITE_DEMO_MODE=true
 */

type DemoState = {
  projects: Project[];
};

const KEY = "aostot_demo_state_v1";

function nowIso() {
  return new Date().toISOString();
}

function seed(ownerId: string): DemoState {
  const base = (id: string, name: string, status: ProjectStatus, total_sales: number, client_name: string): Project => ({
    id,
    name,
    status,
    total_sales,
    client_name,
    client_email: null,
    client_phone: null,
    owner_id: ownerId,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return {
    projects: [
      base("demo-p1", "Template – Bathroom Reno", "templates", 0, "Demo Client"),
      base("demo-p2", "Smith St Extension", "estimating", 12450, "Valerie Smith"),
      base("demo-p3", "Warehouse Fitout", "preliminaries", 7800, "ACME Logistics"),
      base("demo-p4", "Granny Flat – Stage 2", "accepted", 42650, "Adrian & Co"),
    ],
  };
}

function readState(ownerId: string): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const s = seed(ownerId);
      localStorage.setItem(KEY, JSON.stringify(s));
      return s;
    }
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed?.projects?.length) {
      const s = seed(ownerId);
      localStorage.setItem(KEY, JSON.stringify(s));
      return s;
    }
    return parsed;
  } catch {
    const s = seed(ownerId);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    return s;
  }
}

function writeState(state: DemoState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const demoStore = {
  listProjects(ownerId: string): Project[] {
    const s = readState(ownerId);
    return s.projects.filter(p => p.owner_id === ownerId).sort((a,b) => (a.created_at < b.created_at ? 1 : -1));
  },

  getProjectStats(ownerId: string) {
    const projects = this.listProjects(ownerId);
    const totalSales = projects.reduce((sum, p) => sum + Number(p.total_sales || 0), 0);

    return {
      total: projects.length,
      totalSales,
      templates: projects.filter(p => p.status === "templates").length,
      estimating: projects.filter(p => p.status === "estimating").length,
      preliminaries: projects.filter(p => p.status === "preliminaries").length,
      accepted: projects.filter(p => p.status === "accepted").length,
    };
  },

  recentProjects(ownerId: string, limit = 5): Project[] {
    return this.listProjects(ownerId).slice(0, limit);
  },

  createProject(input: {
    owner_id: string;
    name: string;
    client_name: string;
    client_email?: string;
    client_phone?: string;
    status: ProjectStatus;
    total_sales?: number | null;
  }): Project {
    const s = readState(input.owner_id);

    const p: Project = {
      id: crypto?.randomUUID?.() ?? `demo-${Math.random().toString(16).slice(2)}`,
      name: input.name,
      client_name: input.client_name,
      client_email: input.client_email ?? null,
      client_phone: input.client_phone ?? null,
      status: input.status,
      total_sales: input.total_sales ?? 0,
      owner_id: input.owner_id,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    s.projects.unshift(p);
    writeState(s);
    return p;
  },

  updateStatus(ownerId: string, projectId: string, status: ProjectStatus): Project {
    const s = readState(ownerId);
    const idx = s.projects.findIndex(p => p.id === projectId && p.owner_id === ownerId);
    if (idx === -1) throw new Error("Project not found.");
    s.projects[idx] = { ...s.projects[idx], status, updated_at: nowIso() };
    writeState(s);
    return s.projects[idx];
  },
};
