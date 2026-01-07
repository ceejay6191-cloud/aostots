-- Admin console data model + RLS + RPCs
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_status') then
    create type public.app_user_status as enum ('active','inactive');
  end if;
  if not exists (select 1 from pg_type where typname = 'app_approval_status') then
    create type public.app_approval_status as enum ('pending','approved','rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'client_status') then
    create type public.client_status as enum ('active','inactive');
  end if;
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum ('active','trialing','past_due','canceled');
  end if;
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type public.invoice_status as enum ('draft','open','paid','overdue','void');
  end if;
end $$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_email text not null,
  phone text null,
  status public.client_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_status_idx on public.clients(status);
create index if not exists clients_created_at_idx on public.clients(created_at);

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text null,
  email text not null,
  role public.app_role not null default 'viewer',
  status public.app_user_status not null default 'active',
  approval_status public.app_approval_status not null default 'pending',
  client_id uuid null references public.clients(id) on delete set null,
  subscription_period text null,
  subscription_expires_at date null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists app_users_role_idx on public.app_users(role);
create index if not exists app_users_status_idx on public.app_users(status);
create index if not exists app_users_approval_idx on public.app_users(approval_status);
create index if not exists app_users_client_idx on public.app_users(client_id);

create table if not exists public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  plan_name text not null,
  amount numeric not null default 0,
  currency text not null default 'USD',
  billing_cycle text not null default 'monthly',
  next_due_date date null,
  last_paid_date date null,
  status public.subscription_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_subscriptions_client_idx on public.client_subscriptions(client_id);
create index if not exists client_subscriptions_status_idx on public.client_subscriptions(status);

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_number text not null,
  issue_date date not null,
  due_date date not null,
  amount_due numeric not null default 0,
  amount_paid numeric not null default 0,
  status public.invoice_status not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists client_invoices_client_idx on public.client_invoices(client_id);
create index if not exists client_invoices_status_idx on public.client_invoices(status);
create index if not exists client_invoices_due_idx on public.client_invoices(due_date);

create table if not exists public.reminder_emails (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete set null,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent',
  provider_message_id text null
);

create index if not exists reminder_emails_client_idx on public.reminder_emails(client_id);
create index if not exists reminder_emails_sent_idx on public.reminder_emails(sent_at);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete set null,
  action_type text not null,
  entity_type text not null,
  entity_id uuid null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_actor_idx on public.admin_audit_logs(actor_user_id);
create index if not exists admin_audit_logs_entity_idx on public.admin_audit_logs(entity_type, entity_id);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs(created_at);

create table if not exists public.admin_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Updated_at triggers
drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists trg_client_subscriptions_updated_at on public.client_subscriptions;
create trigger trg_client_subscriptions_updated_at
before update on public.client_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_admin_settings_updated_at on public.admin_settings;
create trigger trg_admin_settings_updated_at
before update on public.admin_settings
for each row execute function public.set_updated_at();

-- App role helpers
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
as $$
  select ur.role
  from public.user_roles ur
  where ur.user_id = auth.uid()
  order by case ur.role
    when 'owner' then 1
    when 'admin' then 2
    when 'manager' then 3
    when 'viewer' then 4
    else 5
  end
  limit 1;
$$;

create or replace function public.is_app_staff()
returns boolean
language sql
stable
as $$
  select public.current_app_role() is not null;
$$;

create or replace function public.is_app_operator()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('owner','admin','manager');
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

-- Auto-create app user record on signup
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.app_users (user_id, full_name, email, role, status, approval_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'viewer',
    'active',
    'pending'
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'viewer')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill existing users into app_users and user_roles
insert into public.app_users (user_id, full_name, email, role, status, approval_status)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email),
  u.email,
  'viewer',
  'active',
  'pending'
from auth.users u
on conflict (user_id) do nothing;

insert into public.user_roles (user_id, role)
select u.id, 'viewer'
from auth.users u
on conflict (user_id, role) do nothing;

-- Align app_users.role with highest role in user_roles
update public.app_users au
set role = ur.role
from (
  select distinct on (user_id) user_id, role
  from public.user_roles
  order by user_id,
    case role
      when 'owner' then 1
      when 'admin' then 2
      when 'manager' then 3
      when 'viewer' then 4
      else 5
    end
) ur
where au.user_id = ur.user_id;

-- Audit logging helper
create or replace function public.admin_log_action(
  action_type text,
  entity_type text,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_operator() then
    raise exception 'Insufficient privileges.';
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,
    action_type,
    entity_type,
    entity_id,
    before_json,
    after_json
  )
  values (
    auth.uid(),
    action_type,
    entity_type,
    entity_id,
    coalesce(before_json, '{}'::jsonb),
    coalesce(after_json, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_log_action(text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.admin_log_action(text, text, uuid, jsonb, jsonb) to authenticated;

-- Admin actions
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

create or replace function public.admin_send_reminder(
  target_client_id uuid,
  reminder_subject text,
  reminder_body text,
  reminder_status text default 'sent'
)
returns public.reminder_emails
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_row public.reminder_emails;
begin
  if not public.is_app_operator() then
    raise exception 'Insufficient privileges.';
  end if;

  insert into public.reminder_emails (
    client_id,
    sender_user_id,
    subject,
    body,
    status
  )
  values (
    target_client_id,
    auth.uid(),
    reminder_subject,
    reminder_body,
    reminder_status
  )
  returning * into new_row;

  perform public.admin_log_action(
    'reminder_sent',
    'client',
    target_client_id,
    '{}'::jsonb,
    to_jsonb(new_row)
  );

  return new_row;
end;
$$;

revoke all on function public.admin_send_reminder(uuid, text, text, text) from public;
grant execute on function public.admin_send_reminder(uuid, text, text, text) to authenticated;

create or replace function public.admin_save_setting(setting_key text, setting_value jsonb)
returns public.admin_settings
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.admin_settings;
  after_row public.admin_settings;
begin
  if not public.is_app_operator() then
    raise exception 'Insufficient privileges.';
  end if;

  select * into before_row from public.admin_settings where admin_settings.setting_key = setting_key;

  insert into public.admin_settings (setting_key, value)
  values (setting_key, setting_value)
  on conflict (setting_key) do update set value = excluded.value, updated_at = now()
  returning * into after_row;

  perform public.admin_log_action(
    'settings_update',
    'admin_settings',
    after_row.id,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_save_setting(text, jsonb) from public;
grant execute on function public.admin_save_setting(text, jsonb) to authenticated;

-- RLS
alter table public.app_users enable row level security;
alter table public.clients enable row level security;
alter table public.client_subscriptions enable row level security;
alter table public.client_invoices enable row level security;
alter table public.reminder_emails enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_settings enable row level security;

drop policy if exists "app_users_select_staff" on public.app_users;
create policy "app_users_select_staff"
on public.app_users
for select
using (
  user_id = auth.uid()
  or public.is_app_staff()
);

drop policy if exists "app_users_update_operator" on public.app_users;
create policy "app_users_update_operator"
on public.app_users
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "clients_select_staff" on public.clients;
create policy "clients_select_staff"
on public.clients
for select
using (public.is_app_staff());

drop policy if exists "clients_update_operator" on public.clients;
create policy "clients_update_operator"
on public.clients
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "clients_insert_operator" on public.clients;
create policy "clients_insert_operator"
on public.clients
for insert
with check (public.is_app_operator());

drop policy if exists "client_subscriptions_select_staff" on public.client_subscriptions;
create policy "client_subscriptions_select_staff"
on public.client_subscriptions
for select
using (public.is_app_staff());

drop policy if exists "client_subscriptions_update_operator" on public.client_subscriptions;
create policy "client_subscriptions_update_operator"
on public.client_subscriptions
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "client_subscriptions_insert_operator" on public.client_subscriptions;
create policy "client_subscriptions_insert_operator"
on public.client_subscriptions
for insert
with check (public.is_app_operator());

drop policy if exists "client_invoices_select_staff" on public.client_invoices;
create policy "client_invoices_select_staff"
on public.client_invoices
for select
using (public.is_app_staff());

drop policy if exists "client_invoices_insert_operator" on public.client_invoices;
create policy "client_invoices_insert_operator"
on public.client_invoices
for insert
with check (public.is_app_operator());

drop policy if exists "reminder_emails_select_staff" on public.reminder_emails;
create policy "reminder_emails_select_staff"
on public.reminder_emails
for select
using (public.is_app_staff());

drop policy if exists "reminder_emails_insert_operator" on public.reminder_emails;
create policy "reminder_emails_insert_operator"
on public.reminder_emails
for insert
with check (public.is_app_operator());

drop policy if exists "admin_audit_logs_select_staff" on public.admin_audit_logs;
create policy "admin_audit_logs_select_staff"
on public.admin_audit_logs
for select
using (public.is_app_staff());

drop policy if exists "admin_settings_select_staff" on public.admin_settings;
create policy "admin_settings_select_staff"
on public.admin_settings
for select
using (public.is_app_staff());

drop policy if exists "admin_settings_update_operator" on public.admin_settings;
create policy "admin_settings_update_operator"
on public.admin_settings
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "admin_settings_insert_operator" on public.admin_settings;
create policy "admin_settings_insert_operator"
on public.admin_settings
for insert
with check (public.is_app_operator());

insert into public.admin_settings (setting_key, value)
values (
  'email_template',
  jsonb_build_object(
    'subject', 'Payment reminder: Invoice due {{due_date}}',
    'body',
    'Hello {{client_name}},\n\nThis is a friendly reminder that your invoice for {{amount_due}} was due on {{due_date}} and is currently {{days_overdue}} days overdue.\n\nYou can complete payment here: {{payment_link}}\n\nIf you have questions, reach out at {{support_email}}.\n\nThank you,\nAOSTOTS Billing'
  )
)
on conflict (setting_key) do nothing;
