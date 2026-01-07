-- Extend app_role enum before admin console uses it
do $$
begin
  begin
    alter type public.app_role add value 'manager';
  exception
    when duplicate_object then null;
  end;
  begin
    alter type public.app_role add value 'viewer';
  exception
    when duplicate_object then null;
  end;
end $$;
