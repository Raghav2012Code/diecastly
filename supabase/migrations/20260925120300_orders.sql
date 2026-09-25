-- Customers, orders, order items, status history, payments and settings.
--
-- Money model (canonical, no double-counted discounts):
--   line_total  = unit_price * quantity - line_discount      (actual item revenue)
--   line_profit = line_total - (unit_cost * quantity)         (item revenue - item COGS)
--   subtotal    = sum(line_total)                             (net item revenue)
--   total       = subtotal + shipping_fee                     (amount owed)
--   gross profit                      = subtotal - cost_total
--   contribution after shipping       = gross profit + shipping_fee - shipping_cost
--
-- Payment state is NOT stored. It is derived from the payments ledger
-- (see v_order_financials and public.order_financials).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone_normalized text unique,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_email_idx on public.customers (email);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create sequence public.order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  channel public.order_channel not null,
  status public.order_status not null default 'pending',
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,
  shipping_address jsonb,
  payment_method public.payment_method,
  shipping_fee numeric(12, 2) not null default 0 check (shipping_fee >= 0),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  courier text,
  tracking_number text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  cost_total numeric(12, 2) not null default 0 check (cost_total >= 0),
  -- Guest order access requires this unguessable token. Phone/email never authorise access.
  access_token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz,
  idempotency_key text unique,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on public.orders (status);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_customer_id_idx on public.orders (customer_id);
create index orders_idempotency_idx on public.orders (idempotency_key) where idempotency_key is not null;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  -- v1: strictly positive unit price; zero-value lines are not allowed.
  unit_price numeric(12, 2) not null check (unit_price > 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  line_discount numeric(12, 2) not null default 0 check (line_discount >= 0),
  line_total numeric(12, 2)
    generated always as ((unit_price * quantity) - line_discount) stored,
  line_profit numeric(12, 2)
    generated always as (((unit_price - unit_cost) * quantity) - line_discount) stored,
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  note text,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_status_history_order_id_idx on public.order_status_history (order_id);

-- Append-only. Positive amount = received, negative = refund. Single source of
-- truth for payment state.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(12, 2) not null check (amount <> 0),
  method public.payment_method not null,
  provider public.payment_provider not null default 'manual',
  status public.payment_record_status not null default 'received',
  reference text,
  provider_payment_id text,
  provider_order_id text,
  provider_payload jsonb,
  idempotency_key text unique,
  received_at timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments (order_id);
-- Gateway-ready: makes a future webhook idempotent and rejects a different
-- payment that reuses an already-seen provider payment id.
create unique index payments_provider_payment_idx
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- Single row. All durations used by RPCs come from here, never hard-coded.
create table public.settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Diecastly',
  business_phone text,
  business_email text,
  upi_id text,
  upi_qr_path text,
  currency text not null default 'INR',
  cod_enabled boolean not null default true,
  default_shipping_fee numeric(12, 2) not null default 0 check (default_shipping_fee >= 0),
  low_stock_threshold_default integer not null default 2 check (low_stock_threshold_default >= 0),
  order_prefix text not null default 'DC',
  online_order_hold_hours integer not null default 48 check (online_order_hold_hours > 0),
  in_person_reversal_window_hours integer not null default 24
    check (in_person_reversal_window_hours > 0),
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();
