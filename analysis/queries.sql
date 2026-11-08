-- Corner Café: data analysis queries (Project Stage 2, Part C).
-- Run in the Supabase SQL Editor. Times are shown in Astana time (UTC+5).
-- The filter created_at < '2026-10-28' keeps the data set the charts were made from
-- (147 generated test orders, 7–27 October 2026). Remove it to include newer orders,
-- or add "AND NOT o.is_test_data" to look at real orders only.

-- Q1. At which hours of the day do customers order most?  (chart C1)
SELECT extract(hour FROM created_at AT TIME ZONE 'Asia/Almaty')::int AS hour_of_day,
       count(*) AS orders
FROM orders
WHERE created_at < '2026-10-28'
GROUP BY hour_of_day
ORDER BY hour_of_day;

-- Same question grouped by day of the week (1 = Monday).
SELECT extract(isodow FROM created_at AT TIME ZONE 'Asia/Almaty')::int AS weekday,
       count(*) AS orders
FROM orders
WHERE created_at < '2026-10-28'
GROUP BY weekday
ORDER BY weekday;

-- Q2. Which menu items are ordered most often?  (chart C2)
SELECT m.name AS item, c.name AS category,
       sum(oi.quantity) AS portions,
       sum(oi.quantity * oi.unit_price) AS revenue_kzt
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
JOIN menu_items m ON m.item_id = oi.item_id
JOIN categories c ON c.category_id = m.category_id
WHERE o.created_at < '2026-10-28'
GROUP BY m.name, c.name
ORDER BY portions DESC, revenue_kzt DESC
LIMIT 10;

-- Q3. How long does an order take from Received to Ready, by hour?  (chart C3)
WITH stages AS (
  SELECT o.order_id,
         extract(hour FROM o.created_at AT TIME ZONE 'Asia/Almaty')::int AS hour_of_day,
         max(h.changed_at) FILTER (WHERE h.new_status = 'Received')  AS received,
         max(h.changed_at) FILTER (WHERE h.new_status = 'Preparing') AS preparing,
         max(h.changed_at) FILTER (WHERE h.new_status = 'Ready')     AS ready
  FROM orders o JOIN order_status_history h ON h.order_id = o.order_id
  WHERE o.created_at < '2026-10-28'
  GROUP BY o.order_id, hour_of_day)
SELECT hour_of_day, count(*) AS orders,
       round(avg(extract(epoch FROM preparing - received) / 60)::numeric, 1) AS wait_to_start_min,
       round(avg(extract(epoch FROM ready - preparing) / 60)::numeric, 1)    AS preparing_min,
       round(avg(extract(epoch FROM ready - received) / 60)::numeric, 1)     AS order_to_ready_min
FROM stages WHERE ready IS NOT NULL
GROUP BY hour_of_day ORDER BY hour_of_day;
