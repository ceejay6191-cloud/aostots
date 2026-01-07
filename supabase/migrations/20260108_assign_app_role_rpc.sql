-- Assign app roles by email (owner-only)
create or replace function public.assign_app_role_by_email(target_email text, target_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if target_email is null or length(trim(target_email)) = 0 then
    raise exception 'Email is required.';
  end if;

  if not public.is_app_owner() then
    raise exception 'Only app owners can assign roles.';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'User not found for email %.', target_email;
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user_id, target_role)
  on conflict (user_id, role) do nothing;
end;
$$;

revoke all on function public.assign_app_role_by_email(text, public.app_role) from public;
grant execute on function public.assign_app_role_by_email(text, public.app_role) to authenticated;
