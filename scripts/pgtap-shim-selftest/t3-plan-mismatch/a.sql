begin;
select plan(5);
select is(1::integer, 1::integer, 'only one of five runs');
select * from finish();
rollback;
