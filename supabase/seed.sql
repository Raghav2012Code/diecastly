-- Local seed data. Loaded by `supabase db reset`.
-- The single settings row is created by the migration; this only adds a
-- starter category tree so the admin has something to attach products to.

insert into public.categories (name, slug, sort_order)
values
  ('Hot Wheels', 'hot-wheels', 0),
  ('Mainline', 'mainline', 1),
  ('Premium', 'premium', 2),
  ('Other Diecast', 'other-diecast', 3)
on conflict (slug) do nothing;

-- Update the category tree so Mainline/Premium/Other are children of Hot Wheels
-- where it makes sense (kept simple and idempotent).
update public.categories
   set parent_id = (select id from public.categories where slug = 'hot-wheels')
 where slug in ('mainline', 'premium')
   and parent_id is null;
