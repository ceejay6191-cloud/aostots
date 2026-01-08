-- Fix admin_notes author relationship to app_users

alter table public.admin_notes
  drop constraint if exists admin_notes_created_by_fkey;

alter table public.admin_notes
  alter column created_by drop not null;

alter table public.admin_notes
  add constraint admin_notes_created_by_app_users_fkey
  foreign key (created_by) references public.app_users(user_id)
  on delete set null;