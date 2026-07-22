-- 014: registry audit triggers on Cloud SQL (ported from Supabase).
--
-- The Supabase original read the acting user's email from request.jwt.claims.
-- On Cloud SQL the API sets app.user_email via set_config(..., true) inside
-- the update transaction (see PUT /api/organizations/:id in
-- server-registry-routes.js); fall back to 'system'.

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_organization_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
declare
  v_user text;
  v_diff jsonb;
begin
  v_user := coalesce(
    nullif(current_setting('app.user_email', true), ''),
    'system'
  );

  select jsonb_object_agg(
    key,
    jsonb_build_object('old', old_val, 'new', new_val)
  )
  into v_diff
  from (
    select n.key, n.value as new_val, o.value as old_val
    from jsonb_each(to_jsonb(NEW)) n
    join jsonb_each(to_jsonb(OLD)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at')
  ) changes;

  if v_diff is null or v_diff = '{}'::jsonb then
    return NEW;
  end if;

  insert into public.organization_changes (org_id, changed_by, before, after, diff)
  values (NEW.id, v_user, to_jsonb(OLD), to_jsonb(NEW), v_diff);

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS organizations_audit ON public.organizations;
CREATE TRIGGER organizations_audit
  AFTER UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.log_organization_change();

-- organization_changes needs inserts from the trigger regardless of API user.
GRANT INSERT ON public.organization_changes TO africastn_app;
