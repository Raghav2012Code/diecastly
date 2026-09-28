begin;
select plan(1);
select lives_ok($$ select 1/0 $$, 'this statement cannot succeed');
select * from finish();
rollback;
