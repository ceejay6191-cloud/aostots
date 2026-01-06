-- Assemblies + cost catalog

create table if not exists public.cost_items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  code text null,
  name text not null,
  uom text not null default 'ea',
  unit_cost numeric not null default 0,
  category text null,
  vendor text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_items_project_idx on public.cost_items(project_id);
create index if not exists cost_items_name_idx on public.cost_items(name);

create table if not exists public.assemblies (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  code text null,
  name text not null,
  description text null,
  uom text not null default 'ea',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assemblies_project_idx on public.assemblies(project_id);
create index if not exists assemblies_name_idx on public.assemblies(name);

create table if not exists public.assembly_items (
  id uuid primary key default uuid_generate_v4(),
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  cost_item_id uuid not null references public.cost_items(id) on delete restrict,
  qty numeric not null default 1,
  unit_cost_override numeric null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assembly_items_unique unique (assembly_id, cost_item_id)
);

create index if not exists assembly_items_assembly_idx on public.assembly_items(assembly_id);
create index if not exists assembly_items_cost_idx on public.assembly_items(cost_item_id);

create table if not exists public.estimate_row_assemblies (
  id uuid primary key default uuid_generate_v4(),
  estimate_row_id uuid not null references public.estimate_rows(id) on delete cascade,
  assembly_id uuid null references public.assemblies(id) on delete set null,
  quantity_factor numeric not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_row_assemblies_row_idx on public.estimate_row_assemblies(estimate_row_id);
