-- Run this in the SQL Editor of your EXISTING Assignment 3 Supabase project.
-- It preserves all existing café data, enables RLS and closes direct API access
-- to the seven tables and order_summary. The new frontend uses RPC functions.
-- The old name-only HTML form will no longer have direct INSERT/SELECT access.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cafe_staff_accounts (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id integer NOT NULL UNIQUE REFERENCES public.staff_users(staff_id) ON DELETE CASCADE
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafe_staff_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.categories, public.menu_items, public.staff_users,
  public.orders, public.order_items, public.order_status_history,
  public.cafe_staff_accounts, public.order_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.order_number_seq FROM PUBLIC, anon, authenticated;

-- Internal helpers: no direct access for browser roles.
CREATE OR REPLACE FUNCTION public._cafe_require_staff()
RETURNS public.staff_users
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users;
BEGIN
  SELECT s.* INTO v_staff FROM public.cafe_staff_accounts a
  JOIN public.staff_users s ON s.staff_id = a.staff_id
  WHERE a.auth_user_id = auth.uid() AND s.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'An active café staff account is required.'; END IF;
  RETURN v_staff;
END;
$$;

CREATE OR REPLACE FUNCTION public._cafe_order_json(p_order_id integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'order_id', o.order_id, 'order_number', o.order_number,
    'customer_first_name', o.customer_first_name, 'status', o.status, 'created_at', o.created_at,
    'total_price', (SELECT coalesce(sum(i.quantity * i.unit_price), 0) FROM public.order_items i WHERE i.order_id = o.order_id),
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', m.name,
      'quantity', i.quantity, 'unit_price', i.unit_price) ORDER BY i.item_id), '[]'::jsonb)
      FROM public.order_items i JOIN public.menu_items m ON m.item_id = i.item_id WHERE i.order_id = o.order_id),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('new_status', h.new_status,
      'changed_at', h.changed_at) ORDER BY h.history_id), '[]'::jsonb)
      FROM public.order_status_history h WHERE h.order_id = o.order_id)
  ) FROM public.orders o WHERE o.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.cafe_get_menu()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('category_id', c.category_id, 'name', c.name) ORDER BY c.category_id), '[]'::jsonb) FROM public.categories c),
    'menu', (SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', m.item_id, 'category_id', m.category_id,
      'name', m.name, 'description', m.description, 'price', m.price, 'is_available', m.is_available)
      ORDER BY m.item_id), '[]'::jsonb) FROM public.menu_items m)
  );
$$;

CREATE OR REPLACE FUNCTION public.cafe_track_order(p_token uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._cafe_order_json(o.order_id) FROM public.orders o WHERE o.status_token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.cafe_place_order(p_name text, p_items jsonb, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := btrim(p_name);
  v_order public.orders;
  v_item record;
  v_menu public.menu_items;
BEGIN
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Enter a first name between 1 and 50 characters.';
  END IF;
  IF p_token IS NULL THEN RAISE EXCEPTION 'An order request token is required.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'The cart must be an array.'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Choose between 1 and 40 different menu items.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) <> 'object'
      OR coalesce(jsonb_typeof(x->'item_id'), '') <> 'number'
      OR coalesce(jsonb_typeof(x->'quantity'), '') <> 'number'
      OR coalesce(x->>'item_id', '') !~ '^[1-9][0-9]{0,8}$'
      OR coalesce(x->>'quantity', '') !~ '^([1-9]|1[0-9]|20)$'
  ) THEN RAISE EXCEPTION 'Invalid cart. Quantity must be an integer between 1 and 20.'; END IF;
  IF (SELECT count(DISTINCT x->>'item_id') FROM jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'A menu item may only appear once in the cart.';
  END IF;

  -- Serialize retries with the same unguessable token, including concurrent requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_token::text, 0));
  SELECT * INTO v_order FROM public.orders WHERE status_token = p_token;
  IF FOUND THEN
    IF v_order.customer_first_name <> v_name OR
      (SELECT jsonb_agg(jsonb_build_array(i.item_id, i.quantity) ORDER BY i.item_id)
        FROM public.order_items i WHERE i.order_id = v_order.order_id) IS DISTINCT FROM
      (SELECT jsonb_agg(jsonb_build_array((x->>'item_id')::integer, (x->>'quantity')::integer) ORDER BY (x->>'item_id')::integer)
        FROM jsonb_array_elements(p_items) x) THEN
      RAISE EXCEPTION 'This request token belongs to a different cart.';
    END IF;
    RETURN public._cafe_order_json(v_order.order_id);
  END IF;

  INSERT INTO public.orders(customer_first_name, status_token) VALUES (v_name, p_token) RETURNING * INTO v_order;
  FOR v_item IN SELECT (x->>'item_id')::integer AS id, (x->>'quantity')::integer AS qty
    FROM jsonb_array_elements(p_items) x ORDER BY (x->>'item_id')::integer
  LOOP
    -- Lock price and availability until the order transaction completes.
    SELECT * INTO v_menu FROM public.menu_items WHERE item_id = v_item.id FOR SHARE;
    IF NOT FOUND OR NOT v_menu.is_available THEN RAISE EXCEPTION 'An item is no longer available. Refresh the menu and update your cart.'; END IF;
    INSERT INTO public.order_items(order_id, item_id, quantity, unit_price)
    VALUES (v_order.order_id, v_menu.item_id, v_item.qty, v_menu.price);
  END LOOP;
  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by)
  VALUES (v_order.order_id, NULL, 'Received', NULL);
  RETURN public._cafe_order_json(v_order.order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_staff_profile()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users;
BEGIN
  v_staff := public._cafe_require_staff();
  RETURN jsonb_build_object('staff_id', v_staff.staff_id, 'display_name', v_staff.display_name, 'role', v_staff.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_staff_orders()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._cafe_require_staff();
  RETURN (SELECT coalesce(jsonb_agg(public._cafe_order_json(q.order_id) ORDER BY q.order_number DESC), '[]'::jsonb)
    FROM (
      SELECT order_id, order_number FROM public.orders WHERE status <> 'Collected'
      UNION ALL
      (SELECT order_id, order_number FROM public.orders WHERE status = 'Collected' ORDER BY order_number DESC LIMIT 30)
    ) q);
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_advance_order(p_order_id integer, p_expected_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users; v_order public.orders; v_next text;
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
  RETURN public._cafe_order_json(p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cafe_set_availability(p_item_id integer, p_available boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_staff public.staff_users;
BEGIN
  v_staff := public._cafe_require_staff();
  IF v_staff.role <> 'manager' THEN RAISE EXCEPTION 'Manager access is required.'; END IF;
  IF p_available IS NULL THEN RAISE EXCEPTION 'Availability is required.'; END IF;
  UPDATE public.menu_items SET is_available = p_available WHERE item_id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found.'; END IF;
END;
$$;

-- Scope grants to the functions owned by this prototype.
REVOKE ALL ON FUNCTION public._cafe_require_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cafe_order_json(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_get_menu() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_track_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_place_order(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_staff_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_staff_orders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_advance_order(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafe_set_availability(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_get_menu(), public.cafe_track_order(uuid),
  public.cafe_place_order(text, jsonb, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_staff_profile(), public.cafe_staff_orders(),
  public.cafe_advance_order(integer, text), public.cafe_set_availability(integer, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
