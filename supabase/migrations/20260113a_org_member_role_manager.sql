-- Add manager role to org_member_role enum

do $$
begin
  begin
    alter type public.org_member_role add value 'manager';
  exception
    when duplicate_object then null;
  end;
end $$;