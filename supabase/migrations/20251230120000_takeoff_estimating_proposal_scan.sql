-- Aostot: Takeoff + Estimating + Proposal + Scan (foundation)
-- Generated: 2025-12-30

-- Extensions
create extension if not exists "uuid-ossp";

-- ----------------------------
-- Takeoff
-- ----------------------------

create table if not exists public.takeoff_layers (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  name text not null,
  default_uom text not null default 'ea',
  kind_constraint text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists takeoff_layers_project_id_idx on public.takeoff_layers(project_id);

create table if not exists public.takeoff_calibrations (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  page_number int null, -- null = document default
  owner_id uuid not null,
  meters_per_doc_px numeric not null,
  display_unit text not null default 'm',
  label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint takeoff_calibrations_unique unique (document_id, page_number)
);

create index if not exists takeoff_calibrations_project_id_idx on public.takeoff_calibrations(project_id);
create index if not exists takeoff_calibrations_document_id_idx on public.takeoff_calibrations(document_id);

create table if not exists public.takeoff_items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  page_number int not null,
  owner_id uuid not null,
  kind text not null, -- count | line | area | measure | auto_count | auto_line | auto_area
  layer_id uuid null references public.takeoff_layers(id) on delete set null,
  name text null,
  quantity numeric null, -- denormalized computed quantity
  uom text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists takeoff_items_project_id_idx on public.takeoff_items(project_id);
create index if not exists takeoff_items_document_page_idx on public.takeoff_items(document_id, page_number);
create index if not exists takeoff_items_layer_idx on public.takeoff_items(layer_id);

create table if not exists public.takeoff_geometries (
  id uuid primary key default uuid_generate_v4(),
  takeoff_item_id uuid not null references public.takeoff_items(id) on delete cascade,
  geom_type text not null, -- point | polyline | polygon
  points jsonb not null, -- [{x,y}, ...] in doc-space
  bbox jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists takeoff_geometries_item_id_idx on public.takeoff_geometries(takeoff_item_id);

-- ----------------------------
-- Estimating
-- ----------------------------

create table if not exists public.estimate_sheets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  name text not null default 'Estimate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_sheets_project_id_idx on public.estimate_sheets(project_id);

create table if not exists public.estimate_rows (
  id uuid primary key default uuid_generate_v4(),
  sheet_id uuid not null references public.estimate_sheets(id) on delete cascade,
  owner_id uuid not null,
  row_index int not null,
  code text null,
  description text not null default '',
  uom text not null default 'ea',
  qty_source text not null default 'manual', -- manual | takeoff
  qty_manual numeric null,
  unit_cost numeric not null default 0,
  markup_pct numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_rows_sheet_idx on public.estimate_rows(sheet_id, row_index);

create table if not exists public.estimate_takeoff_links (
  id uuid primary key default uuid_generate_v4(),
  estimate_row_id uuid not null references public.estimate_rows(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid null,
  layer_id uuid null references public.takeoff_layers(id) on delete set null,
  kind text null,
  aggregation text not null default 'sum', -- sum | count
  created_at timestamptz not null default now()
);

create index if not exists estimate_takeoff_links_row_idx on public.estimate_takeoff_links(estimate_row_id);

-- ----------------------------
-- Proposal
-- ----------------------------

create table if not exists public.proposal_templates (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  name text not null default 'Default Template',
  template_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposal_templates_project_idx on public.proposal_templates(project_id);

create table if not exists public.proposals (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  template_id uuid null references public.proposal_templates(id) on delete set null,
  version int not null default 1,
  status text not null default 'draft', -- draft | sent | accepted | rejected
  snapshot jsonb not null default '{}'::jsonb, -- frozen estimate numbers
  pdf_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposals_project_idx on public.proposals(project_id);

-- ----------------------------
-- Scan (pipeline foundation)
-- ----------------------------

create table if not exists public.scan_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  owner_id uuid not null,
  status text not null default 'queued', -- queued | running | done | failed
  progress numeric not null default 0,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scan_jobs_project_idx on public.scan_jobs(project_id);
create index if not exists scan_jobs_doc_idx on public.scan_jobs(document_id);

create table if not exists public.scan_detections (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references public.scan_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  page_number int not null,
  owner_id uuid not null,
  class text not null, -- door/window/wall/etc
  confidence numeric not null default 0,
  geom jsonb not null default '{}'::jsonb, -- bbox or polygon
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scan_detections_job_idx on public.scan_detections(job_id);
create index if not exists scan_detections_doc_page_idx on public.scan_detections(document_id, page_number);

-- NOTE:
-- RLS policies are not included here because each team’s access model differs (single-owner vs multi-user).
-- If you use RLS today, add policies consistent with your existing `projects` / `project_documents` patterns.
