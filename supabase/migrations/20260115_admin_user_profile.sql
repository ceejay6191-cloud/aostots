-- Admin update for app user contact info

create or replace function public.admin_update_app_user_profile(
  target_user_id uuid,
  new_full_name text default null,
  new_email text default null
)
returns public.app_users
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.app_users;
  after_row public.app_users;
begin
  if not public.is_app_admin() then
    raise exception 'Only app admins can update user profiles.';
  end if;

  select * into before_row from public.app_users where user_id = target_user_id;
  if not found then
    raise exception 'User not found.';
  end if;

  update public.app_users
  set full_name = coalesce(new_full_name, full_name),
      email = coalesce(new_email, email),
      updated_at = now()
  where user_id = target_user_id
  returning * into after_row;

  perform public.admin_log_action(
    'user_profile_update',
    'app_user',
    target_user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_update_app_user_profile(uuid, text, text) from public;
grant execute on function public.admin_update_app_user_profile(uuid, text, text) to authenticated;