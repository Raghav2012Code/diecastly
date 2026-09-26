-- Supabase shim: the minimum of Supabase's managed surface that the Diecastly
-- migrations and invariant suite depend on, so they can run against a plain
-- PostgreSQL instead of the Supabase stack.
--
-- Needed because the migrations reference:
--   * auth.users          - target of the created_by / recorded_by / actor_id /
--                           changed_by foreign keys
--   * auth.uid()          - read by is_admin() and recorded by every RPC
--   * storage.buckets     - the product-images bucket row
--   * storage.objects     - the subject of the four storage RLS policies
--   * anon / authenticated - named as grantees in the grants migration
--   * the extensions schema - pgtap is installed into it
--
-- This is a test fixture, not production configuration. On a real Supabase
-- project all of this already exists and this file must never be applied.

-- Roles the grants migration grants to. NOLOGIN: they are privilege sets.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

-- The JWT claim set the PostgREST layer would populate. auth.uid() reads it, so
-- a test can simulate a signed-in user with
--   set local request.jwt.claims = '{"sub":"...","role":"authenticated"}';
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'role'
$$;

create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.roles (
  id uuid primary key default gen_random_uuid(),
  role text not null unique
);

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storage_objects_bucket_idx on storage.objects (bucket_id);

alter table storage.objects enable row level security;
