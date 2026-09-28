begin;
select plan(1);
select is(1::integer, 1::integer, 'assertion passes but finish never runs');
rollback;
