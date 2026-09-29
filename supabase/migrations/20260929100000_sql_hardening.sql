-- SQL hardening: explicit revokes, a null-safe reference contract, pgTAP lockdown.
--
-- 1. EXPLICIT REVOKES FOR THE FINGERPRINT HELPERS
--
--    order_item_fingerprint and stored_order_item_fingerprint are the only
--    functions in public with no `revoke execute ... from public`. Every other
--    migration states the explicit revoke is mandatory and does it (a new
--    function is executable by PUBLIC by default), and
--    20260925120600_rls_grants.sql pins that with `alter default privileges` —
--    which only binds objects created by ONE role, so anything created outside
--    that path stays open. These two are called only from inside
--    place_online_order, which is security definer: the inner call runs with
--    the definer's rights, so revoking the API roles changes nothing for the
--    application and closes an untested public surface.
--
-- 2. NULL-SAFE REFERENCE CONTRACT
--
--    The inventory_movements CHECK compared `reference_type = 'order'`. When
--    reference_type IS NULL that comparison is NULL, `NULL AND true` is NULL,
--    and a CHECK accepts NULL — so a sale (or return) movement with
--    reference_type = NULL and a non-null reference_id persisted, while
--    database.md claimed violations were "impossible to persist". The branches
--    now use IS NOT DISTINCT FROM, which is null-safe equality: NULL matches
--    nothing, exactly as the documented contract reads.
--
--    Existing rows are validated first: the DO block raises with a count
--    before the old constraint is dropped, so a violating row fails loudly
--    here instead of halfway through the swap.
--
-- 3. PGTAP IN PRODUCTION
--
--    20260925120800 installs pgTAP `with schema extensions` in every
--    environment, and config.toml put `extensions` on the Data API search
--    path — so test helpers like lives_ok(text), which EXECUTES its argument,
--    were anon-reachable. Deleting an applied migration rewrites history, so
--    instead this locks it down uniformly: EXECUTE revoked on every function
--    in the extensions schema (conditional — pgTAP is absent from the
--    single-user harness, which skips 20260925120800), and config.toml no
--    longer exposes `extensions` to the Data API. `supabase test db`
--    connects directly as postgres and is unaffected.

-- ---------------------------------------------------------------------------
-- 1. Fingerprint helpers: API roles lose EXECUTE.
-- ---------------------------------------------------------------------------

revoke execute on function public.order_item_fingerprint(jsonb) from public, anon, authenticated;
revoke execute on function public.stored_order_item_fingerprint(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Null-safe reference CHECK.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad integer;
begin
  -- Rows the new constraint would reject. Must be zero before the swap.
  select count(*) into v_bad
    from public.inventory_movements
   where not (
     case
       when movement_type in ('sale', 'order_cancel')
         then reference_type is not distinct from 'order' and reference_id is not null
       when movement_type in ('initial', 'restock', 'adjustment', 'damage', 'loss')
         then reference_id is null
       when movement_type = 'return'
         then reference_id is null or reference_type is not distinct from 'order'
       else false
     end
   );
  if v_bad > 0 then
    raise exception 'inventory_movements has % row(s) violating the null-safe reference contract', v_bad;
  end if;
end
$$;

alter table public.inventory_movements drop constraint inventory_movements_reference_ck;

alter table public.inventory_movements
  add constraint inventory_movements_reference_ck check (
    case
      when movement_type in ('sale', 'order_cancel')
        then reference_type is not distinct from 'order' and reference_id is not null
      when movement_type in ('initial', 'restock', 'adjustment', 'damage', 'loss')
        then reference_id is null
      when movement_type = 'return'
        then reference_id is null or reference_type is not distinct from 'order'
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 3. pgTAP unreachable through the Data API, everywhere.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    raise notice 'pgtap is not installed in this database; nothing to lock down';
    return;
  end if;
  for r in
    select p.oid::regprocedure as func
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'extensions'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.func);
  end loop;
end
$$;
