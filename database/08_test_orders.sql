-- Corner Café, Project Stage 2: orders from automated tests ("Load test" from the Test lab,
-- "QA test" from the QA run) are marked as test data, can be removed with one button,
-- and do not change the ratings statistics or the average preparation time.
-- Run after 07_feedback_screen_picks.sql.

CREATE OR REPLACE FUNCTION public._cafe_avg_prep_minutes()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- average minutes from Received to Ready over the last 200 ready orders,
  -- leaving out orders placed by automated tests (Load test / QA test)
  SELECT coalesce(round(avg(extract(epoch FROM y.changed_at - r.changed_at) / 60)::numeric, 1), 10)
  FROM (SELECT h.order_id FROM public.order_status_history h JOIN public.orders o ON o.order_id = h.order_id
        WHERE h.new_status = 'Ready' AND lower(btrim(o.customer_first_name)) NOT IN ('load test', 'qa test')
        ORDER BY h.changed_at DESC LIMIT 200) last
  JOIN public.order_status_history r ON r.order_id = last.order_id AND r.new_status = 'Received'
  JOIN public.order_status_history y ON y.order_id = last.order_id AND y.new_status = 'Ready'
  WHERE y.changed_at - r.changed_at <= interval '60 minutes';
$function$;

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
    is_test_data = (lower(btrim(p_name)) IN ('load test', 'qa test'))
  WHERE order_id = v_order_id AND status = 'Received';
  RETURN public._cafe_order_json2(v_order_id) || jsonb_build_object('queue', public.cafe_queue_info());
END;
$function$;

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
  WHERE order_id IN (SELECT order_id FROM public.orders WHERE is_test_data AND lower(customer_first_name) IN ('load test', 'qa test'));
  DELETE FROM public.orders WHERE is_test_data AND lower(customer_first_name) IN ('load test', 'qa test');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

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
  -- ratings on test orders (Load test / QA test) are left out of the statistics and counted separately
  RETURN jsonb_build_object(
    'period_days', v_days,
    'count', (SELECT count(*) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from AND NOT o.is_test_data),
    'test_ratings', (SELECT count(*) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from AND o.is_test_data),
    'collected', (SELECT count(*) FROM public.orders o WHERE o.status = 'Collected' AND o.created_at >= v_from AND NOT o.is_test_data),
    'avg_rating', (SELECT round(avg(f.rating)::numeric, 1) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from AND NOT o.is_test_data),
    'by_rating', (SELECT jsonb_agg(jsonb_build_object('rating', g, 'n',
        (SELECT count(*) FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id WHERE o.created_at >= v_from AND NOT o.is_test_data AND f.rating = g)) ORDER BY g)
      FROM generate_series(1, 5) g),
    'recent', (SELECT coalesce(jsonb_agg(jsonb_build_object('order_number', t.order_number, 'rating', t.rating, 'comment', t.comment, 'at', t.updated_at) ORDER BY t.updated_at DESC), '[]'::jsonb)
      FROM (SELECT o.order_number, f.rating, f.comment, f.updated_at FROM public.order_feedback f JOIN public.orders o ON o.order_id = f.order_id
            WHERE o.created_at >= v_from AND NOT o.is_test_data AND f.comment IS NOT NULL ORDER BY f.updated_at DESC LIMIT 6) t)
  );
END;
$function$;

-- orders placed by the QA run before this change
UPDATE public.orders SET is_test_data = true WHERE lower(btrim(customer_first_name)) IN ('qa test', 'load test') AND NOT is_test_data;
