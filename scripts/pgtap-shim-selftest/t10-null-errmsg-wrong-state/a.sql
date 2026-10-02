begin;
-- The counterweight to t9. Relaxing throws_ok for a NULL errmsg must NOT turn it
-- into a check that accepts any error at all: the SQLSTATE is still compared.
-- This is the assertion that would fail if someone "simplified" the null case
-- away by skipping the comparison entirely rather than by skipping only the
-- message comparison.
select plan(1);
select throws_ok($$ select 1/0 $$, 'P0001', null, 'a null errmsg still rejects the wrong SQLSTATE');
select * from finish();
rollback;
