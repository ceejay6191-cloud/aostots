-- Company plan access control + admin plan updates

alter table public.companies
  add column if not exists plan_name text not null default 'Company License';

alter table public.companies
  add column if not exists plan_expires_at date null;

alter table public.companies
  drop constraint if exists companies_plan_name_check;

alter table public.companies
  add constraint companies_plan_name_check
  check (plan_name in ('Solo License','Company License'));

create or replace function public.is_company_plan_active(cid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.companies c
    where c.id = cid
      and c.plan_name = 'Company License'
      and (c.plan_expires_at is null or c.plan_expires_at >= current_date)
  );
$$;

create or replace function public.admin_update_company_plan(
  target_company_id uuid,
  new_plan_name text,
  new_plan_expires_at date default null
)
returns public.companies
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.companies;
  after_row public.companies;
  normalized_plan text;
begin
  if not public.is_app_admin() then
    raise exception 'Only app admins can update company plans.';
  end if;

  if new_plan_name is null or length(trim(new_plan_name)) = 0 then
    raise exception 'Plan name is required.';
  end if;

  normalized_plan := trim(new_plan_name);
  if normalized_plan not in ('Solo License','Company License') then
    raise exception 'Invalid plan name.';
  end if;

  select * into before_row from public.companies where id = target_company_id;
  if not found then
    raise exception 'Company not found.';
  end if;

  update public.companies
  set plan_name = normalized_plan,
      plan_expires_at = new_plan_expires_at,
      updated_at = now()
  where id = target_company_id
  returning * into after_row;

  perform public.admin_log_action(
    'company_plan_update',
    'company',
    target_company_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_update_company_plan(uuid, text, date) from public;
grant execute on function public.admin_update_company_plan(uuid, text, date) to authenticated;

-- Update project access policies to require Company License for shared access

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects
for select
using (
  owner_id = auth.uid()
  or (
    company_id is not null
    and public.is_company_member(company_id)
    and public.is_company_plan_active(company_id)
  )
  or public.is_app_admin()
);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects
for insert
with check (
  owner_id = auth.uid()
  and (
    company_id is null
    or (
      public.is_company_admin(company_id)
      and public.is_company_plan_active(company_id)
    )
    or public.is_app_admin()
  )
);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects
for update
using (
  owner_id = auth.uid()
  or (
    company_id is not null
    and public.is_company_admin(company_id)
    and public.is_company_plan_active(company_id)
  )
  or public.is_app_admin()
)
with check (
  owner_id = auth.uid()
  or (
    company_id is not null
    and public.is_company_admin(company_id)
    and public.is_company_plan_active(company_id)
  )
  or public.is_app_admin()
);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects
for delete
using (
  owner_id = auth.uid()
  or (
    company_id is not null
    and public.is_company_admin(company_id)
    and public.is_company_plan_active(company_id)
  )
  or public.is_app_admin()
);

-- Update activity/estimate policies to enforce Company License on shared access

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
        or (
          p.company_id is not null
          and public.is_company_member(p.company_id)
          and public.is_company_plan_active(p.company_id)
        )
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
        or (
          p.company_id is not null
          and public.is_company_member(p.company_id)
          and public.is_company_plan_active(p.company_id)
        )
        or public.is_app_admin()
      )
  )
);

-- Estimate versions

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
        or (
          p.company_id is not null
          and public.is_company_member(p.company_id)
          and public.is_company_plan_active(p.company_id)
        )
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
        or (
          p.company_id is not null
          and public.is_company_member(p.company_id)
          and public.is_company_plan_active(p.company_id)
        )
        or public.is_app_admin()
      )
  )
);
