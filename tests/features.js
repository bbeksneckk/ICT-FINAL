// Checks the new features in demo mode: picks, rating, ratings in Insights, pickup screen, poster, PWA.
// Usage: node features.js <outDir>
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:8766/';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); }); };
  const shot = (p, name, full) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!full });

  const page = await ctx.newPage(); watch(page, 'customer');
  await page.goto(BASE); await page.waitForSelector('.dish'); await page.waitForTimeout(600);
  console.log('picks visible', await page.isVisible('#nowPicks'), '|', (await page.textContent('#nowPicks').catch(() => '')).slice(0, 120));
  if (await page.isVisible('#nowPicks')) {
    await page.locator('#nowPicks .add').first().click(); await page.waitForTimeout(200);
    console.log('after pick add, cart count', await page.textContent('#cartCount'), '| pick shows', await page.textContent('#nowPicks .pick-in').catch(() => 'none'));
    await page.locator('#nowPicks').scrollIntoViewIfNeeded(); await shot(page, 'f01-picks');
  }
  await page.click('button[aria-label="Add Latte to your order"]');
  await page.fill('#customerName', 'Madi'); await page.click('#checkoutButton');
  await page.waitForSelector('.order-ticket');
  const num = (await page.textContent('.ot-number')).replace('#', '');

  // staff moves it to collected
  const staff = await ctx.newPage(); watch(staff, 'staff');
  await staff.goto(BASE + '#staff'); await staff.click('text=Open the demo counter'); await staff.waitForSelector('.slip');
  const slip = `.slip:has-text("#${num}")`;
  for (const t of ['Start preparing', 'Mark as ready']) { await staff.click(`${slip} >> text=${t}`); await staff.waitForTimeout(400); }

  // pickup screen shows it as ready
  const tv = await ctx.newPage(); watch(tv, 'screen');
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.goto(BASE + 'screen.html'); await tv.waitForTimeout(800);
  console.log('screen ready list', (await tv.textContent('#tvReady')).replace(/\s+/g, ' ').slice(0, 120));
  console.log('screen progress list', (await tv.textContent('#tvProgress')).replace(/\s+/g, ' ').slice(0, 120), '| wait', await tv.textContent('#tvWait'));
  await shot(tv, 'f05-screen');
  const tvOverflow = await tv.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
  console.log('screen overflow x,y', tvOverflow);
  await tv.locator('#tvQr').screenshot({ path: `${OUT}/f05-screen-qr.png` });

  await staff.click(`${slip} >> text=Mark as collected`); await staff.waitForTimeout(400);
  await page.click('text=Refresh'); await page.waitForSelector('.rate');
  console.log('rate block', (await page.textContent('.rate')).replace(/\s+/g, ' ').slice(0, 80));
  console.log('send disabled before star', await page.isDisabled('.rate button[type=submit]'));
  await page.click('.stars label:nth-child(4)');
  await page.fill('#rateComment', 'Quick and warm, thank you');
  await page.locator('.rate').scrollIntoViewIfNeeded(); await shot(page, 'f02-rate-form');
  await page.click('.rate button[type=submit]'); await page.waitForTimeout(400);
  console.log('rate done', (await page.textContent('.rate')).replace(/\s+/g, ' '));
  await shot(page, 'f03-rate-done');
  // reload keeps the rating
  await page.reload(); await page.waitForSelector('.rate'); console.log('after reload', (await page.textContent('.rate-title')).trim());
  // QR on the order page
  await page.click('.side-qr summary'); await page.locator('.side-qr').screenshot({ path: `${OUT}/f03-order-qr.png` });

  // staff: rating in the collected table and in Insights
  await staff.click('#tab-board'); await staff.waitForTimeout(600);
  const row = await staff.textContent(`.collected-list tr:has-text("#${num}")`);
  console.log('collected row', row.replace(/\s+/g, ' '));
  await staff.click('#tab-insights'); await staff.waitForSelector('.ratings');
  console.log('ratings card', (await staff.textContent('.ratings')).replace(/\s+/g, ' ').slice(0, 260));
  await staff.locator('.ratings').scrollIntoViewIfNeeded(); await shot(staff, 'f04-insights-ratings');
  await staff.click('#tab-menu'); await staff.waitForSelector('.admin-head');
  console.log('poster link', await staff.getAttribute('.admin-head a', 'href'), '| screen link', await staff.getAttribute('.staff-top a', 'href'));

  // poster
  const poster = await ctx.newPage(); watch(poster, 'poster');
  await poster.goto(BASE + 'poster.html'); await poster.waitForTimeout(400);
  await shot(poster, 'f06-poster', true);
  await poster.fill('#posterUrl', 'https://corner-cafe-demo.netlify.app/'); await poster.press('#posterUrl', 'Enter'); await poster.waitForTimeout(200);
  console.log('poster url text', await poster.textContent('#posterUrlText'));
  await poster.locator('#posterQr').screenshot({ path: `${OUT}/f06-poster-qr.png` });
  await poster.emulateMedia({ media: 'print' });
  await poster.pdf({ path: `${OUT}/f06-poster.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await poster.emulateMedia({ media: 'screen' });

  // PWA: manifest and service worker
  const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  console.log('manifest', man.short_name, man.icons.length, man.display);
  await page.goto(BASE); await page.waitForTimeout(1500);
  console.log('sw registered', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())));
  await page.reload(); await page.waitForTimeout(800);
  console.log('sw controls page', await page.evaluate(() => !!navigator.serviceWorker.controller));

  // dark theme rating view
  await page.goto(BASE + '#order'); await page.waitForSelector('.rate');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.locator('.order-ticket').screenshot({ path: `${OUT}/f07-dark-ticket.png` });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });

  // phones: 360 px wide
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  await m.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const mp = await m.newPage(); watch(mp, 'mobile');
  for (const [url, name] of [['', 'f08-m-home'], ['screen.html', 'f09-m-screen'], ['poster.html', 'f10-m-poster']]) {
    await mp.goto(BASE + url); await mp.waitForTimeout(700);
    console.log(name, 'overflow px', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await shot(mp, name, name !== 'f08-m-home');
  }
  // mobile order page with rating form
  await mp.goto(BASE); await mp.waitForSelector('.dish');
  const tok = await page.evaluate(() => JSON.parse(localStorage.getItem('cafe.lastToken')));
  await mp.goto(BASE + '#order/' + tok); await mp.waitForSelector('.rate'); await mp.click('.rate .link-btn');
  console.log('m order overflow px', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await mp.locator('.rate').scrollIntoViewIfNeeded(); await shot(mp, 'f11-m-rate');

  console.log('ERRORS', JSON.stringify(errors, null, 1));
  await browser.close();
})();
