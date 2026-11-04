-- Corner Café, Project Stage 2: customer ratings, public pickup screen and "often ordered now" picks.
-- Run after 06_insights_and_test_lab.sql.

-- 1. One rating per collected order (1-5 stars and an optional short comment).
CREATE TABLE IF NOT EXISTS public.order_feedback (
  order_id   integer PRIMARY KEY REFERENCES public.orders(order_id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_feedback FROM anon, authenticated;

-- The customer proves the order is theirs with the private order token from the order link.
CREATE OR REPLACE FUNCTION public.cafe_submit_feedback(p_token uuid, p_rating integer, p_comment text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_order public.orders; v_comment text := nullif(btrim(p_comment), ''); v_collected timestamptz;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE status_token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'We could not find that order.'; END IF;
  IF v_order.status <> 'Collected' THEN RAISE EXCEPTION 'You can rate the order after you collect it.'; END IF;
  SELECT max(changed_at) INTO v_collected FROM public.order_status_history WHERE order_id = v_order.order_id AND new_status = 'Collected';
  IF v_collected < now() - interval '7 days' THEN RAISE EXCEPTION 'Ratings are open for 7 days after pickup.'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Choose from 1 to 5 stars.'; END IF;
  IF v_comment IS NOT NULL AND char_length(v_comment) > 200 THEN RAISE EXCEPTION 'The comment can have up to 200 characters.'; END IF;
  INSERT INTO public.order_feedback (order_id, rating, comment) VALUES (v_order.order_id, p_rating, v_comment)
  ON CONFLICT (order_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = now();
  RETURN jsonb_build_object('rating', p_rating, 'comment', v_comment);
END;
$function$;

-- Order JSON now also carries the rating (used by the order page and the staff board).
CREATE OR REPLACE FUNCTION public._cafe_order_json2(p_order_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public._cafe_order_json(o.order_id) || jsonb_build_object(
    'pickup_at', o.pickup_at,
    'customer_note', o.customer_note,
    'shelf_slot', (SELECT s.slot_no FROM public.shelf_slots s WHERE s.order_id = o.order_id),
    'on_shelf', (SELECT s.placed_at IS NOT NULL FROM public.shelf_slots s WHERE s.order_id = o.order_id),
    'feedback', (SELECT jsonb_build_object('rating', f.rating, 'comment', f.comment) FROM public.order_feedback f WHERE f.order_id = o.order_id),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('new_status', h.new_status,
      'changed_at', h.changed_at, 'changed_by', st.display_name) ORDER BY h.history_id), '[]'::jsonb)
      FROM public.order_status_history h LEFT JOIN public.staff_users st ON st.staff_id = h.changed_by
      WHERE h.order_id = o.order_id)
  ) FROM public.orders o WHERE o.order_id = p_order_id;
$function$;

-- Manager only: rating summary for the Insights tab.
CREATE OR REPLACE FUNCTION public.cafe_manager_feedback(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_staff public.staff_users; v_days integer := greatest(1, least(coalesce(p_days, 30), 365)); v_from timestamptz;
BEGIN
  v_staff := public._cafe_require_staff();
  IF v_staff.role <> 'manager' THEN RAISE EXCEPTION 'Manager access is required.'; END IF;
  v_from := now() - make_interval(days => v_days);
  RETURN jsonb_build_object(
    'period_days', v_days,
    'count', (SELECT count(*) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from),
    'collected', (SELECT count(*) FROM public.orders o WHERE o.status = 'Collected' AND o.created_at >= v_from),
    'avg_rating', (SELECT round(avg(f.rating)::numeric, 1) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from),
    'by_rating', (SELECT jsonb_agg(jsonb_build_object('rating', g, 'n',
        (SELECT count(*) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from AND f.rating = g)) ORDER BY g)
      FROM generate_series(1, 5) g),
    'recent', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_number', t.order_number, 'rating', t.rating, 'comment', t.comment, 'at', t.updated_at) ORDER BY t.updated_at DESC), '[]'::jsonb)
      FROM (SELECT o.order_number, f.rating, f.comment, f.updated_at FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id
            WHERE o.created_at >= v_from AND f.comment IS NOT NULL ORDER BY f.updated_at DESC LIMIT 6) t)
  );
END;
$function$;

-- 2. Public pickup screen: order numbers and shelf numbers only, no names or items.
CREATE OR REPLACE FUNCTION public.cafe_public_board()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'in_progress', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'status', o.status) ORDER BY o.order_number), '[]'::jsonb)
      FROM public.orders o WHERE o.status IN ('Received', 'Preparing') AND o.created_at > now() - interval '12 hours'),
    'ready', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_number', o.order_number, 'shelf_slot', s.slot_no,
        'ready_at', (SELECT max(h.changed_at) FROM public.order_status_history h WHERE h.order_id = o.order_id AND h.new_status = 'Ready')) ORDER BY o.order_number), '[]'::jsonb)
      FROM public.orders o LEFT JOIN public.shelf_slots s ON s.order_id = o.order_id
      WHERE o.status = 'Ready' AND o.created_at > now() - interval '12 hours'),
    'avg_prep_minutes', public._cafe_avg_prep_minutes(),
    'server_time', now()
  );
$function$;

-- 3. Public insights also suggest what people often order around the current hour.
CREATE OR REPLACE FUNCTION public.cafe_public_insights()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH recent AS (SELECT order_id, created_at FROM public.orders WHERE created_at >= now() - interval '21 days'),
  days AS (SELECT greatest(1, count(DISTINCT (created_at AT TIME ZONE 'Asia/Almaty')::date)) n FROM recent),
  now_hour AS (SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Almaty')::integer h)
  SELECT jsonb_build_object(
    'popular_item_ids', (SELECT coalesce(jsonb_agg(item_id ORDER BY q DESC, item_id), '[]'::jsonb) FROM (
        SELECT i.item_id, sum(i.quantity) q FROM public.order_items i JOIN recent r ON r.order_id = i.order_id
        JOIN public.menu_items m ON m.item_id = i.item_id WHERE m.is_available
        GROUP BY i.item_id ORDER BY q DESC, i.item_id LIMIT 5) t),
    'avg_orders_by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'avg_orders', round(cnt::numeric / (SELECT n FROM days), 1)) ORDER BY h), '[]'::jsonb) FROM (
        SELECT g.h, count(r.order_id) cnt FROM generate_series(8, 20) g(h)
        LEFT JOIN recent r ON extract(hour FROM r.created_at AT TIME ZONE 'Asia/Almaty') = g.h GROUP BY g.h) t),
    'now_hour', (SELECT h FROM now_hour),
    'now_picks', (SELECT coalesce(jsonb_agg(item_id ORDER BY q DESC, item_id), '[]'::jsonb) FROM (
        SELECT i.item_id, sum(i.quantity) q FROM public.order_items i JOIN recent r ON r.order_id = i.order_id
        JOIN public.menu_items m ON m.item_id = i.item_id
        WHERE m.is_available AND abs(extract(hour FROM r.created_at AT TIME ZONE 'Asia/Almaty') - (SELECT h FROM now_hour)) <= 1
        GROUP BY i.item_id HAVING sum(i.quantity) >= 2 ORDER BY q DESC, i.item_id LIMIT 3) t),
    'days_counted', (SELECT n FROM days)
  );
$function$;

REVOKE ALL ON FUNCTION public.cafe_submit_feedback(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cafe_manager_feedback(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cafe_public_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cafe_submit_feedback(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_manager_feedback(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_public_board() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_public_insights() TO anon, authenticated;
