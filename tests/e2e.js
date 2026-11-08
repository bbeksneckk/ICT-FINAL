// End-to-end check of the new site in demo mode. Usage: node e2e.js <outDir>
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:8766/';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const shot = async (p, name, full) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!full });

  await page.goto(BASE); await page.waitForSelector('.dish'); await page.waitForTimeout(400);
  await shot(page, '01-home');
  await page.click('#menuGrid button[aria-label="Add Latte to your order"]');
  await page.click('#categoryChips button:has-text("Pastries")');
  await page.click('#menuGrid button[aria-label="Add Butter Croissant to your order"]');
  await page.click('#menuGrid button[aria-label="Add one more Butter Croissant"]');
  await page.click('#pickupSeg label:has-text("15 min")');
  await page.fill('#customerNote', 'Oat milk, please');
  await page.fill('#customerName', 'Aliya');
  await page.evaluate(() => window.scrollTo(0, 560)); await page.waitForTimeout(200);
  await shot(page, '02-cart');
  console.log('cart total', await page.textContent('#cartTotal'));
  await page.click('#checkoutButton');
  await page.waitForSelector('.order-ticket'); await page.waitForTimeout(300);
  await shot(page, '03-order');
  console.log('order url', page.url().replace(BASE, ''));
  console.log('headline', await page.textContent('.ot-headline'), '|', await page.textContent('.ot-sub'));

  // staff in a second tab
  const staff = await ctx.newPage();
  staff.on('pageerror', e => errors.push('staff pageerror: ' + e.message));
  await staff.goto(BASE + '#staff'); await staff.click('text=Open the demo counter');
  await staff.waitForSelector('.slip'); await staff.waitForTimeout(300);
  await shot(staff, '04-board', true);
  const slipSel = '.slip:has-text("Aliya")';
  await staff.click(`${slipSel} >> text=Start preparing`); await staff.waitForTimeout(400);
  await staff.click(`${slipSel} >> text=Mark as ready`); await staff.waitForTimeout(400);
  console.log('ready slip tags', await staff.textContent(`${slipSel} .slip-tags`));
  await page.click('text=Refresh'); await page.waitForTimeout(400);
  await shot(page, '05-order-ready');
  console.log('customer headline', await page.textContent('.ot-headline'));

  // simulator places then lifts bag
  const sim = await ctx.newPage();
  sim.on('pageerror', e => errors.push('sim pageerror: ' + e.message));
  await sim.goto(BASE + 'shelf-simulator.html');
  await sim.uncheck('#autoMode');
  await sim.click('#runBtn'); await sim.waitForTimeout(2500);
  const myNum = (await page.textContent('.ot-number')).replace('#', '');
  const slotWithOrder = await sim.$$eval('.slot', (els, n) => els.findIndex(e => e.textContent.includes('order #' + n)), myNum);
  console.log('sim slot with order index', slotWithOrder);
  const slotCards = await sim.$$('.slot');
  await (await slotCards[slotWithOrder].$('text=Put a bag on')).click(); await sim.waitForTimeout(2600);
  await staff.click('#tab-shelf'); await staff.waitForTimeout(2500);
  await shot(staff, '06-shelf', true);
  await shot(sim, '07-simulator', true);
  await (await (await sim.$$('.slot'))[slotWithOrder].$('text=Lift the bag')).click(); await sim.waitForTimeout(2600);
  console.log('sim log top', await sim.textContent('#log li:first-child'));
  await page.click('text=Refresh'); await page.waitForTimeout(400);
  console.log('customer after lift', await page.textContent('.ot-headline'));
  await shot(page, '08-order-collected');

  await staff.click('#tab-insights'); await staff.waitForSelector('.chart'); await staff.waitForTimeout(400);
  await shot(staff, '09-insights', true);
  await staff.click('#tab-menu'); await staff.waitForSelector('.price-input');
  await staff.fill('input[aria-label="Price of Espresso in tenge"]', '950');
  await staff.click('tr:has-text("Espresso") >> text=Save price'); await staff.waitForTimeout(300);
  await shot(staff, '10-menu-admin');

  // mobile
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.addInitScript(() => { localStorage.setItem('cafe.mode', '"demo"'); });
  const mp = await m.newPage(); mp.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(BASE); await mp.waitForSelector('.dish');
  await shot(mp, '11-mobile-home');
  await mp.click('button[aria-label="Add Cappuccino to your order"]');
  await mp.evaluate(() => window.scrollTo(0, 900)); await mp.waitForTimeout(200);
  await shot(mp, '12-mobile-menu');
  await mp.click('#cartBarButton'); await mp.waitForTimeout(400);
  await shot(mp, '13-mobile-sheet');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log('mobile horizontal overflow px', overflow);
  await mp.click('#cartClose');
  await mp.goto(BASE + '#staff'); await mp.click('text=Open the demo counter'); await mp.waitForSelector('.slip');
  await shot(mp, '14-mobile-staff');

  // dark
  await page.evaluate(() => { localStorage.setItem('cafe.theme', '"dark"'); }); await page.goto(BASE); await page.waitForSelector('.dish'); await page.waitForTimeout(300);
  await shot(page, '15-dark-home');
  await staff.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await staff.click('#tab-insights'); await staff.waitForSelector('.chart'); await staff.waitForTimeout(300);
  await shot(staff, '16-dark-insights');

  console.log('ERRORS', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
