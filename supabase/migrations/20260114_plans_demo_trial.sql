-- Enforce two plans + demo trial rule

do $$
declare
  company_plan_id uuid;
  solo_plan_id uuid;
begin
  -- Rename legacy plans to the two allowed names
  update public.plans
  set name = 'Solo License'
  where name in ('Starter','Solo License');

  update public.plans
  set name = 'Company License'
  where name in ('Growth','Enterprise','Company','Company License');

  -- Update pricing for the two plans (keep other fields as-is)
  update public.plans
  set price_monthly = 119,
      price_annual = 1428
  where name = 'Solo License';

  update public.plans
  set price_monthly = 320,
      price_annual = 3840
  where name = 'Company License';

  -- Create plans if missing
  insert into public.plans (name, price_monthly, price_annual, currency, included_seats, usage_limits_json, entitlements_json, overage_rules_json)
  select 'Solo License', 119, 1428, 'USD', 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  where not exists (select 1 from public.plans where name = 'Solo License');

  insert into public.plans (name, price_monthly, price_annual, currency, included_seats, usage_limits_json, entitlements_json, overage_rules_json)
  select 'Company License', 320, 3840, 'USD', 5, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  where not exists (select 1 from public.plans where name = 'Company License');

  -- Remove duplicate rows for the allowed plans (keep one per name)
  with keepers as (
    select distinct on (name) id
    from public.plans
    where name in ('Solo License','Company License')
    order by name, created_at, id
  )
  delete from public.plans
  where name in ('Solo License','Company License')
    and id not in (select id from keepers);

  select id into solo_plan_id from public.plans where name = 'Solo License' limit 1;
  select id into company_plan_id from public.plans where name = 'Company License' limit 1;

  -- Remap subscriptions to allowed plans before cleanup
  update public.org_subscriptions os
  set plan_id = company_plan_id
  where os.plan_id in (
    select p.id from public.plans p
    where p.name not in ('Solo License','Company License')
  );

  -- Remove any other plans
  delete from public.plans
  where name not in ('Solo License','Company License');

  -- Normalize legacy plan names in client_subscriptions
  update public.client_subscriptions
  set plan_name = case
    when plan_name in ('Starter','Solo License') then 'Solo License'
    when plan_name in ('Growth','Enterprise','Company','Company License') then 'Company License'
    else 'Company License'
  end;
end $$;

-- Demo trial rule: when setting demo_7d without explicit expiration, auto-set +7 days
create or replace function public.admin_update_app_user(
  target_user_id uuid,
  new_role public.app_role default null,
  new_status public.app_user_status default null,
  new_approval public.app_approval_status default null,
  new_subscription_period text default null,
  new_subscription_expires_at date default null
)
returns public.app_users
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.app_users;
  after_row public.app_users;
  effective_period text;
  effective_expires date;
begin
  if not public.is_app_operator() then
    raise exception 'Insufficient privileges.';
  end if;

  if new_role in ('owner','admin') and not public.is_app_owner() then
    raise exception 'Only owners can assign admin roles.';
  end if;

  select * into before_row from public.app_users where user_id = target_user_id;
  if not found then
    raise exception 'User not found.';
  end if;

  effective_period := new_subscription_period;
  effective_expires := new_subscription_expires_at;

  if effective_period = 'demo_7d' and effective_expires is null then
    effective_expires := current_date + 7;
  end if;

  if new_approval = 'approved' and before_row.approval_status <> 'approved' then
    if effective_period is null then
      effective_period := coalesce(before_row.subscription_period, 'trial_30d');
    end if;
    if effective_expires is null then
      effective_expires := current_date + 30;
    end if;
  end if;

  update public.app_users
  set role = coalesce(new_role, role),
      status = coalesce(new_status, status),
      approval_status = coalesce(new_approval, approval_status),
      subscription_period = coalesce(effective_period, subscription_period),
      subscription_expires_at = coalesce(effective_expires, subscription_expires_at),
      updated_at = now()
  where user_id = target_user_id
  returning * into after_row;

  if new_role is not null then
    delete from public.user_roles where user_id = target_user_id;
    insert into public.user_roles (user_id, role)
    values (target_user_id, new_role)
    on conflict (user_id, role) do nothing;
  end if;

  perform public.admin_log_action(
    'user_update',
    'app_user',
    target_user_id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_update_app_user(uuid, public.app_role, public.app_user_status, public.app_approval_status, text, date) from public;
grant execute on function public.admin_update_app_user(uuid, public.app_role, public.app_user_status, public.app_approval_status, text, date) to authenticated;
