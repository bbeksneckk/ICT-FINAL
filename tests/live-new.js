// Live (Supabase) mode with a mocked backend: checks the requests of the new features.
const { chromium } = require('playwright');
const SB = 'https://ovzxxevqqvqfaeewskdm.supabase.co';
const BASE = 'http://127.0.0.1:8766/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('cafe.mode', '"supabase"'));
  const log = [], errors = [];
  const menu = await (async () => { const p = await ctx.newPage(); await p.goto(BASE + 'poster.html'); await p.addScriptTag({ url: BASE + 'js/demo-data.js' }); const d = await p.evaluate(() => window.CAFE_DEMO_DATA); await p.close(); return d; })();
  const now = new Date().toISOString();
  const tok = '11111111-2222-4333-8444-555555555555';
  let feedback = null;
  const order = { order_id: 151, order_number: 1151, customer_first_name: 'Dana', status: 'Collected', created_at: now, total_price: 2600,
    items: [{ item_id: 4, name: 'Latte', quantity: 1, unit_price: 1500 }, { item_id: 2, name: 'Americano', quantity: 1, unit_price: 1100 }],
    history: ['Received', 'Preparing', 'Ready', 'Collected'].map((s, i) => ({ new_status: s, changed_at: now, changed_by: i ? 'Aigerim' : null })),
    pickup_at: null, customer_note: null, shelf_slot: null, on_shelf: null };
  await ctx.route(SB + '/**', async route => {
    const req = route.request(); const url = req.url().replace(SB, ''); const h = req.headers();
    let body = null; try { body = req.postDataJSON(); } catch {}
    log.push(`${req.method()} ${url} apikey=${h.apikey ? 'yes' : 'NO'} auth=${h.authorization ? h.authorization.slice(0, 18) : '-'} body=${JSON.stringify(body)}`);
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.startsWith('/auth/v1/token?grant_type=password')) return json({ access_token: 'jwt-abc', refresh_token: 'r1', expires_in: 3600, token_type: 'bearer' });
    if (url.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    const fn = url.replace('/rest/v1/rpc/', '');
    if (fn === 'cafe_get_menu') return json({ categories: menu.categories, menu: menu.menu });
    if (fn === 'cafe_queue_info') return json({ active_orders: 2, avg_prep_minutes: 17.0, estimated_wait_minutes: 21 });
    if (fn === 'cafe_public_insights') return json({ popular_item_ids: [9, 10, 18], avg_orders_by_hour: [{ hour: 8, avg_orders: 1 }, { hour: 16, avg_orders: 0.5 }], now_hour: 16, now_picks: [2, 9, 5], days_counted: 21 });
    if (fn === 'cafe_public_board') return json({ in_progress: [{ order_number: 1152, status: 'Received' }, { order_number: 1153, status: 'Preparing' }], ready: [{ order_number: 1150, shelf_slot: 3, ready_at: now }], avg_prep_minutes: 17.0, server_time: now });
    if (fn === 'cafe_track_order_v2') return json({ ...order, feedback, orders_ahead: 0, avg_prep_minutes: 17.0 });
    if (fn === 'cafe_submit_feedback') {
      if (body.p_rating === 2 && body.p_comment === 'fail') return json({ code: 'P0001', message: 'Ratings are open for 7 days after pickup.' }, 400);
      feedback = { rating: body.p_rating, comment: body.p_comment }; return json(feedback);
    }
    if (fn === 'cafe_staff_profile') return json({ staff_id: 1, display_name: 'Aigerim', role: 'manager' });
    if (fn === 'cafe_staff_orders_v2') return json([{ ...order, feedback }]);
    if (fn === 'cafe_manager_stats') return json({ period_days: 30, totals: { orders: 148, revenue: 511600, items: 300, avg_order_value: 3457 }, by_hour: [{ hour: 8, orders: 20 }], by_day: [{ day: '2026-10-27', orders: 8, revenue: 28000 }], top_items: [{ name: 'Mint Tea', quantity: 24, revenue: 24000 }], by_category: [], stage_minutes: { received_to_preparing: 3.9, preparing_to_ready: 13.1, ready_to_collected: 8.7 }, avg_prep_minutes: 17.0 });
    if (fn === 'cafe_manager_feedback') return json({ period_days: body.p_days, count: 1, collected: 148, avg_rating: 4.0, by_rating: [1, 2, 3, 4, 5].map(r => ({ rating: r, n: r === 4 ? 1 : 0 })), recent: [{ order_number: 1151, rating: 4, comment: 'Good', at: now }] });
    return json({ code: 'PGRST202', message: 'not mocked' }, 404);
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE); await page.waitForSelector('.dish'); await page.waitForTimeout(500);
  console.log('picks:', (await page.textContent('#nowPicks')).replace(/\s+/g, ' '));
  await page.goto(BASE + '#order/' + tok); await page.waitForSelector('.rate');
  await page.click('.stars label:nth-child(2)'); await page.fill('#rateComment', 'fail'); await page.click('.rate button[type=submit]'); await page.waitForTimeout(300);
  console.log('error shown:', await page.textContent('.rate .field-msg'));
  await page.click('.stars label:nth-child(5)'); await page.fill('#rateComment', '  Great latte  '); await page.click('.rate button[type=submit]'); await page.waitForTimeout(300);
  console.log('done:', (await page.textContent('.rate')).replace(/\s+/g, ' '));
  // screen
  const tv = await ctx.newPage(); tv.on('pageerror', e => errors.push('tv ' + e.message));
  await tv.goto(BASE + 'screen.html'); await tv.waitForTimeout(800);
  console.log('screen:', (await tv.textContent('.tv-cols')).replace(/\s+/g, ' '), '| wait', await tv.textContent('#tvWait'), '| demo label hidden', await tv.isHidden('#tvDemo'));
  // staff insights
  await page.goto(BASE + '#staff'); await page.waitForSelector('#staffEmail');
  await page.fill('#staffEmail', 'manager@cafe.kz'); await page.fill('#staffPassword', 'x'); await page.click('form >> text=Sign in');
  await page.waitForSelector('.collected-list'); console.log('collected row:', (await page.textContent('.collected-list tbody tr')).replace(/\s+/g, ' '));
  await page.click('#tab-insights'); await page.waitForSelector('.ratings');
  console.log('ratings:', (await page.textContent('.ratings')).replace(/\s+/g, ' ').slice(0, 200));
  console.log('REQUESTS'); log.filter(l => /feedback|board|insights/.test(l)).forEach(l => console.log('  ' + l));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
