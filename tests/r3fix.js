const { chromium } = require('playwright');
const SB = 'https://ovzxxevqqvqfaeewskdm.supabase.co', BASE = 'http://127.0.0.1:8766/';
(async () => {
  const b = await chromium.launch(); const errors = [];
  // 1) live mode, slow menu: the saved cart must say "loading" instead of "no longer on the menu"
  const ctx = await b.newContext({ serviceWorkers: 'block' });
  const menu = await (async () => { const p = await ctx.newPage(); await p.goto(BASE + 'poster.html'); await p.addScriptTag({ url: BASE + 'js/demo-data.js' }); const d = await p.evaluate(() => window.CAFE_DEMO_DATA); await p.close(); return d; })();
  await ctx.addInitScript(() => { localStorage.setItem('cafe.mode', '"supabase"'); localStorage.setItem('cafe.cart', JSON.stringify([{ item_id: 3, quantity: 1 }, { item_id: 40, quantity: 1 }])); });
  await ctx.route(SB + '/**', async r => { const fn = r.request().url().split('/rpc/')[1];
    if (fn === 'cafe_get_menu') { await new Promise(res => setTimeout(res, 2500)); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(menu) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: fn === 'cafe_queue_info' ? '{"active_orders":0,"avg_prep_minutes":17,"estimated_wait_minutes":17}' : '{}' }); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(800);
  console.log('while loading:', (await p.textContent('#cartItems')).replace(/\s+/g, ' ').slice(0, 80), '| total', await p.textContent('#cartTotal'));
  await p.waitForSelector('.dish'); await p.waitForTimeout(200);
  console.log('after load:', (await p.textContent('#cartItems')).replace(/\s+/g, ' ').slice(0, 80), '| total', await p.textContent('#cartTotal'));
  // 2) demo: a rating on a QA test order is not counted, and the card says so
  const d = await b.newContext(); await d.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const c = await d.newPage(); c.on('pageerror', e => errors.push(e.message));
  await c.goto(BASE); await c.waitForSelector('.dish');
  await c.click('#menuGrid button[aria-label="Add Latte to your order"]'); await c.fill('#customerName', 'QA test'); await c.click('#checkoutButton'); await c.waitForSelector('.order-ticket');
  const num = (await c.textContent('.ot-number')).replace('#', '');
  const s = await d.newPage(); await s.goto(BASE + '#staff'); await s.click('text=Open the demo counter'); await s.waitForSelector('.slip');
  for (const t of ['Start preparing', 'Mark as ready', 'Mark as collected']) { await s.click(`.slip:has-text("#${num}") >> text=${t}`); await s.waitForTimeout(300); }
  await c.click('text=Refresh'); await c.waitForSelector('.rate'); await c.click('.stars label:nth-child(4)'); await c.click('.rate button[type=submit]'); await c.waitForTimeout(300);
  await s.click('#tab-insights'); await s.waitForSelector('.ratings');
  console.log('insights:', (await s.textContent('.ratings-score')).replace(/\s+/g, ' '));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
