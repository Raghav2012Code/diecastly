-- Customer archive state.
--
-- Customers could previously only be created (at checkout, by the sale RPCs)
-- and read back; there was no way for an admin to edit or retire one. Products
-- are archived through their `status` enum and suppliers through `is_active`;
-- customers are the third metadata entity and take the same boolean shape as
-- suppliers, because a customer has no draft/published lifecycle.
--
-- `is_active` is additive and defaults true, so every existing row and every
-- checkout upsert is unaffected. The column is guarded with IF NOT EXISTS so a
-- concurrent migration that adds the same archive flag does not fail here.
--
-- `v_customer_summary` exposes the flag so the admin list can filter and badge
-- it. The column is appended LAST: CREATE OR REPLACE VIEW only permits an added
-- column at the end, and putting it anywhere else is rejected.

alter table public.customers
  add column if not exists is_active boolean not null default true;

create index if not exists customers_is_active_idx on public.customers (is_active);

create or replace view public.v_customer_summary
with (security_invoker = true)
as
select
  c.id as customer_id,
  c.name,
  c.phone_normalized,
  c.email,
  count(o.id)::integer as orders_count,
  coalesce(
    sum(case when o.status not in ('cancelled', 'returned') then o.total else 0 end),
    0
  )::numeric(12, 2) as total_spent,
  max(o.created_at) as last_order_at,
  c.is_active
from public.customers c
left join public.orders o on o.customer_id = c.id
group by c.id;
