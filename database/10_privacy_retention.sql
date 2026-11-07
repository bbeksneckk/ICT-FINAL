-- Corner Café: privacy retention (Final Project).
-- Customer first names and notes are kept for 90 days, then replaced.
-- Raw shelf readings are kept for 24 hours.
-- The job runs every night at 03:00 Astana time (22:00 UTC) with pg_cron.

CREATE OR REPLACE FUNCTION public._cafe_privacy_cleanup()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.orders
     SET customer_first_name = 'Guest', customer_note = NULL
   WHERE created_at < now() - interval '90 days'
     AND status = 'Collected'
     AND (customer_first_name <> 'Guest' OR customer_note IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.order_feedback f SET comment = NULL
    FROM public.orders o
   WHERE o.order_id = f.order_id AND o.created_at < now() - interval '90 days' AND f.comment IS NOT NULL;

  DELETE FROM public.sensor_readings WHERE recorded_at < now() - interval '24 hours';
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public._cafe_privacy_cleanup() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cafe-privacy-cleanup', '0 22 * * *', 'SELECT public._cafe_privacy_cleanup()');
