const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('cafe.mode', '"demo"'));
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://127.0.0.1:8766/'); await p.waitForSelector('.dish');
  const lab = () => p.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.id || document.activeElement.tagName);
  await p.focus('button[aria-label="Add Espresso to your order"]'); await p.keyboard.press('Space'); console.log('after Add:', await lab());
  await p.keyboard.press('Space'); console.log('after +:', await lab(), 'qty', await p.textContent('#cartCount'));
  await p.keyboard.press('Shift+Tab'); console.log('shift-tab ->', await lab());
  await p.keyboard.press('Space'); await p.keyboard.press('Space'); console.log('after −,− :', await lab(), 'qty', await p.textContent('#cartCount'));
  await p.keyboard.press('Enter'); console.log('Enter on Add again:', await lab());
  await p.focus('#cartItems .line-remove'); await p.keyboard.press('Enter'); console.log('after cart Remove:', await lab(), 'qty', await p.textContent('#cartCount'));
  if (await p.isVisible('#nowPicks')) { await p.focus('#nowPicks .add'); await p.keyboard.press('Enter'); console.log('after pick Add:', await lab()); }
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
