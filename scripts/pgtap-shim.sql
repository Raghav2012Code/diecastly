-- A minimal pgTAP stand-in, so supabase/tests/*.sql can run under `postgres --single`.
--
-- WHY THIS EXISTS
--
-- pgTAP is the real gate (`npm run test:db` -> `supabase test db`), but it cannot
-- run on this host: it is not bundled with the EDB Windows binaries, no MSYS2
-- package exists, and building it needs an MSVC-compiled server against a
-- UCRT64 gcc. Combined with the fact that every forked backend here dies with
-- STATUS_DLL_INIT_FAILED, that left all eight test files authored and never
-- executed.
--
-- That is not a theoretical gap. `08_money_trust_boundary.sql` declared
-- `plan(21)` while containing 29 assertions, so `finish()` would have aborted
-- the file had it ever run — and nothing noticed, for the entire life of the
-- suite. A test that has never run is not a test.
--
-- So this implements just the pgTAP surface those files actually use, in plain
-- SQL, and runs them for real. Measured across all eight files, that surface is
-- six functions in three shapes:
--
--   is(a, b, description)                            x66
--   lives_ok(sql, description)                       x12
--   throws_ok(sql, errstate, errmsg, description)    x8
--   ok(condition, description)                       x4
--   plan(n) / finish()                               x8 / x8
--
-- WHAT THIS IS NOT
--
-- This is not pgTAP and does not replace it. `supabase test db` remains the real
-- gate. This only proves the assertions execute and that the SQL behaves as
-- they assert, on a host where nothing else can connect. Reports of a green run
-- here must say "under the shim" and never "the pgTAP suite passed".
--
-- HOW FAILURES ARE REPORTED
--
-- Each assertion returns a pgTAP-shaped text row ("ok 3 - ..." / "not ok 3 - ..."),
-- which `--single` echoes, so every failure is visible with its actual and
-- expected values. `finish()` then raises on any failure or on a count that does
-- not match `plan(n)`, which the harness reports as an ERROR and exits non-zero.
-- On full success it returns a summary line that the harness *requires* to be
-- present — so a file that silently dropped its `finish()` fails rather than
-- passing quietly.
--
-- THE BIAS IS DELIBERATE
--
-- `is()` compares with `IS NOT DISTINCT FROM`, never `=`, so `is(NULL, NULL)`
-- cannot pass by accident and `is(NULL, 5)` cannot pass either. Numerics compare
-- by value, so 1.10 and 1.1 are equal as pgTAP intends. Nothing here is
-- deliberately lenient: a shim that reports PASS where pgTAP would report FAIL
-- would make the gate lie, which is the one failure mode this file exists to
-- prevent.

-- State lives in a committed table, not a temp table: the shim is applied in its
-- own session, and each test file then runs `begin; ... rollback;` in another.
-- A temp table would not survive between the two. `plan()` resets it, and the
-- test's own rollback reverts the counters afterwards, so files cannot leak
-- state into each other.
create table if not exists public._pgtap_state (
  id      int primary key default 1,
  planned int not null default 0,
  ran     int not null default 0,
  failed  int not null default 0
);

truncate public._pgtap_state;
insert into public._pgtap_state (id) values (1);

-- One assertion. Returns the line to echo, and records the tally.
create or replace function public._pgtap_tally(p_ok boolean, p_label text)
returns text
language plpgsql
as $$
declare
  v_n int;
begin
  update public._pgtap_state
     set ran = ran + 1,
         failed = failed + (case when p_ok then 0 else 1 end)
   where id = 1
  returning ran into v_n;

  return (case when p_ok then 'ok ' else 'not ok ' end) || v_n || ' - ' || p_label;
end;
$$;

create or replace function public.plan(n int)
returns text
language plpgsql
as $$
begin
  update public._pgtap_state set planned = n, ran = 0, failed = 0 where id = 1;
  return 'plan: ' || n || ' assertions';
end;
$$;

-- `a` and `b` are the same anyelement, so a call mixing incompatible types fails
-- to resolve and errors loudly, which is the safe direction. NULL on either side
-- is never equal to a value.
create or replace function public.is(a anyelement, b anyelement, description text)
returns text
language plpgsql
as $$
begin
  return public._pgtap_tally(
    a is not distinct from b,
    description
      || ' (got ' || coalesce(a::text, 'NULL')
      || ', want ' || coalesce(b::text, 'NULL') || ')'
  );
end;
$$;

-- A NULL condition is a failure, not an error, matching pgTAP.
create or replace function public.ok(condition boolean, description text)
returns text
language plpgsql
as $$
begin
  return public._pgtap_tally(coalesce(condition, false), description);
end;
$$;

create or replace function public.lives_ok(sql text, description text)
returns text
language plpgsql
as $$
begin
  begin
    execute sql;
  exception when others then
    return public._pgtap_tally(
      false,
      description || ' (unexpected ' || sqlstate || ': ' || sqlerrm || ')'
    );
  end;
  return public._pgtap_tally(true, description);
end;
$$;

-- Checks the SQLSTATE *and* that the message carries the expected token. The
-- message check is not redundant: D49 pins every business failure to P0001 and
-- distinguishes them by message text, so matching the state alone would let an
-- assertion pass on the wrong failure.
--
-- A NULL `want_message` means "check the SQLSTATE only", which is what pgTAP
-- does and is the reason this is spelled out rather than left to
-- `position()`: `position(NULL in v_msg)` is NULL, not 0, so a plain
-- `and position(...) > 0` makes the whole conjunction NULL — never true — and a
-- legitimate state-only assertion fails here while passing under real pgTAP.
-- A shim that disagrees with the real gate in EITHER direction makes the gate
-- lie, and this one lied by reporting a false failure.
create or replace function public.throws_ok(
  sql text, want_state text, want_message text, description text
)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return public._pgtap_tally(
      v_state = want_state
        and (want_message is null or position(want_message in v_msg) > 0),
      description
        || ' (got ' || coalesce(v_state, 'no error') || ': ' || coalesce(v_msg, '') || ')'
    );
  end;
  return public._pgtap_tally(
    false,
    description
      || ' (no error raised; expected ' || want_state || ' '
      || coalesce(want_message, '<any message>') || ')'
  );
end;
$$;

-- setof so `select * from finish()` matches how the files call it. Raises on a
-- count mismatch or on any failure, so a broken file is a hard error rather than
-- a summary nobody reads. Returns the summary line only on a clean run.
create or replace function public.finish()
returns setof text
language plpgsql
as $$
declare
  v_planned int;
  v_ran     int;
  v_failed  int;
begin
  select planned, ran, failed
    into v_planned, v_ran, v_failed
    from public._pgtap_state
   where id = 1;

  if v_ran <> v_planned then
    raise exception 'pgTAP shim: planned % assertions but ran %', v_planned, v_ran;
  end if;

  if v_failed > 0 then
    raise exception 'pgTAP shim: % of % assertions failed', v_failed, v_ran;
  end if;

  return query select format(
    'pgtap-shim: %s/%s assertions, 0 failed', v_ran, v_planned
  );
end;
$$;

-- This is a test harness, not application code. The real suite runs as the owner,
-- but be explicit rather than relying on the default privileges clause.
revoke all on public._pgtap_state from public, anon, authenticated;
revoke execute on function public._pgtap_tally(boolean, text) from public, anon, authenticated;
revoke execute on function public.plan(int) from public, anon, authenticated;
revoke execute on function public.is(anyelement, anyelement, text) from public, anon, authenticated;
revoke execute on function public.ok(boolean, text) from public, anon, authenticated;
revoke execute on function public.lives_ok(text, text) from public, anon, authenticated;
revoke execute on function public.throws_ok(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.finish() from public, anon, authenticated;
