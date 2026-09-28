begin;
select plan(4);
select is(1::integer, 1::integer, 'equal integers pass');
select is('a'::text, 'a'::text, 'equal text passes');
select is(1.10::numeric, 1.1::numeric, 'numerics compare by value, not representation');
select is(null::integer, null::integer, 'two nulls are not distinct');
select * from finish();
rollback;
