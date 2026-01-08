-- Admin control for companies + org member invites

create or replace function public.is_org_operator(target_org_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.org_memberships m
    where m.org_id = target_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','manager')
  ) or public.is_app_admin();
$$;

create or replace function public.admin_create_company_by_email(
  company_name text,
  owner_email text
)
returns public.companies
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  owner_user_id uuid;
  new_company public.companies;
begin
  if not public.is_app_admin() then
    raise exception 'Only app admins can create companies.';
  end if;

  if company_name is null or length(trim(company_name)) = 0 then
    raise exception 'Company name is required.';
  end if;

  select id into owner_user_id
  from auth.users
  where lower(email) = lower(trim(owner_email))
  limit 1;

  if owner_user_id is null then
    raise exception 'Owner not found for email %.', owner_email;
  end if;

  insert into public.companies (name, owner_id)
  values (trim(company_name), owner_user_id)
  returning * into new_company;

  return new_company;
end;
$$;

revoke all on function public.admin_create_company_by_email(text, text) from public;
grant execute on function public.admin_create_company_by_email(text, text) to authenticated;

create or replace function public.invite_company_member_by_email(
  target_company_id uuid,
  target_email text,
  target_role public.company_role default 'member'
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if not public.is_company_admin(target_company_id) then
    raise exception 'Only company admins can invite members.';
  end if;

  if target_email is null or length(trim(target_email)) = 0 then
    raise exception 'Email is required.';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'User not found for email %.', target_email;
  end if;

  insert into public.company_memberships (company_id, user_id, role, status, created_by)
  values (target_company_id, target_user_id, target_role, 'pending', auth.uid())
  on conflict (company_id, user_id) do update
    set role = excluded.role,
        status = excluded.status,
        created_by = excluded.created_by,
        updated_at = now();
end;
$$;

revoke all on function public.invite_company_member_by_email(uuid, text, public.company_role) from public;
grant execute on function public.invite_company_member_by_email(uuid, text, public.company_role) to authenticated;

create or replace function public.admin_create_organization_by_email(
  org_name text,
  owner_email text,
  billing_email text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  owner_user_id uuid;
  new_org public.organizations;
begin
  if not public.is_app_admin() then
    raise exception 'Only app admins can create organizations.';
  end if;

  if org_name is null or length(trim(org_name)) = 0 then
    raise exception 'Organization name is required.';
  end if;

  select id into owner_user_id
  from auth.users
  where lower(email) = lower(trim(owner_email))
  limit 1;

  if owner_user_id is null then
    raise exception 'Owner not found for email %.', owner_email;
  end if;

  insert into public.organizations (name, owner_user_id, billing_email)
  values (trim(org_name), owner_user_id, billing_email)
  returning * into new_org;

  insert into public.org_memberships (org_id, user_id, role)
  values (new_org.id, owner_user_id, 'owner')
  on conflict (org_id, user_id) do nothing;

  return new_org;
end;
$$;

revoke all on function public.admin_create_organization_by_email(text, text, text) from public;
grant execute on function public.admin_create_organization_by_email(text, text, text) to authenticated;

create or replace function public.invite_org_member_by_email(
  target_org_id uuid,
  target_email text,
  target_role public.org_member_role default 'member'
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if not public.is_org_operator(target_org_id) then
    raise exception 'Only org admins can invite members.';
  end if;

  if target_email is null or length(trim(target_email)) = 0 then
    raise exception 'Email is required.';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'User not found for email %.', target_email;
  end if;

  insert into public.org_memberships (org_id, user_id, role)
  values (target_org_id, target_user_id, target_role)
  on conflict (org_id, user_id) do update
    set role = excluded.role;
end;
$$;

revoke all on function public.invite_org_member_by_email(uuid, text, public.org_member_role) from public;
grant execute on function public.invite_org_member_by_email(uuid, text, public.org_member_role) to authenticated;

drop policy if exists "organizations_insert_operator" on public.organizations;
create policy "organizations_insert_admin"
on public.organizations
for insert
with check (public.is_app_admin());

drop policy if exists "org_memberships_insert_operator" on public.org_memberships;
create policy "org_memberships_insert_operator"
on public.org_memberships
for insert
with check (public.is_org_operator(org_id));

drop policy if exists "companies_insert_owner" on public.companies;
create policy "companies_insert_admin"
on public.companies
for insert
with check (public.is_app_admin());
