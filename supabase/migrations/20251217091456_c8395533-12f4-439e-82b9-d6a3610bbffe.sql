-- Enable needed extension
create extension if not exists pgcrypto;

-- Project status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum ('templates','estimating','preliminaries','accepted');
  end if;
end $$;

-- Projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  client_name text not null,
  client_email text,
  client_phone text,
  status public.project_status not null default 'estimating',
  total_sales numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.projects enable row level security;

-- Policies (owner-only access)
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects
for select
using (owner_id = auth.uid());

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects
for insert
with check (owner_id = auth.uid());

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects
for delete
using (owner_id = auth.uid());

-- Helpful indexes
create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists projects_status_idx on public.projects(status);
create index if not exists projects_created_at_idx on public.projects(created_at);
