begin;
select plan(2);
select is(null::integer, 5::integer, 'null is not distinct from five is FALSE');
select ok(false, 'a false condition is a failure');
select * from finish();
rollback;
