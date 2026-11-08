// Keyboard-only order (BUG-02) and "Order the same again" without reload (BUG-01), demo mode.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('cafe.mode')) localStorage.setItem('cafe.mode', '"demo"'); });
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://127.0.0.1:8766/'); await p.waitForSelector('.dish');
  // reach "Add Espresso" with Tab only
  let found = false;
  for (let i = 0; i < 80; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Add Espresso to your order')) { found = true; break; } }
  console.log('reached Add by Tab:', found);
  await p.keyboard.press('Enter'); console.log('Enter on Add -> cart', await p.textContent('#cartCount'));
  await p.keyboard.press('Space'); console.log('Space on + -> cart', await p.textContent('#cartCount'));
  await p.focus('#customerName'); await p.keyboard.type('Keyboard');
  for (let i = 0; i < 5; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => document.activeElement.id === 'checkoutButton')) break; }
  console.log('focus on', await p.evaluate(() => document.activeElement.id));
  await p.keyboard.press('Enter'); await p.waitForSelector('.order-ticket', { timeout: 5000 }).catch(() => {});
  console.log('order placed by Enter:', p.url().includes('#order/'));
  await p.click('[data-nav="menu"]'); await p.waitForTimeout(300);
  console.log('Order the same again visible without reload:', await p.isVisible('#orderAgain'), '|', (await p.textContent('#orderAgain')).replace(/\s+/g, ' ').slice(0, 70));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
