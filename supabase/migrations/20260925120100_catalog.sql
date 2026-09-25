-- Catalog: suppliers, categories, products and product images.
-- These tables hold metadata only. Stock lives in inventory_stock and is
-- never represented here. Historical order lines snapshot product data.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories (id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_parent_id_idx on public.categories (parent_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  brand text,
  model text,
  series text,
  category_id uuid references public.categories (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  description text,
  sku text unique,
  barcode text unique,
  purchase_cost numeric(12, 2) not null default 0 check (purchase_cost >= 0),
  selling_price numeric(12, 2) not null default 0 check (selling_price >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  status public.product_status not null default 'draft',
  is_featured boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_status_idx on public.products (status);
create index products_category_id_idx on public.products (category_id);
create index products_supplier_id_idx on public.products (supplier_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id);
-- At most one primary image per product.
create unique index product_images_one_primary_idx
  on public.product_images (product_id)
  where is_primary;

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
