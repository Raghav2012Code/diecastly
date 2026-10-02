-- Create the single admin user.
--
-- Public sign-up is disabled, and the GoTrue HTTP API is unreachable from this
-- host (TLS is intercepted on ahqdzzwocpabjkpjzqyc.supabase.co), so the user is
-- created with the SQL approach the README documents for Supabase Studio.
--
-- Three parts, and the middle one is the part that is easy to forget:
--
--   auth.users       the account, with a bcrypt hash in the format GoTrue
--                    expects ($2a$, cost 10) so the password actually verifies.
--   auth.identities  the email-provider link. GoTrue signs in through
--                    identities, not users, so a users row on its own produces
--                    "Invalid login credentials" even when the hash is right.
--   admin_users      the project's own table, which is what RLS checks.
--
-- Idempotent: re-running replaces the pair rather than failing on a duplicate
-- email, so this can be re-applied to a fresh database without editing it.

begin;

-- Remove any prior attempt, identities first (FK to users).
delete from auth.identities
 where user_id in (select id from auth.users where email = 'admin@diecastly.test');
delete from public.admin_users
 where id in (select id from auth.users where email = 'admin@diecastly.test');
delete from auth.users where email = 'admin@diecastly.test';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  'admin@diecastly.test',
  extensions.crypt('Diecastly#2026!admin', extensions.gen_salt('bf', 10)),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Admin"}'::jsonb
);

insert into auth.identities (
  id, user_id, provider, provider_id, identity_data,
  created_at, updated_at, last_sign_in_at
)
select
  gen_random_uuid(), u.id, 'email', u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true
  ),
  now(), now(), null
from auth.users u
where u.email = 'admin@diecastly.test';
-- `email` is a GENERATED column (lower(identity_data ->> 'email')), so it is
-- derived above and must NOT be listed in the insert. Naming it raises
-- "cannot insert a non-DEFAULT value into column email" and aborts the whole
-- transaction, taking the users row with it.

insert into public.admin_users (id, email, display_name, is_active)
select id, email, 'Admin', true
from auth.users
where email = 'admin@diecastly.test';

commit;

\echo '--- created:'
select a.email, a.display_name, a.is_active,
       (u.email_confirmed_at is not null) as email_confirmed,
       (select count(*) from auth.identities i where i.user_id = a.id) as identities
  from public.admin_users a
  join auth.users u on u.id = a.id;
