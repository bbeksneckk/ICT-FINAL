-- Corner Café · generated test data for the End-term data analysis (Part C).
-- WARNING: deletes ALL existing orders first. A copy of the earlier data is in schema backup_20261028.
-- Every generated order has is_test_data = true. Run 04_endterm_features.sql and the
-- is_test_data column migration first:
--   ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
-- Design of the test data: 7 to 27 October 2026, 6–9 orders on weekdays and 4–6 at weekends,
-- busier at 8:00 and 12:00–13:00, 1–3 items per order, drinks more likely than food,
-- waiting 2–6 min, preparing 10–16 min (+3 min at peak hours), on the shelf 3–15 min.
-- The average time from Received to Ready was then set to 17 minutes (the 102-second shift at the end).
do $$
declare
  d date; n int; k int; hr int; mi int; t0 timestamptz; t1 timestamptz; t2 timestamptz; t3 timestamptz;
  oid int; item record; peak boolean; nlines int; staff int[] := array[1,2,3,4,5,6,7,8,9];
  names text[] := array['Amina','Arman','Dana','Timur','Aruzhan','Dias','Kamila','Sultan','Madina','Nurlan','Aliya','Askar','Zarina','Ruslan','Sabina','Daniyar','Aigerim','Alikhan','Asel','Yerlan','Saule','Miras','Dilnaz','Bekzat','Togzhan','Nursultan','Laura','Ilyas','Adil','Malika'];
  notes text[] := array['Oat milk, please','No sugar','Extra hot','Less ice','Cut the sandwich in half','Decaf if possible','Extra shot','To go, with a lid'];
  hours int[] := array[8,8,8,8,8,8,9,9,9,9,9,10,10,10,11,11,11,12,12,12,12,12,13,13,13,13,13,13,14,14,14,15,15,16,16,16,17,17,17,18,18,19];
begin
  perform setseed(0.42);
  update public.shelf_slots set order_id = null, assigned_at = null, placed_at = null, weight_g = 0;
  delete from public.sensor_readings;
  delete from public.orders;
  perform setval('public.order_number_seq', 1000);
  for d in select generate_series(date '2026-10-07', date '2026-10-27', interval '1 day')::date loop
    n := case when extract(isodow from d) >= 6 then 4 + floor(random()*3)::int else 6 + floor(random()*4)::int end;
    for k in 1..n loop
      hr := hours[1 + floor(random()*array_length(hours,1))::int];
      mi := floor(random()*60)::int;
      t0 := (d + make_time(hr, mi, floor(random()*59)::int)) at time zone 'Asia/Almaty';
      peak := hr in (8, 12, 13);
      insert into public.orders(customer_first_name, status, created_at, is_test_data, customer_note, pickup_at)
      values (names[1 + floor(random()*array_length(names,1))::int], 'Collected', t0, true,
              case when random() < 0.15 then notes[1 + floor(random()*array_length(notes,1))::int] end,
              case when random() < 0.25 then t0 + make_interval(mins => (array[15,30,60])[1 + floor(random()*3)::int]) end)
      returning order_id into oid;
      nlines := 1 + floor(random()*3)::int;
      for item in select m.item_id, m.price from public.menu_items m where m.is_available
                  order by (case when m.category_id <= 4 then random()*0.6 else random() end) limit nlines
      loop
        insert into public.order_items(order_id, item_id, quantity, unit_price)
        values (oid, item.item_id, case when random() < 0.8 then 1 else 2 end, item.price);
      end loop;
      t1 := t0 + make_interval(secs => (120 + random()*240)::int);
      t2 := t1 + make_interval(secs => (600 + random()*360 + nlines*20 + case when peak then 180 else 0 end)::int);
      t3 := t2 + make_interval(secs => (180 + random()*720)::int);
      insert into public.order_status_history(order_id, old_status, new_status, changed_by, changed_at) values
        (oid, null, 'Received', null, t0),
        (oid, 'Received', 'Preparing', staff[1 + floor(random()*9)::int], t1),
        (oid, 'Preparing', 'Ready', staff[1 + floor(random()*9)::int], t2),
        (oid, 'Ready', 'Collected', staff[1 + floor(random()*9)::int], t3);
    end loop;
  end loop;
end $$;
update public.order_status_history h set changed_at = h.changed_at - interval '102 seconds'
from public.orders o where o.order_id = h.order_id and o.is_test_data and h.new_status in ('Ready', 'Collected');
