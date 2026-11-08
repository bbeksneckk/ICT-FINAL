-- Corner Café, Project Stage 2: the waiting-time estimate counts only real orders.
-- Test orders (is_test_data) and orders older than 12 hours that were never finished
-- do not make the estimate longer. Run after 08_test_orders.sql.

CREATE OR REPLACE FUNCTION public._cafe_active_queue_count(p_before timestamptz DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*) FROM public.orders a
  WHERE a.status IN ('Received', 'Preparing') AND NOT a.is_test_data
    AND a.created_at > now() - interval '12 hours'
    AND (p_before IS NULL OR a.created_at < p_before);
$function$;
REVOKE ALL ON FUNCTION public._cafe_active_queue_count(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cafe_queue_info()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'active_orders', public._cafe_active_queue_count(),
    'avg_prep_minutes', public._cafe_avg_prep_minutes(),
    'estimated_wait_minutes', ceil(public._cafe_avg_prep_minutes() + 2 * public._cafe_active_queue_count())
  );
$function$;

CREATE OR REPLACE FUNCTION public.cafe_track_order_v2(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public._cafe_order_json2(o.order_id) || jsonb_build_object(
    'orders_ahead', public._cafe_active_queue_count(o.created_at),
    'avg_prep_minutes', public._cafe_avg_prep_minutes())
  FROM public.orders o WHERE o.status_token = p_token;
$function$;
