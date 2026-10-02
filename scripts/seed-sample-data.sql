-- Sample data for a demo database.
--
-- WHY THIS USES THE RPCs RATHER THAN INSERTING ORDERS
--
-- Orders, order_items, payments, order_status_history, inventory_stock and
-- inventory_movements are the ledger lanes. Seeding them with raw INSERTs would
-- produce rows that LOOK right and satisfy none of the invariants the functions
-- exist to protect: no stock decrement, no movement row, no cost snapshot, no
-- status history, and a totals column that does not agree with the lines. It
-- would then be impossible to tell a real bug from a bad seed.
--
-- So every order here is placed through place_online_order / record_in_person_sale
-- and every state change through update_order_status / cancel_order, as an admin.
-- That means the seeded data is, by construction, something the application
-- itself could have produced, and any later anomaly is a genuine defect.
--
-- Metadata (categories, suppliers, products, customers) is the other lane and is
-- written directly, which is exactly how the application writes it.
--
-- Deterministic ids throughout, so re-running targets the same rows. The whole
-- script is one transaction: a failure anywhere leaves the database untouched
-- rather than half-populated.

begin;

-- Every RPC below is `security definer` and calls require_admin(), which reads
-- the JWT rather than the session. `set local` scopes this to the transaction.
-- The subject is looked up rather than pasted in, so this file stays correct on
-- a database where the admin row was recreated with a different id.
-- `set local` cannot take a subquery - it only accepts a literal - so the
-- scoped assignment goes through set_config, whose third argument true is the
-- equivalent of `set local`. The subject is looked up rather than pasted in, so
-- this file stays correct on a database where the admin row was recreated with
-- a different id.
select set_config(
  'request.jwt.claims',
  (select json_build_object('sub', a.id::text, 'role', 'authenticated')::text
     from public.admin_users a
    where a.email = 'admin@diecastly.test'),
  true
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

insert into public.categories (id, name, slug, parent_id, sort_order, is_active) values
  ('40000000-0000-0000-0000-000000000001', 'Hot Wheels',      'hot-wheels',      null, 0, true),
  ('40000000-0000-0000-0000-000000000002', 'Mainline',        'mainline',        '40000000-0000-0000-0000-000000000001', 1, true),
  ('40000000-0000-0000-0000-000000000003', 'Premium',         'premium',         '40000000-0000-0000-0000-000000000001', 2, true),
  ('40000000-0000-0000-0000-000000000004', 'Exotic Diecast',  'exotic-diecast',  '40000000-0000-0000-0000-000000000001', 3, true),
  ('40000000-0000-0000-0000-000000000005', 'Indian Cars',     'indian-cars',     null, 4, true),
  ('40000000-0000-0000-0000-000000000006', 'Loose & Minis',   'loose-and-minis', null, 5, true);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

insert into public.suppliers (id, name, contact_name, phone, email, notes, is_active) values
  ('50000000-0000-0000-0000-000000000001', 'Auto World Traders',        'Rohan Mehta',   '+919810001001', 'sales@autoworld.example',   'Bulk Hot Wheels distributor, Bengaluru.', true),
  ('50000000-0000-0000-0000-000000000002', 'Diecast Imports Pvt Ltd',   'Anita Shah',    '+919810002002', 'orders@diecastimports.example', 'Importer for European brands, Mumbai.', true),
  ('50000000-0000-0000-0000-000000000003', 'Model Wheels & Tyres',      'Vikram Rao',    '+919810003003', 'hello@modelwheels.example', 'Budget Mainline supplier, Pune.', true),
  ('50000000-0000-0000-0000-000000000004', 'Tiny Garage Collectibles',  'Farhan Ali',    '+919810004004', 'stock@tinygarage.example', 'Niche scale models. Currently inactive.', false);

-- ---------------------------------------------------------------------------
-- Products
--
-- Stock is deliberately varied so every branch of the low-stock and reporting
-- views has something to show: healthy lines, two at or below threshold, one
-- at zero, plus a draft and an archived product that must stay out of the
-- storefront. #8 is left at zero and is never ordered, which is what gives the
-- out-of-stock state something real to report.
-- ---------------------------------------------------------------------------

insert into public.products
  (id, name, slug, brand, model, series, category_id, supplier_id, description, sku,
   purchase_cost, selling_price, low_stock_threshold, status, is_featured)
values
  ('30000000-0000-0000-0000-000000000001', 'Toyota GR Supra (2024)', 'toyota-gr-supra-2024', 'Toyota', 'GR Supra', 'Hot Wheels Mainline',
   '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   'JDM-inspired GR Supra in bright orange with opening doors.', 'HW-ML-1001',
   220.00, 349.00, 2, 'active', true),

  ('30000000-0000-0000-0000-000000000002', 'Ford Mustang Mach-E', 'ford-mustang-mach-e', 'Ford', 'Mustang Mach-E', 'Hot Wheels Mainline',
   '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   'Electric muscle car in Grabber Blue.', 'HW-ML-1002',
   250.00, 399.00, 2, 'active', false),

  ('30000000-0000-0000-0000-000000000003', 'Honda Civic Type R FL5', 'honda-civic-type-r-fl5', 'Honda', 'Civic Type R', 'Hot Wheels Mainline',
   '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   'Championship White with the red Honda badge.', 'HW-ML-1003',
   240.00, 385.00, 2, 'active', false),

  ('30000000-0000-0000-0000-000000000004', 'Lamborghini Huracan STO', 'lamborghini-huracan-sto', 'Lamborghini', 'Huracan STO', 'Hot Wheels Premium',
   '40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
   'Matte green with the iconic scissor doors. Low stock.', 'HW-PR-2001',
   480.00, 699.00, 2, 'active', true),

  ('30000000-0000-0000-0000-000000000005', 'BMW M4 Competition', 'bmw-m4-competition', 'BMW', 'M4 Competition', 'Hot Wheels Premium',
   '40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
   'Brooklyn Grey metallic on black wheels.', 'HW-PR-2002',
   520.00, 749.00, 2, 'active', false),

  ('30000000-0000-0000-0000-000000000006', 'Tesla Model 3 Performance', 'tesla-model-3-performance', 'Tesla', 'Model 3', 'Hot Wheels Premium',
   '40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
   'Pearl white with the T logo on the nose.', 'HW-PR-2003',
   300.00, 449.00, 2, 'active', false),

  ('30000000-0000-0000-0000-000000000007', 'Porsche 911 GT3 RS', 'porsche-911-gt3-rs', 'Porsche', '911 GT3 RS', 'Exotic Diecast',
   '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002',
   'GT3 RS in Shark Blue on a collector base.', 'EXC-3001',
   650.00, 899.00, 1, 'active', true),

  ('30000000-0000-0000-0000-000000000008', 'Nissan GT-R NISMO', 'nissan-gt-r-nismo', 'Nissan', 'GT-R NISMO', 'Exotic Diecast',
   '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002',
   'Bayside Blue. Currently out of stock.', 'EXC-3002',
   700.00, 949.00, 1, 'active', false),

  ('30000000-0000-0000-0000-000000000009', 'Rolls-Royce Phantom EWB', 'rolls-royce-phantom-ewb', 'Rolls-Royce', 'Phantom', 'Exotic Diecast',
   '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002',
   'Spirit of Ecstasy in Midnight Sapphire. One only.', 'EXC-3003',
   890.00, 1249.00, 1, 'active', true),

  ('30000000-0000-0000-0000-000000000010', 'Audi RS6 Avant', 'audi-rs6-avant', 'Audi', 'RS6 Avant', 'Exotic Diecast',
   '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002',
   'Nardo Grey wagon, the one everyone actually wants.', 'EXC-3004',
   580.00, 829.00, 1, 'active', false),

  ('30000000-0000-0000-0000-000000000011', 'Maruti Suzuki Baleno', 'maruti-suzuki-baleno', 'Maruti Suzuki', 'Baleno', 'Indian Cars',
   '40000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000003',
   'City car in Metropolis Grey. Our best seller.', 'IN-4001',
   180.00, 289.00, 3, 'active', true),

  ('30000000-0000-0000-0000-000000000012', 'Tata Nexon EV', 'tata-nexon-ev', 'Tata', 'Nexon EV', 'Indian Cars',
   '40000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000003',
   'EV version in Pristine White.', 'IN-4002',
   210.00, 329.00, 3, 'active', false),

  ('30000000-0000-0000-0000-000000000013', 'Mahindra Thar 4x4', 'mahindra-thar-4x4', 'Mahindra', 'Thar', 'Indian Cars',
   '40000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000003',
   'Desert Bronze off-roader. Running low.', 'IN-4003',
   340.00, 499.00, 3, 'active', false),

  ('30000000-0000-0000-0000-000000000014', 'Hot Wheels City Track Set', 'hot-wheels-city-track-set', 'Hot Wheels', 'City Track Set', 'Loose & Minis',
   '40000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000003',
   'Includes two cars and a folding track. Gift-boxed.', 'SET-5001',
   750.00, 1099.00, 1, 'active', true),

  ('30000000-0000-0000-0000-000000000015', 'Jaguar E-Type Coupe', 'jaguar-e-type-coupe', 'Jaguar', 'E-Type', 'Hot Wheels Mainline',
   '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002',
   'Opalesque Gunmetal Grey. Draft, not yet listed.', 'HW-ML-1004',
   310.00, 465.00, 2, 'draft', false),

  ('30000000-0000-0000-0000-000000000016', 'Lada Niva', 'lada-niva', 'Lada', 'Niva', 'Hot Wheels Mainline',
   '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003',
   'Khrushchev Badge. Archived, retained for order history.', 'HW-ML-1005',
   140.00, 219.00, 2, 'archived', false);

-- Opening stock, through the RPC rather than by inserting inventory_stock, so
-- the `initial` movement rows and the quantity_after snapshots exist.
select public.set_initial_stock('30000000-0000-0000-0000-000000000001', 12, 220.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000002',  8, 250.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000003',  4, 240.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000004',  2, 480.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000005',  6, 520.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000006',  5, 300.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000007',  2, 650.00);
-- #8 deliberately left at zero, so the out-of-stock view has a real row.
select public.set_initial_stock('30000000-0000-0000-0000-000000000009',  1, 890.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000010',  3, 580.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000011', 15, 180.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000012',  9, 210.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000013',  2, 340.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000014',  4, 750.00);
select public.set_initial_stock('30000000-0000-0000-0000-000000000016',  5, 140.00);

-- ---------------------------------------------------------------------------
-- Online orders
--
-- Five, so the admin queue has a pending one, a partly-fulfilled run, a
-- delivered one and a cancellation to inspect. Each carries a distinct
-- idempotency key: reusing one raises idempotency_conflict rather than silently
-- replaying someone else's order (D50).
-- ---------------------------------------------------------------------------

select public.place_online_order(
  '[{"productId":"30000000-0000-0000-0000-000000000001","quantity":1},
    {"productId":"30000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb,
  '{"name":"Meera Krishnan","phone":"9876543210","email":"meera@example.com",
    "addressLine1":"42 Brigade Road","addressLine2":"Apt 3B","city":"Bengaluru",
    "state":"KA","postalCode":"560001"}'::jsonb,
  'cod'::public.payment_method,
  '{"line1":"42 Brigade Road","line2":"Apt 3B","city":"Bengaluru","state":"KA",
    "postal_code":"560001","country":"India"}'::jsonb,
  'Please gift wrap.', 'seed-online-1');

select public.place_online_order(
  '[{"productId":"30000000-0000-0000-0000-000000000002","quantity":1},
    {"productId":"30000000-0000-0000-0000-000000000010","quantity":1}]'::jsonb,
  '{"name":"Daniel Fernandes","phone":"9812345678","email":"daniel@example.com",
    "addressLine1":"7 Carter Road","city":"Mumbai","state":"MH","postalCode":"400050"}'::jsonb,
  'upi'::public.payment_method,
  '{"line1":"7 Carter Road","city":"Mumbai","state":"MH","postal_code":"400050",
    "country":"India"}'::jsonb,
  null, 'seed-online-2');

select public.place_online_order(
  '[{"productId":"30000000-0000-0000-0000-000000000003","quantity":1},
    {"productId":"30000000-0000-0000-0000-000000000012","quantity":2}]'::jsonb,
  '{"name":"Sunita Patil","phone":"9900112233","email":"sunita@example.com",
    "addressLine1":"15 Laxmi Road","city":"Pune","state":"MH","postalCode":"411030"}'::jsonb,
  'cod'::public.payment_method,
  '{"line1":"15 Laxmi Road","city":"Pune","state":"MH","postal_code":"411030",
    "country":"India"}'::jsonb,
  'Wrong item received, requesting a cancel.', 'seed-online-3');

select public.place_online_order(
  '[{"productId":"30000000-0000-0000-0000-000000000006","quantity":1},
    {"productId":"30000000-0000-0000-0000-000000000011","quantity":1}]'::jsonb,
  '{"name":"Arjun Nair","phone":"9123456780","email":"arjun@example.com",
    "addressLine1":"88 Marine Drive","city":"Kochi","state":"KL","postalCode":"682031"}'::jsonb,
  'upi'::public.payment_method,
  '{"line1":"88 Marine Drive","city":"Kochi","state":"KL","postal_code":"682031",
    "country":"India"}'::jsonb,
  null, 'seed-online-4');

select public.place_online_order(
  '[{"productId":"30000000-0000-0000-0000-000000000007","quantity":1},
    {"productId":"30000000-0000-0000-0000-000000000013","quantity":1}]'::jsonb,
  '{"name":"Priya Sharma","phone":"9988776655","email":"priya@example.com",
    "addressLine1":"23 Connaught Place","city":"New Delhi","state":"DL","postalCode":"110001"}'::jsonb,
  'cod'::public.payment_method,
  '{"line1":"23 Connaught Place","city":"New Delhi","state":"DL","postal_code":"110001",
    "country":"India"}'::jsonb,
  'Gift message: happy birthday!', 'seed-online-5');

-- Walk two orders forward so the timeline, courier fields and tracking number
-- have something real to render. The transition matrix is enforced in the
-- function, so an illegal step raises rather than producing a nonsense state.
select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-1'),
  'confirmed'::public.order_status, 'Payment method confirmed by phone.');

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-1'),
  'packed'::public.order_status, 'Packed with a note about the gift wrap.');

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-1'),
  'shipped'::public.order_status, 'Handed to courier.', 'Delhivery', 'DL123456789');

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-2'),
  'confirmed'::public.order_status, null);

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-5'),
  'confirmed'::public.order_status, null);

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-5'),
  'packed'::public.order_status, null);

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-5'),
  'shipped'::public.order_status, null, 'BlueDart', 'BD998877665');

select public.update_order_status(
  (select id from public.orders where idempotency_key = 'seed-online-5'),
  'delivered'::public.order_status, 'Delivered, recipient signed.');

-- Cash collected for the two delivered/confirmed orders. Payments are
-- append-only and never change fulfilment status (D33), which is why these run
-- after the status walk rather than as part of it.
select public.record_payment(
  (select id from public.orders where idempotency_key = 'seed-online-2'),
  1228.00, 'upi'::public.payment_method, 'UPI/4412/8821', 'seed-pay-1');

select public.record_payment(
  (select id from public.orders where idempotency_key = 'seed-online-5'),
  1398.00, 'cod'::public.payment_method, 'Collected on delivery', 'seed-pay-2');

-- One cancellation, with the refund recorded and stock returned. This is the
-- path that produces an `order_cancel` movement, so the restock-once index has a
-- real row sitting behind it.
select public.cancel_order(
  (select id from public.orders where idempotency_key = 'seed-online-3'),
  'Customer requested a cancellation within the window.',
  true, true, 'seed-cancel-1');

-- ---------------------------------------------------------------------------
-- In-person sales at the till
--
-- Five, covering the payment shapes the ledger has to handle: fully paid in
-- cash, fully paid by UPI, PARTIALLY paid (so the balance and the partial state
-- are visible), a split tender, and one on account.
-- ---------------------------------------------------------------------------

select public.record_in_person_sale(
  '[{"productId":"30000000-0000-0000-0000-000000000001","quantity":2,"unitPrice":349.00}]'::jsonb,
  'cash'::public.payment_method,
  '[{"amount":698.00,"method":"cash"}]'::jsonb,
  '{"name":"Walk-in customer","phone":"9000000001"}'::jsonb,
  null, 'seed-pos-1');

select public.record_in_person_sale(
  '[{"productId":"30000000-0000-0000-0000-000000000002","quantity":1,"unitPrice":399.00},
    {"productId":"30000000-0000-0000-0000-000000000011","quantity":2,"unitPrice":289.00}]'::jsonb,
  'upi'::public.payment_method,
  '[{"amount":977.00,"method":"upi","reference":"UPI/7788/1122"}]'::jsonb,
  '{"name":"Rahul Verma","phone":"9000000002","email":"rahul@example.com"}'::jsonb,
  'Customer asked for a box.', 'seed-pos-2');

select public.record_in_person_sale(
  '[{"productId":"30000000-0000-0000-0000-000000000005","quantity":2,"unitPrice":749.00}]'::jsonb,
  'card'::public.payment_method,
  '[{"amount":1000.00,"method":"card","reference":"XXXX-4417"}]'::jsonb,
  '{"name":"Corporate order","phone":"9000000003"}'::jsonb,
  'Balance to be settled by bank transfer.', 'seed-pos-3');

select public.record_in_person_sale(
  '[{"productId":"30000000-0000-0000-0000-000000000006","quantity":1,"unitPrice":449.00},
    {"productId":"30000000-0000-0000-0000-000000000014","quantity":1,"unitPrice":1099.00}]'::jsonb,
  'cash'::public.payment_method,
  '[{"amount":800.00,"method":"cash"},{"amount":748.00,"method":"upi","reference":"UPI/2233/4455"}]'::jsonb,
  '{"name":"Kavya Iyer","phone":"9000000004","email":"kavya@example.com"}'::jsonb,
  'Split across cash and UPI.', 'seed-pos-4');

select public.record_in_person_sale(
  '[{"productId":"30000000-0000-0000-0000-000000000009","quantity":1,"unitPrice":1249.00}]'::jsonb,
  'bank_transfer'::public.payment_method,
  null,
  '{"name":"Nikhil Desai","phone":"9000000005","email":"nikhil@example.com"}'::jsonb,
  'Collector item. Payment promised by Friday.', 'seed-pos-5');

-- Settle the partial POS sale so a `received` payment and a zero balance exist
-- alongside the genuinely unpaid one above.
select public.record_payment(
  (select id from public.orders where idempotency_key = 'seed-pos-3'),
  498.00, 'bank_transfer'::public.payment_method, 'NEFT/5566/7788', 'seed-pay-3');

-- ---------------------------------------------------------------------------
-- Extra customers
--
-- The sale RPCs created customers by phone. These two exist so the customer
-- screens have something the RPCs did not produce: one with no orders at all,
-- and one ARCHIVED, which is what exercises the is_active filter, the archived
-- badge and the till picker refusing a retired record.
-- ---------------------------------------------------------------------------

insert into public.customers (name, phone_normalized, email, city, state, country, notes, is_active)
select 'Walk-in enquiry', public.normalize_phone('9000000099'), 'enquiry@example.com',
       'Bengaluru', 'KA', 'India', 'Asked for a bulk quote on Mainline. No order yet.', true
where not exists (select 1 from public.customers where phone_normalized = public.normalize_phone('9000000099'));

insert into public.customers (name, phone_normalized, email, city, state, country, notes, is_active)
select 'Retired customer', public.normalize_phone('9000000088'), 'old@example.com',
       'Hyderabad', 'TG', 'India', 'Moved abroad. Archived rather than deleted so order history keeps its link.', false
where not exists (select 1 from public.customers where phone_normalized = public.normalize_phone('9000000088'));

commit;
