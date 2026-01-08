-- Billing operations: payments + dunning events

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid null references public.client_invoices(id) on delete set null,
  amount numeric not null default 0,
  currency text not null default 'USD',
  status text not null default 'pending',
  paid_at timestamptz null,
  failure_code text null,
  failure_message text null,
  provider_txn_id text null,
  created_at timestamptz not null default now()
);

create index if not exists client_payments_client_idx on public.client_payments(client_id);
create index if not exists client_payments_invoice_idx on public.client_payments(invoice_id);
create index if not exists client_payments_status_idx on public.client_payments(status);

create table if not exists public.client_dunning_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid null references public.client_invoices(id) on delete set null,
  stage text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists client_dunning_client_idx on public.client_dunning_events(client_id);
create index if not exists client_dunning_invoice_idx on public.client_dunning_events(invoice_id);
create index if not exists client_dunning_stage_idx on public.client_dunning_events(stage);

alter table public.client_payments enable row level security;
alter table public.client_dunning_events enable row level security;

drop policy if exists "client_payments_select_staff" on public.client_payments;
create policy "client_payments_select_staff"
on public.client_payments
for select
using (public.is_app_staff());

drop policy if exists "client_payments_insert_operator" on public.client_payments;
create policy "client_payments_insert_operator"
on public.client_payments
for insert
with check (public.is_app_operator());

drop policy if exists "client_payments_update_operator" on public.client_payments;
create policy "client_payments_update_operator"
on public.client_payments
for update
using (public.is_app_operator())
with check (public.is_app_operator());

drop policy if exists "client_dunning_select_staff" on public.client_dunning_events;
create policy "client_dunning_select_staff"
on public.client_dunning_events
for select
using (public.is_app_staff());

drop policy if exists "client_dunning_insert_operator" on public.client_dunning_events;
create policy "client_dunning_insert_operator"
on public.client_dunning_events
for insert
with check (public.is_app_operator());
