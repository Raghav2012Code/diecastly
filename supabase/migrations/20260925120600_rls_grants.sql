-- Row Level Security and least-privilege grants.
--
-- Policy: deny by default. Anything financial or stock-related is
-- RPC-write-only; only pure metadata accepts direct RLS writes.
--
-- Anon has NO base-table privileges at all. It reaches the storefront through
-- definer views and the two storefront RPCs only.

-- ---------------------------------------------------------------------------
-- Start from deny, then grant explicitly
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Metadata tables: direct RLS-guarded reads and writes for admins.
grant select, insert, update, delete on
  public.suppliers,
  public.categories,
  public.products,
  public.product_images,
  public.customers,
  public.settings
to authenticated;

-- Stock, order and payment tables: read-only for admins (all writes via RPC).
grant select on
  public.inventory_stock,
  public.inventory_movements,
  public.orders,
  public.order_items,
  public.order_status_history,
  public.payments
to authenticated;

-- Reporting views for admins.
grant select on
  public.v_product_stock,
  public.v_products_admin,
  public.v_low_stock,
  public.v_order_financials,
  public.v_order_summary,
  public.v_sales_daily,
  public.v_product_profit,
  public.v_customer_summary
to authenticated;

-- Public storefront views (safe columns only).
grant select on
  public.v_categories_public,
  public.v_products_public,
  public.v_public_settings
to anon, authenticated;

-- Defensive: do not auto-expose objects created by future migrations.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

alter table public.admin_users enable row level security;
alter table public.suppliers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payments enable row level security;
alter table public.settings enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Admin users can read only their own membership row. Membership is managed
-- out-of-band (dashboard/CLI/service role), never from the client.
create policy admin_users_select_self on public.admin_users
  for select to authenticated
  using (id = auth.uid());

-- Metadata: full access for admins.
create policy suppliers_admin_all on public.suppliers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_admin_all on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy products_admin_all on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy product_images_admin_all on public.product_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customers_admin_all on public.customers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy settings_admin_all on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Stock, orders and payments: SELECT only. No INSERT/UPDATE/DELETE policy
-- exists, so direct client writes are impossible even for an admin.
create policy inventory_stock_admin_select on public.inventory_stock
  for select to authenticated using (public.is_admin());

create policy inventory_movements_admin_select on public.inventory_movements
  for select to authenticated using (public.is_admin());

create policy orders_admin_select on public.orders
  for select to authenticated using (public.is_admin());

create policy order_items_admin_select on public.order_items
  for select to authenticated using (public.is_admin());

create policy order_status_history_admin_select on public.order_status_history
  for select to authenticated using (public.is_admin());

create policy payments_admin_select on public.payments
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Function execution grants
-- ---------------------------------------------------------------------------

-- Revoke everything first; Supabase grants EXECUTE to PUBLIC by default.
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.init_product_stock() from public, anon, authenticated;
revoke execute on function public.normalize_phone(text) from public, anon, authenticated;
revoke execute on function public.require_admin() from public, anon, authenticated;
revoke execute on function public.next_order_number() from public, anon, authenticated;
revoke execute on function public.apply_stock_delta(uuid, integer) from public, anon, authenticated;
revoke execute on function public.record_movement(
  uuid, integer, integer, public.movement_type, text, uuid, numeric, text, text, text
) from public, anon, authenticated;
revoke execute on function public.order_financials(uuid) from public, anon, authenticated;
revoke execute on function public.order_json(uuid) from public, anon, authenticated;
revoke execute on function public.set_initial_stock(uuid, integer, numeric) from public, anon, authenticated;
revoke execute on function public.restock_product(uuid, integer, numeric, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.adjust_stock(uuid, integer, public.movement_type, text, text) from public, anon, authenticated;
revoke execute on function public.record_in_person_sale(
  jsonb, public.payment_method, jsonb, jsonb, text, text
) from public, anon, authenticated;
revoke execute on function public.place_online_order(
  jsonb, jsonb, public.payment_method, jsonb, text, text
) from public, anon, authenticated;
revoke execute on function public.record_payment(
  uuid, numeric, public.payment_method, text, text
) from public, anon, authenticated;
revoke execute on function public.refund_payment(
  uuid, numeric, public.payment_method, text, text
) from public, anon, authenticated;
revoke execute on function public.update_order_status(
  uuid, public.order_status, text, text, text
) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid, text, boolean, boolean, text) from public, anon, authenticated;
revoke execute on function public.update_order_notes(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_order_by_access(text, uuid) from public, anon, authenticated;

-- RLS policies call is_admin() as the querying role.
grant execute on function public.is_admin() to authenticated;

-- Admin RPCs: authenticated only; each re-checks is_admin() explicitly.
grant execute on function public.set_initial_stock(uuid, integer, numeric) to authenticated;
grant execute on function public.restock_product(uuid, integer, numeric, boolean, text, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, public.movement_type, text, text) to authenticated;
grant execute on function public.record_in_person_sale(
  jsonb, public.payment_method, jsonb, jsonb, text, text
) to authenticated;
grant execute on function public.record_payment(
  uuid, numeric, public.payment_method, text, text
) to authenticated;
grant execute on function public.refund_payment(
  uuid, numeric, public.payment_method, text, text
) to authenticated;
grant execute on function public.update_order_status(
  uuid, public.order_status, text, text, text
) to authenticated;
grant execute on function public.cancel_order(uuid, text, boolean, boolean, text) to authenticated;
grant execute on function public.update_order_notes(uuid, text) to authenticated;

-- Storefront RPCs: callable without authentication.
grant execute on function public.place_online_order(
  jsonb, jsonb, public.payment_method, jsonb, text, text
) to anon, authenticated;
grant execute on function public.get_order_by_access(text, uuid) to anon, authenticated;
