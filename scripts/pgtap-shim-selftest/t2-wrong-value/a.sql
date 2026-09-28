begin;
select plan(1);
select is(2::integer, 3::integer, 'this value is deliberately wrong');
select * from finish();
rollback;
