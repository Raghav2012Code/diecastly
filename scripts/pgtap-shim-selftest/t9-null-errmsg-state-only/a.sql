begin;
-- A NULL errmsg means "check the SQLSTATE only", which is pgTAP's behaviour.
-- The shim used to evaluate position(NULL in msg) > 0, which is NULL rather than
-- true, so this legitimate state-only assertion failed here while passing under
-- real pgTAP. Caught by supabase/tests/10 asserting a 23505 with no message.
select plan(1);
select throws_ok($$ select 1/0 $$, '22012', null, 'a null errmsg checks the SQLSTATE alone');
select * from finish();
rollback;
