-- Corner Café, Project Stage 2: public insights and test lab support.
-- Run after 04_endterm_features.sql (and 05 if you want the test data).

-- Popular items and average orders per hour for the home page (no personal data).
CREATE OR REPLACE FUNCTION public.cafe_public_insights()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH recent AS (SELECT order_id, created_at FROM public.orders WHERE created_at >= now() - interval '21 days'),
  days AS (SELECT greatest(1, count(DISTINCT (created_at AT TIME ZONE 'Asia/Almaty')::date)) n FROM recent)
  SELECT jsonb_build_object(
    'popular_item_ids', (SELECT coalesce(jsonb_agg(item_id ORDER BY q DESC, item_id), '[]'::jsonb) FROM (
        SELECT i.item_id, sum(i.quantity) q FROM public.order_items i JOIN recent r ON r.order_id = i.order_id
        JOIN public.menu_items m ON m.item_id = i.item_id WHERE m.is_available
        GROUP BY i.item_id ORDER BY q DESC, i.item_id LIMIT 5) t),
    'avg_orders_by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'avg_orders', round(cnt::numeric / (SELECT n FROM days), 1)) ORDER BY h), '[]'::jsonb) FROM (
        SELECT g.h, count(r.order_id) cnt FROM generate_series(8, 20) g(h)
        LEFT JOIN recent r ON extract(hour FROM r.created_at AT TIME ZONE 'Asia/Almaty') = g.h GROUP BY g.h) t),
    'days_counted', (SELECT n FROM days)
  );
$function$;

-- Orders placed by the test lab use the name "Load test" and are marked as test data.
CREATE OR REPLACE FUNCTION public.cafe_place_order_v2(p_name text, p_items jsonb, p_token uuid, p_note text DEFAULT NULL::text, p_pickup_in_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_note text := nullif(btrim(p_note), ''); v_order_id integer;
BEGIN
  IF v_note IS NOT NULL AND char_length(v_note) > 140 THEN RAISE EXCEPTION 'The note can have up to 140 characters.'; END IF;
  IF p_pickup_in_minutes IS NOT NULL AND p_pickup_in_minutes NOT IN (15, 30, 45, 60) THEN
    RAISE EXCEPTION 'Choose a pickup time of 15, 30, 45 or 60 minutes, or as soon as possible.';
  END IF;
  v_order_id := (public.cafe_place_order(p_name, p_items, p_token)->>'order_id')::integer;
  UPDATE public.orders SET customer_note = v_note,
    pickup_at = CASE WHEN p_pickup_in_minutes IS NULL THEN NULL ELSE created_at + make_interval(mins => p_pickup_in_minutes) END,
    is_test_data = (btrim(p_name) = 'Load test')
  WHERE order_id = v_order_id AND status = 'Received';
  RETURN public._cafe_order_json2(v_order_id) || jsonb_build_object('queue', public.cafe_queue_info());
END;
$function$;

-- Manager only: remove the orders the test lab created. Real orders are not touched.
CREATE OR REPLACE FUNCTION public.cafe_clear_load_tests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_staff public.staff_users; v_count integer;
BEGIN
  v_staff := public._cafe_require_staff();
  IF v_staff.role <> 'manager' THEN RAISE EXCEPTION 'Manager access is required.'; END IF;
  UPDATE public.shelf_slots SET order_id = NULL, assigned_at = NULL, placed_at = NULL
  WHERE order_id IN (SELECT order_id FROM public.orders WHERE is_test_data AND customer_first_name = 'Load test');
  DELETE FROM public.orders WHERE is_test_data AND customer_first_name = 'Load test';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cafe_public_insights() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cafe_clear_load_tests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cafe_public_insights() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_place_order_v2(text, jsonb, uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cafe_clear_load_tests() TO authenticated;
