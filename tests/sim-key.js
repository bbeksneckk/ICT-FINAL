const { chromium } = require('playwright');
const SB = 'https://ovzxxevqqvqfaeewskdm.supabase.co', BASE = 'http://127.0.0.1:8766/', GOOD = '0123456789abcdef0123456789abcdef';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block' }); const errors = []; const sent = [];
  await ctx.addInitScript(() => localStorage.setItem('cafe.mode', '"supabase"'));
  await ctx.route(SB + '/**', r => { const body = r.request().postDataJSON(); sent.push(body.p_device_key);
    return body.p_device_key === GOOD ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], slots: [1,2,3,4].map(s => ({ slot: s, has_order: false, order_number: null, placed: false, weight_g: 0 })) }) })
      : r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'Unknown device or wrong device key.' }) }); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + 'shelf-simulator.html');
  console.log('key form visible', await p.isVisible('#keyForm'), '|', await p.textContent('#keyMsg'));
  await p.click('#runBtn'); console.log('start without key ->', await p.textContent('#keyMsg'), '| requests', sent.length);
  await p.fill('#keyInput', 'abc'); await p.click('#keyForm button[type=submit]'); console.log('short key ->', await p.textContent('#keyMsg'));
  await p.fill('#keyInput', 'ffffffffffffffffffffffffffffffff'); await p.click('#keyForm button[type=submit]');
  await p.click('#runBtn'); await p.waitForTimeout(600); console.log('wrong key ->', await p.textContent('#keyMsg'), '| button', await p.textContent('#runBtn'));
  await p.fill('#keyInput', GOOD); await p.click('#keyForm button[type=submit]');
  await p.click('#runBtn'); await p.waitForTimeout(2500); console.log('good key ->', await p.textContent('#simStatus'));
  console.log('key in page source?', (await (await p.request.get(BASE + 'js/device-config.js')).text()).includes(GOOD));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
