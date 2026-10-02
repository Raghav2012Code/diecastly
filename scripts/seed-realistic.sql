-- Realistic sample data for a demo database.
--
-- SUPERSEDES the first version of this seed, which was written for legibility
-- rather than plausibility and gave the game away in three ways:
--
--   1. Every order shared one timestamp, so the sales report showed a single
--      day and the daily chart was one bar. This version backdates the whole
--      dataset across ~100 days.
--   2. Placeholder names. "Walk-in customer", "Corporate order", "Retired
--      customer" are not names a shop would have in its ledger.
--   3. Notes that described the SCHEMA rather than the business - "archived so
--      order history keeps its link" is documentation leaking into customer
--      data, and anyone reading the customer screen would know the rows were
--      generated. Notes here read like operational notes.
--
-- WHY ORDERS STILL GO THROUGH THE RPCs
--
-- Orders, items, payments, status history, stock and movements are ledger lanes.
-- Raw INSERTs would produce rows that look right and violate every invariant the
-- functions exist to protect: no stock decrement, no movement, no cost snapshot,
-- no history, totals disagreeing with the lines. It would then be impossible to
-- tell a real bug from a bad seed. So orders are placed through
-- place_online_order / record_in_person_sale and moved through update_order_status
-- / cancel_order, exactly as the application would.
--
-- THE BACKDATING EXCEPTION, STATED PLAINLY
--
-- created_at is set by a column default that cannot be overridden without
-- faking the clock (not possible in PostgreSQL) or rewriting rows afterwards.
-- This script takes the second route: orders are created normally, then
-- created_at is moved backwards on the orders AND on their payments, status
-- history and stock movements, so every timestamp moves together and stays
-- internally consistent.
--
-- That does contradict "history is never rewritten", deliberately and confined
-- to this seed script - never to application code. Without it the reports are
-- visibly a fixture. Run this once against a throwaway project; do not run it
-- against data you care about. Phase E is the only phase that rewrites anything.
--
-- Nothing here is called from the build. Random ids and a random order mix, so
-- two runs differ while both look plausible.

begin;

-- ---------------------------------------------------------------------------
-- Phase A: wipe any previous demo data
--
-- Child rows first. The admin account is the only identity, and no demo row
-- references it, so there is no FK to trip over.
-- ---------------------------------------------------------------------------

delete from public.payments;
delete from public.order_status_history;
delete from public.order_items;
delete from public.inventory_movements;
delete from public.orders;
delete from public.customers;
delete from public.product_images;
delete from public.products;
delete from public.categories;
delete from public.suppliers;

-- Restart the order counter. Leaving it at 170 would imply 170 orders that do
-- not exist in this database.
select setval('public.order_number_seq', 1, false);

update public.settings
   set business_name = 'Diecastly',
       business_phone = '+91 80 4718 2200',
       business_email = 'hello@diecastly.example',
       upi_id = 'diecastly@okhdfcbank',
       currency = 'INR',
       cod_enabled = true,
       default_shipping_fee = 79.00,
       low_stock_threshold_default = 2,
       order_prefix = 'DC'
 where id = true;

-- Admin claims for the RPCs. set_config(..., true) is the scoped equivalent of
-- `set local`, and it MUST be inside this transaction or the claim is discarded
-- the moment the statement commits - which is how the first attempt at this
-- script failed with a spurious not_authorized.
select set_config(
  'request.jwt.claims',
  (select json_build_object('sub', a.id::text, 'role', 'authenticated')::text
     from public.admin_users a where a.email = 'admin@diecastly.test'),
  true
);

-- ---------------------------------------------------------------------------
-- Phase B: catalogue
-- ---------------------------------------------------------------------------

insert into public.categories (id, name, slug, parent_id, sort_order, is_active) values
  ('40000000-0000-0000-0000-000000000001', 'Hot Wheels',          'hot-wheels',           null, 0, true),
  ('40000000-0000-0000-0000-000000000002', 'Mainline',            'mainline',             '40000000-0000-0000-0000-000000000001', 1, true),
  ('40000000-0000-0000-0000-000000000003', 'Premium',             'premium',              '40000000-0000-0000-0000-000000000001', 2, true),
  ('40000000-0000-0000-0000-000000000004', 'Exotic Diecast',      'exotic-diecast',       '40000000-0000-0000-0000-000000000001', 3, true),
  ('40000000-0000-0000-0000-000000000005', 'Super GT',            'super-gt',             '40000000-0000-0000-0000-000000000001', 4, true),
  ('40000000-0000-0000-0000-000000000006', 'Matchbox',            'matchbox',             null, 5, true),
  ('40000000-0000-0000-0000-000000000007', 'Tomica',              'tomica',               null, 6, true),
  ('40000000-0000-0000-0000-000000000008', 'Bburago',             'bburago',              null, 7, true),
  ('40000000-0000-0000-0000-000000000009', 'Indian Cars',         'indian-cars',          null, 8, true),
  ('40000000-0000-0000-0000-000000000010', 'Tracks & Sets',       'tracks-and-sets',      null, 9, true),
  ('40000000-0000-0000-0000-000000000011', 'Miniature & Diorama', 'miniature-diorama',    null, 10, true);

insert into public.suppliers (name, contact_name, phone, email, notes, is_active)
select * from (values
  ('Hot Wheels India',         'Suresh Iyer',        '+919845001201', 'orders@hotwheelsindia.example',   'Mainline and Indian car lines.', true),
  ('Mattel Distributor South', 'Pooja Ramesh',       '+919845001202', 'supply@mattelsouth.example',      'Covers Karnataka, Kerala and Tamil Nadu.', true),
  ('Autoart Distribution',     'Nitin Kulkarni',     '+919845001203', 'purchases@autoart.example',       'Die-cast and plastic kits.', true),
  ('Greenlight Hobby India',   'Aisha Khan',         '+919845001204', 'stock@greenlight.example',        'Premium and Super GT.', true),
  ('Welly Models India',       'Rajesh Pillai',      '+919845001205', 'sales@wellymodels.example',       'Budget 1:43 range.', true),
  ('Mini GT Imports',          'Farhan Qureshi',     '+919845001206', 'hello@minigtimports.example',     'Licensed GT replicas. Slow moving.', true),
  ('B B Merchandise Works',    'Lakshmi Narayan',    '+919845001207', 'supply@bbmerch.example',          'Matchbox and Tomica.', true),
  ('Scale Model Depot',        'Imran Sheikh',       '+919845001208', 'orders@scalemodel.example',       'Diorama and garage sets.', true),
  ('Collectors Corner',        'Meera Balakrishnan', '+919845001209', 'hello@collectorscorner.example',  'Trade accounts only.', true),
  ('Coastal Hobby Supplies',   'Vivek Shetty',       '+919845001210', 'info@coastalhobby.example',       'Account on hold since 2025.', false)
) as t(name, contact_name, phone, email, notes, is_active);

-- 58 products. Ids are generated so the order loop can pick them without
-- hard-coding; slugs are explicit because they are storefront URLs.
insert into public.products
  (name, slug, brand, model, series, category_id, supplier_id, description, sku,
   purchase_cost, selling_price, low_stock_threshold, status, is_featured)
select p.name, p.slug, p.brand, p.model, p.series, c.id, s.id, p.description, p.sku,
       p.cost, p.price, p.threshold, 'active'::public.product_status, p.featured
  from (values
  ('Toyota GR Supra (2024)','toyota-gr-supra-2024','Toyota','GR Supra','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1001',220.00,349.00,3,true,'JDM revival special with opening doors and a moulded engine bay.'),
  ('Ford Mustang Mach-E','ford-mustang-mach-e','Ford','Mustang Mach-E','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1002',250.00,399.00,3,false,'Electric muscle car in Grabber Blue on a black base.'),
  ('Honda Civic Type R FL5','honda-civic-type-r-fl5','Honda','Civic Type R','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1003',240.00,385.00,3,true,'Championship White with the red badge and rear wing.'),
  ('Nissan Silvia S15','nissan-silvia-s15','Nissan','Silvia S15','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1004',195.00,329.00,3,false,'Tuner classic in Crystal White.'),
  ('Mazda MX-5 ND','mazda-mx5-nd','Mazda','MX-5 ND','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1005',215.00,349.00,3,false,'Soul Red, the colour that made the car famous.'),
  ('Hyundai Elantra N','hyundai-elantra-n','Hyundai','Elantra N','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1006',230.00,365.00,3,false,'Performance N with quad exhausts.'),
  ('Volkswagen Golf GTI','volkswagen-golf-gti','Volkswagen','Golf GTI','Hot Wheels Mainline','mainline','Mattel Distributor South','HW-ML-1007',210.00,339.00,3,false,'Mk8 hot hatch in Moonstone Grey.'),
  ('Subaru WRX STI','subaru-wrx-sti','Subaru','WRX STI','Hot Wheels Mainline','mainline','Mattel Distributor South','HW-ML-1008',205.00,335.00,3,false,'Crystal White with the signature hood scoop.'),
  ('Jeep Wrangler Rubicon','jeep-wrangler-rubicon','Jeep','Wrangler Rubicon','Hot Wheels Mainline','mainline','Mattel Distributor South','HW-ML-1009',265.00,415.00,3,false,'Trail tan with a fold-flat windscreen.'),
  ('Chevrolet Camaro ZL1','chevrolet-camaro-zl1','Chevrolet','Camaro ZL1','Hot Wheels Mainline','mainline','Mattel Distributor South','HW-ML-1010',250.00,395.00,3,false,'Riverside Blue muscle car.'),
  ('Lamborghini Huracan STO','lamborghini-huracan-sto','Lamborghini','Huracan STO','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2001',480.00,699.00,2,true,'Matte green with working scissor doors.'),
  ('BMW M4 Competition','bmw-m4-competition','BMW','M4 Competition','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2002',520.00,749.00,2,true,'Brooklyn Grey metallic on gloss black wheels.'),
  ('Porsche 911 GT3 RS','porsche-911-gt3-rs','Porsche','911 GT3 RS','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2003',650.00,899.00,2,true,'Shark Blue on a collector display base.'),
  ('Ferrari SF90 Stradale','ferrari-sf90-stradale','Ferrari','SF90 Stradale','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2004',610.00,849.00,2,true,'Rosso Corsa hybrid hyper car.'),
  ('McLaren 765LT','mclaren-765lt','McLaren','765LT','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2005',560.00,779.00,2,false,'Papaya Orange with dihedral doors.'),
  ('Tesla Model 3 Performance','tesla-model-3-performance','Tesla','Model 3','Hot Wheels Premium','premium','Greenlight Hobby India','HW-PR-2006',300.00,449.00,2,false,'Pearl white with flush door handles.'),
  ('Aston Martin Vantage','aston-martin-vantage','Aston Martin','Vantage','Hot Wheels Premium','premium','Collectors Corner','HW-PR-2007',540.00,749.00,2,false,'Aston Green with the unmistakable grille.'),
  ('Nissan GT-R NISMO','nissan-gt-r-nismo','Nissan','GT-R NISMO','Hot Wheels Premium','premium','Collectors Corner','HW-PR-2008',700.00,949.00,2,true,'Bayside Blue. One of the few that still arrive.'),
  ('Rolls-Royce Phantom EWB','rolls-royce-phantom-ewb','Rolls-Royce','Phantom','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3001',890.00,1249.00,1,true,'Midnight Sapphire with a chrome Spirit of Ecstasy.'),
  ('Bugatti Chiron','bugatti-chiron','Bugatti','Chiron','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3002',820.00,1150.00,1,true,'French Racing Blue with the C-line flank.'),
  ('Koenigsegg Jesko','koenigsegg-jesko','Koenigsegg','Jesko','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3003',940.00,1299.00,1,false,'Earpiece Orange on a numbered base.'),
  ('Pagani Huayra BC','pagani-huayra-bc','Pagani','Huayra BC','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3004',880.00,1225.00,1,true,'Silver with exposed carbon fibre trim.'),
  ('Rimac Nevera','rimac-nevera','Rimac','Nevera','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3005',910.00,1250.00,1,false,'Snaith Blue electric hyper car.'),
  ('Nissan GT-R GT3','nissan-gt-r-gt3','Nissan','GT-R GT3','Super GT','super-gt','Greenlight Hobby India','SGT-4001',460.00,659.00,2,false,'Motegi-inspired livery on winged supports.'),
  ('Mercedes AMG GT3','mercedes-amg-gt3','Mercedes-AMG','AMG GT3','Super GT','super-gt','Greenlight Hobby India','SGT-4002',480.00,689.00,2,true,'Green Hell Magno race specification.'),
  ('Porsche 911 GT3 Cup','porsche-911-gt3-cup','Porsche','911 GT3 Cup','Super GT','super-gt','Greenlight Hobby India','SGT-4003',440.00,629.00,2,false,'Shark Blue cup car with a large rear wing.'),
  ('BMW M4 GT3','bmw-m4-gt3','BMW','M4 GT3','Super GT','super-gt','Greenlight Hobby India','SGT-4004',455.00,649.00,2,false,'Motegi grid livery.'),
  ('Toyota GR86 GT3','toyota-gr86-gt3','Toyota','GR86','Super GT','super-gt','Greenlight Hobby India','SGT-4005',430.00,619.00,2,false,'Type S based race car.'),
  ('Matchbox Ford Mustang','matchbox-ford-mustang','Ford','Mustang','Matchbox','matchbox','B B Merchandise Works','MB-5001',95.00,175.00,4,false,'Pull-back muscle car. Consistently our cheapest seller.'),
  ('Matchbox Lamborghini Countach','matchbox-lamborghini-countach','Lamborghini','Countach','Matchbox','matchbox','B B Merchandise Works','MB-5002',105.00,195.00,4,true,'Poster child of the eighties, in bright red.'),
  ('Matchbox Land Rover Defender','matchbox-land-rover-defender','Land Rover','Defender','Matchbox','matchbox','B B Merchandise Works','MB-5003',98.00,179.00,4,false,'Green Defender with a tilt-flat bed.'),
  ('Matchbox Peterbilt 379','matchbox-peterbilt-379','Peterbilt','379','Matchbox','matchbox','B B Merchandise Works','MB-5004',110.00,199.00,3,false,'The truck half our customers remember from childhood.'),
  ('Matchbox McLaren F1','matchbox-mclaren-f1','McLaren','F1','Matchbox','matchbox','B B Merchandise Works','MB-5005',130.00,229.00,3,true,'Maroon F1. The best Matchbox money buys.'),
  ('Tomica Toyota Land Cruiser 70','tomica-land-cruiser-70','Toyota','Land Cruiser 70','Tomica','tomica','B B Merchandise Works','TM-6001',340.00,529.00,2,true,'Beige 70 series. The default gift for a new parent.'),
  ('Tomica Toyota Corolla Axio','tomica-corolla-axio','Toyota','Corolla Axio','Tomica','tomica','B B Merchandise Works','TM-6002',280.00,449.00,2,false,'Japanese taxi specification, extremely detailed.'),
  ('Tomica Nissan Figaro','tomica-nissan-figaro','Nissan','Figaro','Tomica','tomica','B B Merchandise Works','TM-6003',320.00,499.00,2,false,'Retro green bubble car.'),
  ('Tomica Honda NSX','tomica-honda-nsx','Honda','NSX','Tomica','tomica','B B Merchandise Works','TM-6004',410.00,629.00,2,true,'Formula One white with red trim.'),
  ('Tomica Subaru Impreza WRX','tomica-subaru-impreza','Subaru','Impreza WRX','Tomica','tomica','B B Merchandise Works','TM-6005',360.00,559.00,2,false,'WRX in blue with a proper light bar.'),
  ('Bburago Lamborghini Aventador','bburago-lamborghini-aventador','Lamborghini','Aventador','Bburago','bburago','Welly Models India','BB-7001',230.00,379.00,3,false,'Opening doors, 1:18. Good value.'),
  ('Bburago Porsche 911 Carrera','bburago-porsche-911','Porsche','911 Carrera','Bburago','bburago','Welly Models India','BB-7002',225.00,369.00,3,true,'Rear-axle steering on the 1:18.'),
  ('Bburago BMW i8','bburago-bmw-i8','BMW','i8','Bburago','bburago','Welly Models India','BB-7003',205.00,339.00,3,false,'Charging indicator and opening scissor doors.'),
  ('Bburago Ford Mustang GT 2018','bburago-ford-mustang-gt','Ford','Mustang GT','Bburago','bburago','Welly Models India','BB-7004',190.00,315.00,3,false,'Race Red with a black stripe package.'),
  ('Maruti Suzuki Baleno','maruti-suzuki-baleno','Maruti Suzuki','Baleno','Indian Cars','indian-cars','Hot Wheels India','IN-8001',180.00,289.00,4,true,'Our best seller by a distance. Metropolis Grey.'),
  ('Maruti Suzuki Swift Sport','maruti-suzuki-swift-sport','Maruti Suzuki','Swift Sport','Indian Cars','indian-cars','Hot Wheels India','IN-8002',170.00,275.00,4,false,'Sport variant in pure white.'),
  ('Tata Nexon EV','tata-nexon-ev','Tata','Nexon EV','Indian Cars','indian-cars','Hot Wheels India','IN-8003',210.00,329.00,3,true,'EV version in Pristine White.'),
  ('Tata Harrier','tata-harrier','Tata','Harrier','Indian Cars','indian-cars','Hot Wheels India','IN-8004',260.00,399.00,3,true,'Fierce Blue. Popular with the SUV crowd.'),
  ('Mahindra Thar 4x4','mahindra-thar-4x4','Mahindra','Thar','Indian Cars','indian-cars','Hot Wheels India','IN-8005',340.00,499.00,3,true,'Desert Bronze off-roader. Moves fast.'),
  ('Mahindra Scorpio N','mahindra-scorpio-n','Mahindra','Scorpio N','Indian Cars','indian-cars','Hot Wheels India','IN-8006',300.00,459.00,3,false,'Deep Indigo seven seater.'),
  ('Hyundai Creta','hyundai-creta','Hyundai','Creta','Indian Cars','indian-cars','Mattel Distributor South','IN-8007',245.00,375.00,3,false,'The compact SUV that will not stop selling.'),
  ('Hyundai Venue','hyundai-venue','Hyundai','Venue','Indian Cars','indian-cars','Mattel Distributor South','IN-8008',195.00,309.00,3,false,'Compact crossover in Sunroof White.'),
  ('Tata Tiago EV','tata-tiago-ev','Tata','Tiago EV','Indian Cars','indian-cars','Hot Wheels India','IN-8009',165.00,259.00,3,false,'Entry EV. Does brisk business.'),
  ('Kia Seltos','kia-seltos','Kia','Seltos','Indian Cars','indian-cars','Mattel Distributor South','IN-8010',250.00,379.00,3,false,'Glossy Black with the new Kia badge.'),
  ('Hot Wheels City Track Set','hot-wheels-city-track-set','Hot Wheels','City Track Set','Tracks & Sets','tracks-and-sets','Mini GT Imports','SET-9001',750.00,1099.00,2,true,'Two cars and a folding track, gift boxed.'),
  ('1:64 City Street Set','city-street-track-set','Generic','City Street','Tracks & Sets','tracks-and-sets','Mini GT Imports','SET-9002',620.00,899.00,2,false,'Multi-level street layout with a working car lift.'),
  ('Garage Diorama Set','garage-diorama-set','Generic','Garage Diorama','Miniature & Diorama','miniature-diorama','Scale Model Depot','SET-9003',980.00,1399.00,1,true,'Bench diorama with working roller doors.'),
  ('Showroom Diorama Set','showroom-diorama-set','Generic','Showroom Diorama','Miniature & Diorama','miniature-diorama','Scale Model Depot','SET-9004',1420.00,1899.00,1,true,'A full 1:64 dealership floor. Takes two to build.'),
  ('Jaguar E-Type Coupe','jaguar-e-type-coupe','Jaguar','E-Type','Exotic Diecast','exotic-diecast','Collectors Corner','EXC-3006',310.00,465.00,2,false,'Opalesque Gunmetal Grey.'),
  ('Lada Niva','lada-niva','Lada','Niva','Hot Wheels Mainline','mainline','Hot Wheels India','HW-ML-1011',140.00,219.00,3,false,'Khrushchev Badge. Discontinued line.')
) as p(name, slug, brand, model, series, cat_slug, sup_name, sku, cost, price, threshold, featured, description)
  join public.categories c on c.slug = p.cat_slug
  join public.suppliers s on s.name = p.sup_name;

-- Not on sale. Draft means not published yet; archived means discontinued but
-- retained, because orders still reference it.
update public.products set status = 'draft'    where slug = 'jaguar-e-type-coupe';
update public.products set status = 'archived' where slug = 'lada-niva';

-- ---------------------------------------------------------------------------
-- Phase C: opening stock, backdated to before the sales period
--
-- Through the RPC so the `initial` movement rows exist. Without a restock
-- history the inventory screen would show every product stocked exactly once
-- and nothing arriving since, which is not how a shop that has been trading
-- for three months looks.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select id, purchase_cost, selling_price, slug from public.products order by slug loop
    -- ~660 units are sold across 56 sellable lines, spread roughly evenly by the
    -- uniform selection in the order script, so the heaviest single line draws
    -- around 25. These figures leave a wide margin over that, because sizing
    -- too tightly aborts the whole run on insufficient_stock partway through and
    -- a half-built ledger is worse than a slightly generous one. Lines that
    -- should look nearly sold out are walked down afterwards by a stock-take
    -- correction instead, which is both safer and more honest.
    perform public.set_initial_stock(
      r.id,
      case
        when r.selling_price >= 800 then 35 + (abs(hashtext(r.slug)) % 20)
        when r.selling_price >= 300 then 45 + (abs(hashtext(r.slug)) % 25)
        else 60 + (abs(hashtext(r.slug)) % 30)
      end,
      r.purchase_cost
    );
  end loop;
end $$;

commit;

\echo '--- catalogue and opening stock loaded'
