-- Company + user management (multi-company, approvals, roles)
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner','admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'company_role') then
    create type public.company_role as enum ('owner','admin','manager','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('pending','active','blocked');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles(user_id);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  join_code text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (join_code)
);

create index if not exists companies_owner_id_idx on public.companies(owner_id);
create index if not exists companies_created_at_idx on public.companies(created_at);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null default 'member',
  status public.membership_status not null default 'pending',
  created_by uuid not null default auth.uid(),
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists company_memberships_company_idx on public.company_memberships(company_id);
create index if not exists company_memberships_user_idx on public.company_memberships(user_id);
create index if not exists company_memberships_status_idx on public.company_memberships(status);

-- Updated_at trigger reuse
drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists trg_company_memberships_updated_at on public.company_memberships;
create trigger trg_company_memberships_updated_at
before update on public.company_memberships
for each row execute function public.set_updated_at();

create or replace function public.is_app_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('owner','admin')
  );
$$;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'owner'
  );
$$;

create or replace function public.is_company_member(cid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = cid and m.user_id = auth.uid() and m.status = 'active'
  ) or public.is_app_admin();
$$;

create or replace function public.is_company_admin(cid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.company_memberships m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner','admin','manager')
  ) or public.is_app_admin();
$$;

create or replace function public.find_company_by_join_code(code text)
returns table (id uuid, name text)
language sql
stable
security definer
as $$
  select c.id, c.name from public.companies c
  where c.join_code = code
  limit 1;
$$;

-- Auto-create owner membership on company creation
create or replace function public.handle_company_owner_membership()
returns trigger
language plpgsql
as $$
begin
  insert into public.company_memberships(company_id, user_id, role, status, created_by, approved_by, approved_at)
  values (new.id, new.owner_id, 'owner', 'active', new.owner_id, new.owner_id, now())
  on conflict (company_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_company_owner_membership on public.companies;
create trigger trg_company_owner_membership
after insert on public.companies
for each row execute function public.handle_company_owner_membership();

-- Add company_id to projects for shared access
alter table public.projects
  add column if not exists company_id uuid null references public.companies(id) on delete set null;

create index if not exists projects_company_id_idx on public.projects(company_id);

-- RLS
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member"
on public.companies
for select
using (
  owner_id = auth.uid()
  or public.is_company_member(id)
  or public.is_app_admin()
);

drop policy if exists "companies_insert_owner" on public.companies;
create policy "companies_insert_owner"
on public.companies
for insert
with check (owner_id = auth.uid());

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin"
on public.companies
for update
using (public.is_company_admin(id))
with check (public.is_company_admin(id));

drop policy if exists "companies_delete_owner" on public.companies;
create policy "companies_delete_owner"
on public.companies
for delete
using (owner_id = auth.uid() or public.is_app_admin());

drop policy if exists "company_memberships_select_member" on public.company_memberships;
create policy "company_memberships_select_member"
on public.company_memberships
for select
using (
  user_id = auth.uid()
  or public.is_company_member(company_id)
  or public.is_app_admin()
);

drop policy if exists "company_memberships_insert_member" on public.company_memberships;
create policy "company_memberships_insert_member"
on public.company_memberships
for insert
with check (
  (user_id = auth.uid() and status = 'pending' and role = 'member')
  or public.is_company_admin(company_id)
);

drop policy if exists "company_memberships_update_admin" on public.company_memberships;
create policy "company_memberships_update_admin"
on public.company_memberships
for update
using (
  public.is_company_admin(company_id)
  or user_id = auth.uid()
)
with check (
  public.is_company_admin(company_id)
  or user_id = auth.uid()
);

drop policy if exists "company_memberships_delete_admin" on public.company_memberships;
create policy "company_memberships_delete_admin"
on public.company_memberships
for delete
using (
  public.is_company_admin(company_id)
  or user_id = auth.uid()
);

drop policy if exists "user_roles_select_self" on public.user_roles;
create policy "user_roles_select_self"
on public.user_roles
for select
using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "user_roles_insert_owner" on public.user_roles;
create policy "user_roles_insert_owner"
on public.user_roles
for insert
with check (public.is_app_owner());

drop policy if exists "user_roles_update_owner" on public.user_roles;
create policy "user_roles_update_owner"
on public.user_roles
for update
using (public.is_app_owner())
with check (public.is_app_owner());

-- Update projects policies for company access
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects
for select
using (
  owner_id = auth.uid()
  or (company_id is not null and public.is_company_member(company_id))
  or public.is_app_admin()
);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects
for insert
with check (
  owner_id = auth.uid()
  and (company_id is null or public.is_company_admin(company_id) or public.is_app_admin())
);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects
for update
using (
  owner_id = auth.uid()
  or (company_id is not null and public.is_company_admin(company_id))
  or public.is_app_admin()
)
with check (
  owner_id = auth.uid()
  or (company_id is not null and public.is_company_admin(company_id))
  or public.is_app_admin()
);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects
for delete
using (
  owner_id = auth.uid()
  or (company_id is not null and public.is_company_admin(company_id))
  or public.is_app_admin()
);

-- Update activity/estimate version policies to use company access
drop policy if exists "project_activity_select_own" on public.project_activity;
create policy "project_activity_select_own"
on public.project_activity
for select
using (
  exists (
    select 1 from public.projects p
    where p.id = project_activity.project_id
      and (
        p.owner_id = auth.uid()
        or (p.company_id is not null and public.is_company_member(p.company_id))
        or public.is_app_admin()
      )
  )
);

drop policy if exists "project_activity_insert_own" on public.project_activity;
create policy "project_activity_insert_own"
on public.project_activity
for insert
with check (
  exists (
    select 1 from public.projects p
    where p.id = project_activity.project_id
      and (
        p.owner_id = auth.uid()
        or (p.company_id is not null and public.is_company_member(p.company_id))
        or public.is_app_admin()
      )
  )
);

drop policy if exists "estimate_versions_select_own" on public.estimate_versions;
create policy "estimate_versions_select_own"
on public.estimate_versions
for select
using (
  exists (
    select 1 from public.projects p
    where p.id = estimate_versions.project_id
      and (
        p.owner_id = auth.uid()
        or (p.company_id is not null and public.is_company_member(p.company_id))
        or public.is_app_admin()
      )
  )
);

drop policy if exists "estimate_versions_insert_own" on public.estimate_versions;
create policy "estimate_versions_insert_own"
on public.estimate_versions
for insert
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = estimate_versions.project_id
      and (
        p.owner_id = auth.uid()
        or (p.company_id is not null and public.is_company_member(p.company_id))
        or public.is_app_admin()
      )
  )
);
