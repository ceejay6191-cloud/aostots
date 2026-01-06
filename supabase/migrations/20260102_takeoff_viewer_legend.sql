-- Takeoff viewer + legend state persistence

create table if not exists public.takeoff_viewer_states (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  owner_id uuid not null,
  page_number int not null default 1,
  rotation int not null default 0,
  ui_zoom numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint takeoff_viewer_states_unique unique (document_id)
);

create index if not exists takeoff_viewer_states_project_idx on public.takeoff_viewer_states(project_id);
create index if not exists takeoff_viewer_states_document_idx on public.takeoff_viewer_states(document_id);

create table if not exists public.takeoff_legend_states (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  page_number int not null,
  owner_id uuid not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint takeoff_legend_states_unique unique (document_id, page_number)
);

create index if not exists takeoff_legend_states_project_idx on public.takeoff_legend_states(project_id);
create index if not exists takeoff_legend_states_document_idx on public.takeoff_legend_states(document_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'takeoff_geometries_item_unique'
  ) then
    alter table public.takeoff_geometries
      add constraint takeoff_geometries_item_unique unique (takeoff_item_id);
  end if;
end $$;
