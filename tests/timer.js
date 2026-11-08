const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const m = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const p = await m.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://127.0.0.1:8766/index.html?test=1'); await p.waitForSelector('.dish');
  await p.click('.test-timer button'); await p.evaluate(() => window.scrollTo(0, 900)); await p.waitForTimeout(300);
  await p.screenshot({ path: process.argv[2] + '/timer-mobile.png' });
  await p.locator('#menuGrid button.add').first().tap(); await p.locator('#menuGrid button.add').nth(1).tap();
  await p.click('#cartBarButton'); await p.waitForTimeout(400); await p.fill('#customerName', 'Tester'); await p.click('#checkoutButton');
  await p.waitForSelector('.order-ticket');
  console.log('timer result:', (await p.textContent('.test-timer')).replace(/\s+/g, ' '), '| overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
