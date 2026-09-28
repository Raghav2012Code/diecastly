begin;
select plan(1);
select throws_ok($$ select 1/0 $$, '22012', 'division by zero', 'dividing by zero raises the expected message');
select * from finish();
rollback;
