-- Corner Café · Project Stage 2 (End-term) features.
-- Additive migration for the existing Assignment 3/4 database:
-- no existing table, row or function is removed or changed.
--   1. Pickup time and a short note on each order
--   2. Queue information and an estimated waiting time for customers
--   3. Manager statistics for the analytics panel (Part C5)
--   4. Smart pickup shelf: IoT device, shelf slots and sensor readings (Part D3)
--   5. Manager price editing

-- 1. New order fields -------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_note varchar(140);

-- 4. Smart pickup shelf tables -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iot_devices (
  device_id varchar(40) PRIMARY KEY,
  label varchar(80) NOT NULL,
  key_hash char(64) NOT NULL,              -- SHA-256 of the device key; the key itself is not stored
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.shelf_slots (
  slot_no smallint PRIMARY KEY CHECK (slot_no BETWEEN 1 AND 8),
  device_id varchar(40) NOT NULL REFERENCES public.iot_devices(device_id),
  order_id integer UNIQUE REFERENCES public.orders(order_id) ON DELETE SET NULL,
  assigned_at timestamptz,
  placed_at timestamptz,                   -- first reading with a bag on the slot
  weight_g integer NOT NULL DEFAULT 0,
  last_reading_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.sensor_readings (
  reading_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id varchar(40) NOT NULL REFERENCES public.iot_devices(device_id),
  slot_no smallint NOT NULL,
  weight_g integer NOT NULL CHECK (weight_g BETWEEN 0 AND 20000),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_time ON public.sensor_readings(recorded_at);

ALTER TABLE public.iot_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelf_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.iot_devices, public.shelf_slots, public.sensor_readings FROM PUBLIC, anon, authenticated;

-- The shelf needs a staff identity for the status history (changed_by must not be NULL).
-- It is inactive and not linked to any login, so nobody can sign in with it.
INSERT INTO public.staff_users(username, display_name, password_hash, role, is_active)
SELECT 'smart.shelf', 'Smart shelf', '$2b$12$ASFogjU5tw/ll.0EqrbtWVy2bkTZE8DpgIFDlCbxreIta5C416PDg', 'staff', false
WHERE NOT EXISTS (SELECT 1 FROM public.staff_users WHERE username = 'smart.shelf');

INSERT INTO public.iot_devices(device_id, label, key_hash)
VALUES ('shelf-01', 'Pickup shelf, 4 weight-sensor slots',
        '65153f4b0f3f118c4e18411cf733102068b5b72dcd623b15b012c938bc76a7b0')  -- SHA-256 of an old example key. Set your own secret key after setup:
  -- UPDATE public.iot_devices SET key_hash = encode(extensions.digest('<your 32-char key>', 'sha256'), 'hex') WHERE device_id = 'shelf-01';
ON CONFLICT (device_id) DO NOTHING;
INSERT INTO public.shelf_slots(slot_no, device_id)
SELECT s, 'shelf-01' FROM generate_series(1, 4) s ON CONFLICT (slot_no) DO NOTHING;

-- Extended order JSON ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cafe_order_json2(p_order_id integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._cafe_order_json(o.order_id) || jsonb_build_object(
    'pickup_at', o.pickup_at,
    'customer_note', o.customer_note,
    'shelf_slot', (SELECT s.slot_no FROM public.shelf_slots s WHERE s.order_id = o.order_id),
    'on_shelf', (SELECT s.placed_at IS NOT NULL FROM public.shelf_slots s WHERE s.order_id = o.order_id),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('new_status', h.new_status,
      'changed_at', h.changed_at, 'changed_by', st.display_name) ORDER BY h.history_id), '[]'::jsonb)
      FROM public.order_status_history h LEFT JOIN public.staff_users st ON st.staff_id = h.changed_by
      WHERE h.order_id = o.order_id)
  ) FROM public.orders o WHERE o.order_id = p_order_id;
$$;

-- 2. Queue and waiting time --------------------------------------------------------
-- Average minutes from Received to Ready over the latest 200 finished orders.
CREATE OR REPLACE FUNCTION public._cafe_avg_prep_minutes()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(round(avg(extract(epoch FROM y.changed_at - r.changed_at) / 60)::numeric, 1), 10)
  FROM (SELECT order_id FROM public.order_status_history WHERE new_status = 'Ready'
        ORDER BY changed_at DESC LIMIT 200) last
  JOIN public.order_status_history r ON r.order_id = last.order_id AND r.new_status = 'Received'
  JOIN public.order_status_history y ON y.order_id = last.order_id AND y.new_status = 'Ready';
$$;

-- Estimate = average preparation time + 2 minutes for every order already waiting.
CREATE OR REPLACE FUNCTION public.cafe_queue_info()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'active_orders', (SELECT count(*) FROM public.orders WHERE status IN ('Received', 'Preparing')),
    'avg_prep_minutes', public._cafe_avg_prep_minutes(),
    'estimated_wait_minutes', ceil(public._cafe_avg_prep_minutes()
      + 2 * (SELECT count(*) FROM public.orders WHERE status IN ('Received', 'Preparing')))
  );
$$;

-- 1. Order placement with pickup time and note (v1 stays unchanged for old clients).
CREATE OR REPLACE FUNCTION public.cafe_place_order_v2(p_name text, p_items jsonb, p_token uuid,
  p_note text DEFAULT NULL, p_pickup_in_minutes integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_note text := nullif(btrim(p_note), ''); v_order_id integer;
BEGIN
  IF v_note IS NOT NULL AND char_length(v_note) > 140 THEN RAISE EXCEPTION 'The note can have up to 140 characters.'; END IF;
  IF p_pickup_in_minutes IS NOT NULL AND p_pickup_in_minutes NOT IN (15, 30, 45, 60) THEN
    RAISE EXCEPTION 'Choose a pickup time of 15, 30, 45 or 60 minutes, or as soon as possible.';
  END IF;
  -- All cart, price and availability checks run inside the original function.
  v_order_id := (public.cafe_place_order(p_name, p_items, p_token)->>'order_id')::integer;
  UPDATE public.orders SET customer_note = v_note,
    pickup_at = CASE WHEN p_pickup_in_minutes IS NULL THEN NULL ELSE created_at + make_interval(mins => p_pickup_in_minutes) END
  WHERE order_id = v_order_id AND status = 'Received';
  RETURN public._cafe_order_json2(v_order_id) || jsonb_build_object('queue', public.cafe_queue_info());
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_track_order_v2(p_token uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._cafe_order_json2(o.order_id) || jsonb_build_object(
    'orders_ahead', (SELECT count(*) FROM public.orders a
      WHERE a.status IN ('Received', 'Preparing') AND a.created_at < o.created_at),
    'avg_prep_minutes', public._cafe_avg_prep_minutes())
  FROM public.orders o WHERE o.status_token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.cafe_staff_orders_v2()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._cafe_require_staff();
  RETURN (SELECT coalesce(jsonb_agg(public._cafe_order_json2(q.order_id) ORDER BY q.order_number DESC), '[]'::jsonb)
    FROM (
      SELECT order_id, order_number FROM public.orders WHERE status <> 'Collected'
      UNION ALL
      (SELECT order_id, order_number FROM public.orders WHERE status = 'Collected' ORDER BY order_number DESC LIMIT 30)
    ) q);
END;
$$;

-- Same rules as cafe_advance_order, plus the shelf: Ready takes a free slot, Collected frees it.
CREATE OR REPLACE FUNCTION public.cafe_advance_order_v2(p_order_id integer, p_expected_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users; v_order public.orders; v_next text; v_slot smallint;
BEGIN
  v_staff := public._cafe_require_staff();
  SELECT * INTO v_order FROM public.orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF v_order.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'This order changed. Refresh the board before trying again.'; END IF;
  v_next := CASE v_order.status WHEN 'Received' THEN 'Preparing' WHEN 'Preparing' THEN 'Ready' WHEN 'Ready' THEN 'Collected' ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'This order is already collected.'; END IF;
  UPDATE public.orders SET status = v_next WHERE order_id = p_order_id;
  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by)
  VALUES (p_order_id, v_order.status, v_next, v_staff.staff_id);
  IF v_next = 'Ready' THEN
    SELECT slot_no INTO v_slot FROM public.shelf_slots WHERE order_id IS NULL ORDER BY slot_no LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE public.shelf_slots SET order_id = p_order_id, assigned_at = now(), placed_at = NULL WHERE slot_no = v_slot;
    END IF;
  ELSIF v_next = 'Collected' THEN
    UPDATE public.shelf_slots SET order_id = NULL, assigned_at = NULL, placed_at = NULL WHERE order_id = p_order_id;
  END IF;
  RETURN public._cafe_order_json2(p_order_id);
END;
$$;

-- 4. Device endpoint: the shelf reports weights; a pickup marks the order Collected.
CREATE OR REPLACE FUNCTION public.cafe_sensor_report(p_device_id text, p_device_key text, p_readings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_dev public.iot_devices; v_r record; v_slot public.shelf_slots; v_shelf_staff integer; v_events jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_dev FROM public.iot_devices WHERE device_id = p_device_id AND is_active;
  IF NOT FOUND OR v_dev.key_hash <> encode(extensions.digest(coalesce(p_device_key, ''), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'Unknown device or wrong device key.';
  END IF;
  IF p_readings IS NULL OR jsonb_typeof(p_readings) <> 'array' OR jsonb_array_length(p_readings) > 8 THEN
    RAISE EXCEPTION 'Readings must be an array of up to 8 slots.';
  END IF;
  SELECT staff_id INTO v_shelf_staff FROM public.staff_users WHERE username = 'smart.shelf';

  FOR v_r IN SELECT (x->>'slot')::smallint AS slot, greatest(0, least(20000, (x->>'weight_g')::integer)) AS w
             FROM jsonb_array_elements(p_readings) x
  LOOP
    SELECT * INTO v_slot FROM public.shelf_slots WHERE slot_no = v_r.slot AND device_id = p_device_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.sensor_readings(device_id, slot_no, weight_g) VALUES (p_device_id, v_r.slot, v_r.w);
    IF v_slot.order_id IS NOT NULL AND v_slot.placed_at IS NULL AND v_r.w >= 100 THEN
      -- Staff put the bag on the shelf.
      UPDATE public.shelf_slots SET placed_at = now() WHERE slot_no = v_r.slot;
      v_events := v_events || jsonb_build_object('event', 'placed', 'slot', v_r.slot);
    ELSIF v_slot.order_id IS NOT NULL AND v_slot.placed_at IS NOT NULL AND v_r.w < 30 THEN
      -- The bag was lifted: the customer collected the order.
      IF (SELECT status FROM public.orders WHERE order_id = v_slot.order_id) = 'Ready' THEN
        UPDATE public.orders SET status = 'Collected' WHERE order_id = v_slot.order_id;
        INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by)
        VALUES (v_slot.order_id, 'Ready', 'Collected', v_shelf_staff);
      END IF;
      v_events := v_events || jsonb_build_object('event', 'collected', 'slot', v_r.slot,
        'order_number', (SELECT order_number FROM public.orders WHERE order_id = v_slot.order_id));
      UPDATE public.shelf_slots SET order_id = NULL, assigned_at = NULL, placed_at = NULL WHERE slot_no = v_r.slot;
    END IF;
    UPDATE public.shelf_slots SET weight_g = v_r.w, last_reading_at = now() WHERE slot_no = v_r.slot;
  END LOOP;

  -- Privacy and storage: raw readings are kept for 24 hours only.
  DELETE FROM public.sensor_readings WHERE recorded_at < now() - interval '24 hours';

  RETURN jsonb_build_object('events', v_events, 'slots', (
    SELECT jsonb_agg(jsonb_build_object('slot', s.slot_no, 'has_order', s.order_id IS NOT NULL,
      'order_number', o.order_number, 'placed', s.placed_at IS NOT NULL, 'weight_g', s.weight_g) ORDER BY s.slot_no)
    FROM public.shelf_slots s LEFT JOIN public.orders o ON o.order_id = s.order_id WHERE s.device_id = p_device_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_shelf_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._cafe_require_staff();
  RETURN jsonb_build_object(
    'device_online', coalesce((SELECT max(last_reading_at) > now() - interval '15 seconds' FROM public.shelf_slots), false),
    'last_reading_at', (SELECT max(last_reading_at) FROM public.shelf_slots),
    'readings_last_hour', (SELECT count(*) FROM public.sensor_readings WHERE recorded_at > now() - interval '1 hour'),
    'slots', (SELECT jsonb_agg(jsonb_build_object('slot', s.slot_no, 'weight_g', s.weight_g,
        'order_number', o.order_number, 'customer_first_name', o.customer_first_name,
        'assigned_at', s.assigned_at, 'placed_at', s.placed_at, 'last_reading_at', s.last_reading_at) ORDER BY s.slot_no)
      FROM public.shelf_slots s LEFT JOIN public.orders o ON o.order_id = s.order_id),
    'recent', (SELECT coalesce(jsonb_agg(r ORDER BY r.recorded_at), '[]'::jsonb) FROM (
      SELECT slot_no, weight_g, recorded_at FROM public.sensor_readings
      WHERE recorded_at > now() - interval '2 minutes' ORDER BY recorded_at DESC LIMIT 240) r)
  );
END;
$$;

-- 3. Manager statistics ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cafe_manager_stats(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users; v_from timestamptz;
BEGIN
  v_staff := public._cafe_require_staff();
  IF v_staff.role <> 'manager' THEN RAISE EXCEPTION 'Manager access is required.'; END IF;
  v_from := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)));
  RETURN jsonb_build_object(
    'period_days', greatest(1, least(coalesce(p_days, 90), 365)),
    'totals', (SELECT jsonb_build_object('orders', count(DISTINCT o.order_id),
        'revenue', coalesce(sum(i.quantity * i.unit_price), 0),
        'items', coalesce(sum(i.quantity), 0),
        'avg_order_value', round(coalesce(sum(i.quantity * i.unit_price), 0) / nullif(count(DISTINCT o.order_id), 0)))
      FROM public.orders o LEFT JOIN public.order_items i ON i.order_id = o.order_id WHERE o.created_at >= v_from),
    'by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'orders', n) ORDER BY h), '[]'::jsonb) FROM (
        SELECT extract(hour FROM created_at AT TIME ZONE 'Asia/Almaty')::integer h, count(*) n
        FROM public.orders WHERE created_at >= v_from GROUP BY 1) t),
    'by_day', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'orders', n, 'revenue', rev) ORDER BY d), '[]'::jsonb) FROM (
        SELECT (o.created_at AT TIME ZONE 'Asia/Almaty')::date d, count(DISTINCT o.order_id) n, coalesce(sum(i.quantity * i.unit_price), 0) rev
        FROM public.orders o LEFT JOIN public.order_items i ON i.order_id = o.order_id
        WHERE o.created_at >= v_from GROUP BY 1) t),
    'top_items', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', q, 'revenue', rev) ORDER BY q DESC, name), '[]'::jsonb) FROM (
        SELECT m.name, sum(i.quantity) q, sum(i.quantity * i.unit_price) rev
        FROM public.order_items i JOIN public.orders o ON o.order_id = i.order_id JOIN public.menu_items m ON m.item_id = i.item_id
        WHERE o.created_at >= v_from GROUP BY m.name ORDER BY q DESC, m.name LIMIT 8) t),
    'by_category', (SELECT coalesce(jsonb_agg(jsonb_build_object('category', name, 'revenue', rev, 'quantity', q) ORDER BY rev DESC), '[]'::jsonb) FROM (
        SELECT c.name, sum(i.quantity * i.unit_price) rev, sum(i.quantity) q
        FROM public.order_items i JOIN public.orders o ON o.order_id = i.order_id
        JOIN public.menu_items m ON m.item_id = i.item_id JOIN public.categories c ON c.category_id = m.category_id
        WHERE o.created_at >= v_from GROUP BY c.name) t),
    'stage_minutes', (SELECT jsonb_build_object(
        'received_to_preparing', round(avg(extract(epoch FROM p - r) / 60)::numeric, 1),
        'preparing_to_ready', round(avg(extract(epoch FROM y - p) / 60)::numeric, 1),
        'ready_to_collected', round(avg(extract(epoch FROM c - y) / 60)::numeric, 1))
      FROM (SELECT h.order_id,
          max(h.changed_at) FILTER (WHERE h.new_status = 'Received') r, max(h.changed_at) FILTER (WHERE h.new_status = 'Preparing') p,
          max(h.changed_at) FILTER (WHERE h.new_status = 'Ready') y, max(h.changed_at) FILTER (WHERE h.new_status = 'Collected') c
        FROM public.order_status_history h JOIN public.orders o ON o.order_id = h.order_id
        WHERE o.created_at >= v_from GROUP BY h.order_id) s),
    'avg_prep_minutes', public._cafe_avg_prep_minutes()
  );
END;
$$;

-- 5. Manager price editing --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cafe_set_price(p_item_id integer, p_price numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users;
BEGIN
  v_staff := public._cafe_require_staff();
  IF v_staff.role <> 'manager' THEN RAISE EXCEPTION 'Manager access is required.'; END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 100 AND 20000 OR p_price <> round(p_price) THEN
    RAISE EXCEPTION 'Enter a whole price between 100 and 20,000 KZT.';
  END IF;
  UPDATE public.menu_items SET price = p_price WHERE item_id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found.'; END IF;
END;
$$;

-- Grants: helpers stay private; each browser role gets only what it needs.
REVOKE ALL ON FUNCTION public._cafe_order_json2(integer), public._cafe_avg_prep_minutes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_queue_info(), public.cafe_place_order_v2(text, jsonb, uuid, text, integer),
  public.cafe_track_order_v2(uuid), public.cafe_staff_orders_v2(), public.cafe_advance_order_v2(integer, text),
  public.cafe_sensor_report(text, text, jsonb), public.cafe_shelf_status(), public.cafe_manager_stats(integer),
  public.cafe_set_price(integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_queue_info(), public.cafe_place_order_v2(text, jsonb, uuid, text, integer),
  public.cafe_track_order_v2(uuid), public.cafe_sensor_report(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_staff_orders_v2(), public.cafe_advance_order_v2(integer, text),
  public.cafe_shelf_status(), public.cafe_manager_stats(integer), public.cafe_set_price(integer, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Column for marking generated test data (applied separately on 28 Oct 2026)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
