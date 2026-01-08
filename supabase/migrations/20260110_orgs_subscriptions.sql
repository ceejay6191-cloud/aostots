-- Organizations + subscriptions + plans (admin module)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_status') then
    create type public.org_status as enum ('active','trialing','suspended','canceled');
  end if;
  if not exists (select 1 from pg_type where typname = 'org_member_role') then
    create type public.org_member_role as enum ('owner','admin','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'subscription_state') then
    create type public.subscription_state as enum ('trialing','active','past_due','canceled','paused');
  end if;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete set null,
  billing_email text null,
  address text null,
  status public.org_status not null default 'trialing',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organizations_status_idx on public.organizations(status);
create index if not exists organizations_created_idx on public.organizations(created_at);

create table if not exists public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists org_memberships_org_idx on public.org_memberships(org_id);
create index if not exists org_memberships_user_idx on public.org_memberships(user_id);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_monthly numeric not null default 0,
  price_annual numeric not null default 0,
  currency text not null default 'USD',
  included_seats int not null default 1,
  usage_limits_json jsonb not null default '{}'::jsonb,
  entitlements_json jsonb not null default '{}'::jsonb,
  overage_rules_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_name_idx on public.plans(name);

create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status public.subscription_state not null default 'trialing',
  billing_cycle text not null default 'monthly',
  trial_end_at date null,
  current_period_start date null,
  current_period_end date null,
  cancel_at_period_end boolean not null default false,
  canceled_at date null,
  mrr numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_subscriptions_org_idx on public.org_subscriptions(org_id);
create index if not exists org_subscriptions_plan_idx on public.org_subscriptions(plan_id);
create index if not exists org_subscriptions_status_idx on public.org_subscriptions(status);

create table if not exists public.org_payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  brand text not null,
  last4 text not null,
  exp_month int not null,
  exp_year int not null,
  status text not null default 'valid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_payment_methods_org_idx on public.org_payment_methods(org_id);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.org_subscriptions(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists subscription_events_org_idx on public.subscription_events(org_id);
create index if not exists subscription_events_sub_idx on public.subscription_events(subscription_id);

-- Updated_at triggers
drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_org_subscriptions_updated_at on public.org_subscriptions;
create trigger trg_org_subscriptions_updated_at
before update on public.org_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_org_payment_methods_updated_at on public.org_payment_methods;
create trigger trg_org_payment_methods_updated_at
before update on public.org_payment_methods
for each row execute function public.set_updated_at();

-- Proration preview (simple server-side estimate)
create or replace function public.admin_preview_proration(
  target_org_id uuid,
  target_plan_id uuid,
  effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_sub public.org_subscriptions;
  current_plan public.plans;
  new_plan public.plans;
  period_start date;
  period_end date;
  total_days numeric;
  remaining_days numeric;
  current_price numeric;
  new_price numeric;
  credit numeric;
  charge numeric;
begin
  if not public.is_app_operator() then
    raise exception 'Insufficient privileges.';
  end if;

  select * into current_sub from public.org_subscriptions where org_id = target_org_id limit 1;
  if not found then
    raise exception 'Subscription not found.';
  end if;

  select * into current_plan from public.plans where id = current_sub.plan_id;
  select * into new_plan from public.plans where id = target_plan_id;

  period_start := coalesce(current_sub.current_period_start, current_date);
  period_end := coalesce(current_sub.current_period_end, current_date + interval '30 days');
  total_days := greatest(1, (period_end - period_start));
  remaining_days := greatest(0, (period_end - effective_date));

  if current_sub.billing_cycle = 'annual' then
    current_price := current_plan.price_annual;
    new_price := new_plan.price_annual;
  else
    current_price := current_plan.price_monthly;
    new_price := new_plan.price_monthly;
  end if;

  credit := round((current_price * (remaining_days / total_days))::numeric, 2);
  charge := round((new_price * (remaining_days / total_days))::numeric, 2);

  return jsonb_build_object(
    'current_plan', current_plan.name,
    'new_plan', new_plan.name,
    'billing_cycle', current_sub.billing_cycle,
    'period_start', period_start,
    'period_end', period_end,
    'effective_date', effective_date,
    'credit', credit,
    'charge', charge,
    'total_due', greatest(charge - credit, 0)
  );
end;
$$;

revoke all on function public.admin_preview_proration(uuid, uuid, date) from public;
grant execute on function public.admin_preview_proration(uuid, uuid, date) to authenticated;

-- RLS
alter table public.organizations enable row level security;
alter table public.org_memberships enable row level security;
alter table public.plans enable row level security;
alter table public.org_subscriptions enable row level security;
alter table public.org_payment_methods enable row level security;
alter table public.subscription_events enable row level security;

drop policy if exists "organizations_select_staff" on public.organizations;
create policy "organizations_select_staff"
on public.organizations
for select
using (public.is_app_staff());

drop policy if exists "organizations_update_operator" on public.organizations;
create policy "organizations_update_operator"
on public.organizations
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "organizations_insert_operator" on public.organizations;
create policy "organizations_insert_operator"
on public.organizations
for insert
with check (public.is_app_operator());

drop policy if exists "org_memberships_select_staff" on public.org_memberships;
create policy "org_memberships_select_staff"
on public.org_memberships
for select
using (public.is_app_staff());

drop policy if exists "org_memberships_update_operator" on public.org_memberships;
create policy "org_memberships_update_operator"
on public.org_memberships
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "org_memberships_insert_operator" on public.org_memberships;
create policy "org_memberships_insert_operator"
on public.org_memberships
for insert
with check (public.is_app_operator());

drop policy if exists "plans_select_staff" on public.plans;
create policy "plans_select_staff"
on public.plans
for select
using (public.is_app_staff());

drop policy if exists "plans_update_operator" on public.plans;
create policy "plans_update_operator"
on public.plans
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "plans_insert_operator" on public.plans;
create policy "plans_insert_operator"
on public.plans
for insert
with check (public.is_app_operator());

drop policy if exists "org_subscriptions_select_staff" on public.org_subscriptions;
create policy "org_subscriptions_select_staff"
on public.org_subscriptions
for select
using (public.is_app_staff());

drop policy if exists "org_subscriptions_update_operator" on public.org_subscriptions;
create policy "org_subscriptions_update_operator"
on public.org_subscriptions
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "org_subscriptions_insert_operator" on public.org_subscriptions;
create policy "org_subscriptions_insert_operator"
on public.org_subscriptions
for insert
with check (public.is_app_operator());

drop policy if exists "org_payment_methods_select_staff" on public.org_payment_methods;
create policy "org_payment_methods_select_staff"
on public.org_payment_methods
for select
using (public.is_app_staff());

drop policy if exists "org_payment_methods_update_operator" on public.org_payment_methods;
create policy "org_payment_methods_update_operator"
on public.org_payment_methods
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "org_payment_methods_insert_operator" on public.org_payment_methods;
create policy "org_payment_methods_insert_operator"
on public.org_payment_methods
for insert
with check (public.is_app_operator());

drop policy if exists "subscription_events_select_staff" on public.subscription_events;
create policy "subscription_events_select_staff"
on public.subscription_events
for select
using (public.is_app_staff());
