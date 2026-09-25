-- Foundation: enumerated types, admin identity, and shared helper functions.
-- Diecastly v1 is single-business, single-location, single-admin. No tenant
-- or organization abstractions exist by design.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.product_status as enum ('draft', 'active', 'archived');

create type public.order_channel as enum ('in_person', 'online');

create type public.order_status as enum (
  'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'completed', 'cancelled', 'returned'
);

create type public.payment_method as enum (
  'cash', 'upi', 'cod', 'card', 'bank_transfer', 'other'
);

create type public.payment_provider as enum ('manual', 'razorpay', 'stripe');

create type public.payment_record_status as enum (
  'pending', 'authorized', 'received', 'failed', 'refunded'
);

create type public.movement_type as enum (
  'initial', 'restock', 'sale', 'order_cancel', 'adjustment', 'damage', 'loss', 'return'
);

-- ---------------------------------------------------------------------------
-- Admin membership. A membership table (not a boolean), so adding a second
-- admin later requires only a row, never a schema change.
-- ---------------------------------------------------------------------------

create table public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- ---------------------------------------------------------------------------
-- is_admin(): the authorization primitive used by every RLS policy and RPC.
-- SECURITY DEFINER so it can read admin_users without recursing into RLS,
-- with an explicit empty search_path to prevent hijacking.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where id = auth.uid()
      and is_active
  );
$$;

revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;
