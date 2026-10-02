-- Realistic trading history: customers, ~220 orders across 100 days, then a
-- backdating pass. Run AFTER scripts/seed-realistic.sql, which supplies the
-- catalogue and the opening stock.
--
-- WHY ONE TRANSACTION
--
-- Phases D and E must not be separable. The order loop records the timestamp
-- each order was *meant* to have in a temp table, and Phase E applies those
-- timestamps to the orders and everything hanging off them. If a commit came
-- between them the mapping would be lost and every order would silently keep
-- its creation timestamp - which is the exact "everything happened in one
-- second" artefact this script exists to remove.
--
-- BACKDATING, AGAIN, DELIBERATELY
--
-- Phase E rewrites created_at on orders, payments, status history and stock
-- movements. That contradicts "history is never rewritten" and is confined to
-- this seed file - never to application code. PostgreSQL cannot fake the clock,
-- and without a real time series the sales and analytics screens are visibly a
-- fixture: one day of data, one bar in the daily chart, no seasonality, no
-- trend. Run against a throwaway project only.
--
-- Timestamps are moved together and stay internally consistent: every payment,
-- history row and movement for an order lands after that order's new created_at,
-- and the history rows are spaced by a few hours from each other.

begin;

select set_config(
  'request.jwt.claims',
  (select json_build_object('sub', a.id::text, 'role', 'authenticated')::text
     from public.admin_users a where a.email = 'admin@diecastly.test'),
  true
);

-- ---------------------------------------------------------------------------
-- Phase D1: customers
--
-- Written directly, because customers are the metadata lane and the application
-- writes them directly. The sale RPCs then attach orders by phone, which is the
-- linking key, so these rows are what makes a customer's order history real.
--
-- A few have no orders (enquiries, one lapsed account) and one is archived,
-- because a customer list where everybody has bought something looks synthetic.
-- Names, numbers and areas are Indian and plausible; notes are operational.
-- ---------------------------------------------------------------------------

insert into public.customers (name, phone_normalized, email, address_line1, address_line2,
                              city, state, postal_code, country, notes, is_active)
select c.name, public.normalize_phone(c.phone), c.email, c.addr1, nullif(c.addr2, ''),
       c.city, c.state, c.pin, 'India', nullif(c.notes, ''), c.active
  from (values
  ('Ananya Deshpande','9845012301','ananya.d@example.com','18 Shivaji Nagar','',     'Bengaluru','KA','560001','Prefers WhatsApp. Usually orders for her son.',true),
  ('Rohit Malhotra',  '9845012302','rohit.m@example.com','44 Linking Road','',        'Mumbai','MH','400050','Corporate orders, needs a proper invoice each time.',true),
  ('Sneha Kulkarni',  '9845012303','sneha.k@example.com','9 Deccan Gymkhana','',      'Pune','MH','411004','',true),
  ('Imran Qadri',     '9845012304','imran.q@example.com','221 Brigade Road','',      'Bengaluru','KA','560001','Collects for a nephew. Pays by UPI.',true),
  ('Divya Menon',     '9845012305','divya.menon@example.com','B-4 Palm Grove','',     'Kochi','KL','682001','',true),
  ('Sandeep Rathore', '9845012306','sandeep.r@example.com','76 Civil Lines','',       'Jaipur','RJ','302001','Asks for gift wrapping on birthdays.',true),
  ('Kavya Reddy',     '9845012307','kavya.reddy@example.com','12 Gachibowli','',      'Hyderabad','TG','500032','',true),
  ('Aditya Joshi',    '9845012308','aditya.joshi@example.com','301 Senapati Bapat Marg','','Mumbai','MH','400013','Bulk buyer, has bought track sets four times.',true),
  ('Nandini Rao',     '9845012309','nandini.rao@example.com','5 Malleswaram','',      'Bengaluru','KA','560003','',true),
  ('Farhan Ali',      '9845012310','farhan.ali@example.com','67 Banjara Hills','',    'Hyderabad','TG','500034','Only buys Japanese makes.',true),
  ('Meghna Bose',     '9845012311','meghna.b@example.com','14 Salt Lake','',         'Kolkata','WB','700091','',true),
  ('Varun Chopra',    '9845012312','varun.chopra@example.com','88 Sector 17','',      'Chandigarh','CH','160017','',true),
  ('Priya Venkatesan','9845012313','priya.v@example.com','23 Anna Salai','',         'Chennai','TN','600002','',true),
  ('Arjun Nair',      '9845012314','arjun.nair@example.com','Panampilly Nagar','',   'Kochi','KL','682036','',true),
  ('Shruti Iyer',     '9845012315','shruti.iyer@example.com','50 Besant Nagar','',    'Chennai','TN','600090','',true),
  ('Karan Grover',    '9845012316','karan.grover@example.com','DLF Phase 3','',        'Gurugram','HR','122002','Wants COD, always.',true),
  ('Aditi Sharma',    '9845012317','aditi.sharma@example.com','Sector 15','',         'Noida','UP','201301','',true),
  ('Manish Tiwari',   '9845012318','manish.tiwari@example.com','37 Civil Lines','',   'Lucknow','UP','226001','',true),
  ('Riya Sen',        '9845012319','riya.sen@example.com','91 Rashbehari','',        'Kolkata','WB','700034','',true),
  ('Sameer Kulkarni', '9845012320','sameer.k@example.com','Aundh','',                'Pune','MH','411007','',true),
  ('Tanvi Desai',     '9845012321','tanvi.desai@example.com','18 Satellite','',       'Ahmedabad','GJ','380015','',true),
  ('Harsh Agarwal',   '9845012322','harsh.agarwal@example.com','122 Greater Kailash','','New Delhi','DL','110048','',true),
  ('Lakshmi Prasad',  '9845012323','lakshmi.p@example.com','9 Mettupalayam','',     'Coimbatore','TN','641011','',true),
  ('Aryan Mehta',     '9845012324','aryan.mehta@example.com','301 Panjrapol','',     'Ahmedabad','GJ','380015','',true),
  ('Snehalatha Reddy','9845012325','snehalatha.r@example.com','8 Banjara Hills','',   'Hyderabad','TG','500034','',true),
  ('Zoya Khan',       '9845012326','zoya.khan@example.com','45 Hauz Khas','',       'New Delhi','DL','110016','',true),
  ('Gaurav Nanda',    '9845012327','gaurav.nanda@example.com','Sector 45','',        'Chandigarh','CH','160047','',true),
  ('Ishita Bose',     '9845012328','ishita.bose@example.com','72 Southern Avenue','', 'Kolkata','WB','700029','',true),
  ('Nitin Bhardwaj',  '9845012329','nitin.b@example.com','6 Model Town','',          'Ludhiana','PB','141002','',true),
  ('Aparna Das',      '9845012330','aparna.das@example.com','31 Salt Lake Sector 1','','Kolkata','WB','700064','',true),
  ('Rishi Patel',     '9845012331','rishi.patel@example.com','204 Satellite','',     'Ahmedabad','GJ','380015','',true),
  ('Sunitha Kumaran', '9845012332','sunitha.k@example.com','21 Panampilly','',       'Kochi','KL','682036','',true),
  ('Devansh Gupta',   '9845012333','devansh.gupta@example.com','B-27 Sector 18','',   'Noida','UP','201301','',true),
  ('Anjali Pillai',   '9845012334','anjali.p@example.com','18 Panampilly Nagar','', 'Kochi','KL','682036','',true),
  ('Yash Chauhan',    '9845012335','yash.chauhan@example.com','63 Civil Lines','',   'Dehradun','UK','248001','',true),
  ('Meenakshi Iyer',  '9845012336','meenakshi.iyer@example.com','44 Ballygunge','',   'Kolkata','WB','700019','',true),
  ('Omar Farooq',     '9845012337','omar.farooq@example.com','9 Banjara Hills','',   'Hyderabad','TG','500034','',true),
  ('Preeti Sandhu',   '9845012338','preeti.sandhu@example.com','78 Model Town','',    'Ludhiana','PB','141002','',true),
  ('Siddharth Rao',   '9845012339','sid.rao@example.com','7 Jayanagar','',          'Bengaluru','KA','560041','',true),
  ('Vaishnavi Menon', '9845012340','vaishnavi.menon@example.com','14 Panampilly','',  'Kochi','KL','682036','',true),
  ('Kunal Saxena',    '9845012341','kunal.saxena@example.com','B-14 Sector 8','',    'Noida','UP','201301','',true),
  ('Harleen Sandhu',  '9845012342','harleen.s@example.com','22 Civil Lines','',     'Amritsar','PB','143001','',true),
  ('Jagdish Pillai',  '9845012343','jagdish.p@example.com','91 Infopark','',        'Pune','MH','411057','',false),
  ('Pallavi Deshmukh','9845012344','pallavi.d@example.com','5 Baner Road','',       'Pune','MH','411045','Left the city in August.',false)
) as c(name, phone, email, addr1, addr2, city, state, pin, notes, active);

-- ---------------------------------------------------------------------------
-- Phase D2: orders
--
-- 220 orders over the last 100 days, weighted to the shop's real shape: about
-- 60% over the counter, 40% online. In-person sales are created already
-- completed, which is what record_in_person_sale does. Online orders walk the
-- fulfilment chain in legal steps.
--
-- Every order records the timestamp it should have been placed at in
-- seed_order_times; Phase E applies it.
-- ---------------------------------------------------------------------------

create temporary table seed_order_times (
  order_number text primary key,
  placed_at    timestamptz not null
) on commit drop;

do $$
declare
  v_total    constant int := 220;
  v_span     constant interval := interval '100 days';
  v_i        int;
  v_offset   int;
  v_placed   timestamptz;
  v_cust     record;
  v_item     record;
  v_items    jsonb := '[]'::jsonb;
  v_lines    int;
  v_online   boolean;
  v_method   public.payment_method;
  v_total_amt numeric(12,2);
  v_paid     numeric(12,2);
  v_res      jsonb;
  v_ord_no   text;
  v_target   text;
  v_step     text;
  v_states   text[] := array['confirmed','packed','shipped','delivered'];
  v_j        int;
begin
  for v_i in 1..v_total loop
    -- Monotonic and jittered, so order numbers and dates agree and the series
    -- has a believable shape rather than a uniform spray.
    v_offset := (v_i - 1) * (extract(epoch from v_span) / v_total)::int
                + (abs(hashtext('d' || v_i)) % 900);
    v_placed := now() - v_span + make_interval(secs => v_offset);

    select * into v_cust
      from public.customers where is_active order by random() limit 1;

    v_online := random() < 0.45;

    -- 1 to 3 lines.
    v_lines := 1 + (abs(hashtext('l' || v_i)) % 3);
    v_items := '[]'::jsonb;
    v_total_amt := 0;

    for v_j in 1..v_lines loop
      -- Uniform selection, deliberately. An earlier version picked by a hash
      -- offset into the product list, which looked like a best-seller curve
      -- and was in fact pathological: measured over the same 220 orders it sent
      -- 59 units to one Matchbox F1 while roughly half the catalogue drew
      -- almost nothing, so the run aborted on insufficient_stock and the
      -- product-profit report would have been half zeroes. Uniform spreads
      -- ~12 units across every sellable line, which is both safe and closer to
      -- the truth for a shop carrying this many lines.
      select id into v_item
        from public.products
       where status = 'active'
       order by random()
       limit 1;

      if v_item.id is null then
        -- Defensive: never build a null line. A missing row here would raise
        -- deep inside place_online_order and abort the whole transaction.
        select id into v_item
          from public.products where status = 'active' order by slug limit 1;
      end if;

      v_items := v_items || jsonb_build_object(
        'productId', v_item.id,
        'quantity', 1 + (abs(hashtext('q' || v_i || '-' || v_j)) % 2)
      );
    end loop;

    -- Let the server compute the total rather than trusting my arithmetic.
    if v_online then
      v_method := case when random() < 0.45 then 'cod'::public.payment_method
                      else 'upi'::public.payment_method end;

      v_res := public.place_online_order(
        v_items,
        jsonb_build_object(
          'name', v_cust.name,
          'phone', v_cust.phone_normalized,
          'email', v_cust.email,
          'addressLine1', v_cust.address_line1,
          'addressLine2', v_cust.address_line2,
          'city', v_cust.city,
          'state', v_cust.state,
          'postalCode', v_cust.postal_code
        ),
        v_method,
        jsonb_build_object(
          'line1', v_cust.address_line1, 'line2', v_cust.address_line2,
          'city', v_cust.city, 'state', v_cust.state,
          'postal_code', v_cust.postal_code, 'country', 'India'
        ),
        null,
        'real-' || v_i
      );
      v_ord_no := v_res ->> 'order_number';
      v_total_amt := (v_res ->> 'total')::numeric;

      -- UPI is settled up front; COD is collected on delivery.
      if v_method = 'upi' then
        perform public.record_payment(
          (v_res ->> 'order_id')::uuid, v_total_amt, 'upi'::public.payment_method,
          'UPI/' || substr(md5(v_ord_no), 1, 4) || '/' || substr(md5(v_ord_no || 'x'), 1, 4),
          'real-pay-' || v_i
        );
      end if;

      -- Funnel. Age drives how far an order can plausibly have got, and the
      -- steps are applied one at a time so the transition matrix is never
      -- asked to accept a jump it forbids. The windows are deliberately wide:
      -- narrow ones left only a handful of orders in flight, so the admin queue
      -- looked abandoned rather than busy.
      v_step := case
        when v_placed > now() - interval '2 days'  then null
        when v_placed > now() - interval '5 days'  then 'confirmed'
        when v_placed > now() - interval '9 days'  then 'packed'
        when random() < 0.16                          then null   -- cancelled below
        when v_placed > now() - interval '18 days' then 'shipped'
        else 'delivered'
      end;

      if v_step = 'packed' and random() < 0.3 then v_step := 'shipped'; end if;
      if v_step = 'shipped' and random() < 0.2 then v_step := 'delivered'; end if;

      if v_step is null and v_placed < now() - interval '9 days' and random() < 0.8 then
        perform public.cancel_order(
          (v_res ->> 'order_id')::uuid,
          (array['Customer changed their mind','Ordered the wrong model','Delivery address unreachable','Ordered a duplicate by mistake'])[1 + (abs(hashtext('c' || v_i)) % 4)],
          true, false, 'real-cancel-' || v_i
        );
      elsif v_step is not null then
        for v_j in 1..array_length(v_states, 1) loop
          -- Apply FIRST, then test. The other order exits before the final
          -- transition is ever issued, which left every order one state short:
          -- nothing reached `delivered`, and the COD collection below was
          -- recording payments against orders still sitting at `shipped`.
          perform public.update_order_status(
            (v_res ->> 'order_id')::uuid,
            v_states[v_j]::public.order_status,
            null,
            case when v_states[v_j] = 'shipped' then (array['Delhivery','BlueDart','Ecom Express'])[1 + (abs(hashtext('s' || v_i)) % 3)] end,
            case when v_states[v_j] = 'shipped' then upper(substr(md5('t' || v_i), 1, 9)) end
          );
          exit when v_states[v_j] = v_step;
        end loop;

        -- COD settles when it is delivered.
        if v_method = 'cod' and v_step = 'delivered' then
          perform public.record_payment(
            (v_res ->> 'order_id')::uuid, v_total_amt, 'cod'::public.payment_method,
            'Collected on delivery', 'real-pay-cod-' || v_i
          );
        end if;
      end if;

    else
      v_method := (array['cash','upi','card','upi','cash'])[1 + (abs(hashtext('m' || v_i)) % 5)]::public.payment_method;

      -- Most counter sales are settled at the till; some are part-paid or
      -- left on account, which is what gives the ledger a mix of states.
      v_res := public.record_in_person_sale(
        v_items,
        v_method,
        null,
        jsonb_build_object('name', v_cust.name, 'phone', v_cust.phone_normalized, 'email', v_cust.email),
        null,
        'real-pos-' || v_i
      );
      v_ord_no := v_res ->> 'order_number';
      v_total_amt := (v_res ->> 'total')::numeric;

      v_paid := case
        when random() < 0.72 then v_total_amt
        when random() < 0.5  then round(v_total_amt * 0.5, 2)
        else 0
      end;

      if v_paid > 0 then
        perform public.record_payment(
          (v_res ->> 'order_id')::uuid, v_paid, v_method,
          case when v_method = 'upi' then 'UPI/' || substr(md5(v_ord_no), 1, 4) else null end,
          'real-pay-' || v_i
        );
      end if;
    end if;

    insert into seed_order_times values (v_ord_no, v_placed);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Phase D3: restocks
--
-- A shop that has traded for three months has received deliveries. Without
-- these every product shows exactly one movement - the opening figure - and the
-- inventory screen reads as a fixture. Restocked through the RPC so the
-- movements are real and the quantities stay consistent.
--
-- Targeted at the lines the order loop above drew from hardest, which is what
-- makes the movements screen look like a genuine restock log.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select s.product_id, s.quantity, p.purchase_cost, p.slug
      from public.inventory_stock s
      join public.products p on p.id = s.product_id
     order by s.quantity asc, p.slug
     limit 10
  loop
    perform public.restock_product(
      r.product_id,
      12 + (abs(hashtext(r.slug)) % 18),
      r.purchase_cost,
      false,
      'Supplier delivery',
      'restock-' || r.slug
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Phase D4: stock-take corrections
--
-- A handful of lines are walked down to near zero so the low-stock badge, the
-- low-stock view and the reorder prompt have genuine entries, and so the
-- movements log contains an `adjustment` row rather than only initial, sale,
-- restock and cancellation.
--
-- Written DOWN rather than up: reducing is always safe, whereas writing a line
-- up would silently invent stock and mask a real inconsistency. The delta is
-- computed from the live quantity so it lands exactly on the target.
-- ---------------------------------------------------------------------------

do $$
declare
  r text;          -- FOREACH assigns each array element, so this is the slug
  v_pid uuid;
  v_qty integer;
  v_target integer;
begin
  foreach r in array array[
    'rolls-royce-phantom-ewb', 'bugatti-chiron', 'koenigsegg-jesko',
    'showroom-diorama-set', 'tomica-land-cruiser-70', 'nissan-gt-r-nismo'
  ] loop
    select s.product_id, s.quantity into v_pid, v_qty
      from public.inventory_stock s
      join public.products p on p.id = s.product_id
     where p.slug = r;

    continue when v_pid is null;

    v_target := case r
      when 'bugatti-chiron' then 0
      when 'showroom-diorama-set' then 1
      when 'rolls-royce-phantom-ewb' then 1
      else 2
    end;

    if v_target < v_qty then
      perform public.adjust_stock(
        v_pid, v_target - v_qty, 'adjustment'::public.movement_type,
        'Stock take correction', 'stk-' || r
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Phase E: backdate
--
-- Every timestamp in the dataset moves to match the order it belongs to, so the
-- daily sales chart has 100 days in it instead of one bar and the reports have a
-- trend to read.
-- ---------------------------------------------------------------------------

-- Orders. expires_at is recomputed from the new created_at rather than left
-- where the column default put it, otherwise every pending online order would
-- show a hold that expired long before the order was placed.
update public.orders o
   set created_at = t.placed_at,
       updated_at = t.placed_at,
       expires_at = case when o.channel = 'online'
                         then t.placed_at + interval '48 hours'
                         else null end
  from seed_order_times t
 where t.order_number = o.order_number;

-- Status history: spread forwards from the order, a few hours per step, in the
-- order the transitions actually happened. The row_number() has to be computed
-- in a CTE - PostgreSQL rejects a window function directly inside UPDATE.
with ranked as (
  select h.id,
         row_number() over (partition by h.order_id order by h.created_at, h.id) as step
    from public.order_status_history h
)
update public.order_status_history h
   set created_at = o.created_at
                  + make_interval(secs => (ranked.step - 1)
                                    * (3600 + abs(hashtext(h.order_id::text)) % 28800))
  from public.orders o, ranked
 where h.order_id = o.id
   and ranked.id = h.id;

-- Payments: after the order, within a day.
update public.payments p
   set created_at = o.created_at + make_interval(secs => 600 + (abs(hashtext(p.id::text)) % 79200)),
       updated_at = o.created_at + make_interval(secs => 600 + (abs(hashtext(p.id::text)) % 79200))
  from public.orders o
 where p.order_id = o.id;

-- Stock movements caused by an order follow the order; the restock movements
-- are left alone and simply predate everything, which is what a restock log
-- looks like.
update public.inventory_movements m
   set created_at = o.created_at
  from public.orders o
 where m.reference_type = 'order'
   and m.reference_id = o.id;

-- Opening stock predates the trading period.
update public.inventory_movements m
   set created_at = now() - interval '115 days'
 where m.movement_type = 'initial';

commit;

\echo '--- orders created and backdated'
