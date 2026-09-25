-- Inventory: current quantity (authoritative) plus an append-only movement
-- ledger. Current stock is kept in its own table so product metadata edits can
-- never touch it. Only security-definer RPCs write to these tables.

create table public.inventory_stock (
  product_id uuid primary key references public.products (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  delta integer not null check (delta <> 0),
  quantity_after integer not null check (quantity_after >= 0),
  movement_type public.movement_type not null,
  reference_type text check (reference_type in ('order', 'manual')),
  reference_id uuid,
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  note text,
  source text not null default 'admin' check (source in ('admin', 'storefront', 'system')),
  actor_id uuid references auth.users (id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  -- The RPC layer must supply references consistent with the movement type.
  -- A 'return' is recorded manually in v1 (adjust_stock) with no order
  -- reference; a future order-linked return flow may set reference_type='order'.
  constraint inventory_movements_reference_ck check (
    case
      when movement_type in ('sale', 'order_cancel')
        then reference_type = 'order' and reference_id is not null
      when movement_type in ('initial', 'restock', 'adjustment', 'damage', 'loss')
        then reference_id is null
      when movement_type = 'return'
        then reference_id is null or reference_type = 'order'
      else false
    end
  )
);

create index inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_reference_idx on public.inventory_movements (reference_id);
-- A product's opening stock can be initialised at most once.
create unique index inventory_movements_one_initial_idx
  on public.inventory_movements (product_id)
  where movement_type = 'initial';
-- Idempotent mutations (restock/adjust) cannot be applied twice with the same key.
create unique index inventory_movements_idempotency_idx
  on public.inventory_movements (idempotency_key)
  where idempotency_key is not null;
-- A sale can be restocked at most once.
create unique index inventory_movements_one_cancel_idx
  on public.inventory_movements (reference_id, product_id)
  where movement_type = 'order_cancel';

-- Every product gets a stock row automatically, so stock operations never have
-- to handle a missing row.
create or replace function public.init_product_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_stock (product_id, quantity)
  values (new.id, 0)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.init_product_stock() from public;
revoke execute on function public.init_product_stock() from anon;
revoke execute on function public.init_product_stock() from authenticated;

create trigger products_init_stock
  after insert on public.products
  for each row execute function public.init_product_stock();
