-- Project status v2: Active | Bidding | Won | Lost
-- Run this in Supabase SQL Editor OR add to your migrations.
-- This assumes `public.projects.status` currently uses enum `public.project_status`
-- with values: templates | estimating | preliminaries | accepted

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_status_v2') then
    create type public.project_status_v2 as enum ('active','bidding','won','lost');
  end if;
end$$;

-- Convert column type using a mapping
alter table public.projects
  alter column status drop default;

alter table public.projects
  alter column status type public.project_status_v2
  using (
    case (status::text)
      when 'accepted' then 'won'::public.project_status_v2
      when 'estimating' then 'bidding'::public.project_status_v2
      when 'preliminaries' then 'bidding'::public.project_status_v2
      when 'templates' then 'active'::public.project_status_v2
      when 'active' then 'active'::public.project_status_v2
      when 'bidding' then 'bidding'::public.project_status_v2
      when 'won' then 'won'::public.project_status_v2
      when 'lost' then 'lost'::public.project_status_v2
      else 'active'::public.project_status_v2
    end
  );

alter table public.projects
  alter column status set default 'bidding';

-- Replace old enum name with the new one
do $$
begin
  if exists (select 1 from pg_type where typname = 'project_status') then
    drop type public.project_status;
  end if;
end$$;

alter type public.project_status_v2 rename to project_status;
