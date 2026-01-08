-- Add org_memberships -> app_users FK for PostgREST relationship

alter table public.org_memberships
  add constraint org_memberships_user_id_app_users_fkey
  foreign key (user_id) references public.app_users(user_id)
  on delete cascade;