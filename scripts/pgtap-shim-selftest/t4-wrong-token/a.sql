begin;
select plan(1);
select throws_ok($$ select 1/0 $$, '22012', 'this_token_is_not_in_the_message', 'dividing by zero is expected to raise a specific message');
select * from finish();
rollback;
