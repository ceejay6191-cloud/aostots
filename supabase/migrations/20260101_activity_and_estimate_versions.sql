-- AOSTOT: Activity feed + estimate (quote) versions for audit trail
-- Run this in Supabase SQL editor OR commit into supabase/migrations.

-- Enable UUID generator
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Project activity feed (audit trail)
-- ------------------------------------------------------------------
create table if not exists public.project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid not null default auth.uid(),
  action text not null,
  entity_type text null,
  entity_id uuid null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_activity_project_id_created_at_idx
  on public.project_activity(project_id, created_at desc);

alter table public.project_activity enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='owner_id'
  ) then
    -- Owner-based policies
    create policy "project_activity_select_own" on public.project_activity
      for select
      using (exists (
        select 1 from public.projects p
        where p.id = project_activity.project_id
          and p.owner_id = auth.uid()
      ));

    create policy "project_activity_insert_own" on public.project_activity
      for insert
      with check (exists (
        select 1 from public.projects p
        where p.id = project_activity.project_id
          and p.owner_id = auth.uid()
      ));
  else
    -- Fallback (if you don't have owner_id, you'll need to adapt to your membership model)
    raise notice 'projects.owner_id not found; please adjust RLS policies for project_activity to your membership model.';
  end if;
exception
  when duplicate_object then
    -- policies already exist
    null;
end $$;

-- ------------------------------------------------------------------
-- Estimate (quote) versions
-- Stores a snapshot of the estimate grid for audit/history.
-- ------------------------------------------------------------------
create table if not exists public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  payload jsonb not null,
  payload_hash text not null,
  note text null,
  subtotal numeric null,
  total numeric null
);

create index if not exists estimate_versions_project_id_created_at_idx
  on public.estimate_versions(project_id, created_at desc);

create unique index if not exists estimate_versions_project_hash_uq
  on public.estimate_versions(project_id, payload_hash);

alter table public.estimate_versions enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='owner_id'
  ) then
    create policy "estimate_versions_select_own" on public.estimate_versions
      for select
      using (exists (
        select 1 from public.projects p
        where p.id = estimate_versions.project_id
          and p.owner_id = auth.uid()
      ));

    create policy "estimate_versions_insert_own" on public.estimate_versions
      for insert
      with check (
        created_by = auth.uid()
        and exists (
          select 1 from public.projects p
          where p.id = estimate_versions.project_id
            and p.owner_id = auth.uid()
        )
      );
  else
    raise notice 'projects.owner_id not found; please adjust RLS policies for estimate_versions to your membership model.';
  end if;
exception
  when duplicate_object then
    null;
end $$;
