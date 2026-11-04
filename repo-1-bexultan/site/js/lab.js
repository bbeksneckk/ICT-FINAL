/* Test lab: measures Stage 1 success criteria 2 and 3 against the same API the website uses. */
(function () {
  "use strict";
  const A = window.CafeApi, D = window.CafeDomain;
  const api = A.create();
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0; };
  let menu = [];

  $("labMode").textContent = api.mode === "demo" ? "Demo mode: results describe this browser only, not the live database." : "Live mode: requests go to the café database over HTTPS.";
  $("testLink").textContent = `${location.origin}${location.pathname.replace(/test-lab\.html$/, "")}index.html?test=1`;

  function download(name, rows) {
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; document.body.append(a); a.click(); a.remove();
  }
  function cart(seed) {
    const available = menu.filter(m => m.is_available);
    const a = available[(seed * 7) % available.length], b = available[(seed * 13 + 5) % available.length];
    const items = a.item_id === b.item_id ? [{ item_id: a.item_id, quantity: 2 }] : [{ item_id: a.item_id, quantity: 1 }, { item_id: b.item_id, quantity: 1 + (seed % 2) }];
    return items.sort((x, y) => x.item_id - y.item_id);
  }
  async function ensureMenu() { if (!menu.length) menu = (await api.getMenu()).menu; }

  /* ---------- Success criterion 3 ---------- */
  $("perfRun").addEventListener("click", async () => {
    const users = +$("perfUsers").value, nMenu = +$("perfMenu").value, nOrders = +$("perfOrders").value, limit = +$("perfLimit").value;
    $("perfRun").disabled = true; $("perfResult").innerHTML = "";
    try {
      await ensureMenu();
      const jobs = [];
      for (let i = 0; i < Math.max(nMenu, nOrders); i++) { if (i < nMenu) jobs.push({ type: "Menu load" }); if (i < nOrders) jobs.push({ type: "Order submission", seed: i }); }
      const results = []; let done = 0; const started = new Date();
      async function worker(w) {
        while (jobs.length) {
          const job = jobs.shift(); const t0 = performance.now(); let ok = true, error = "";
          try {
            if (job.type === "Menu load") { const m = await api.getMenu(); if (!m.menu || !m.menu.length) throw new Error("empty menu"); }
            else { const o = await api.placeOrder("Load test", cart(job.seed + 1), D.uuid(), "performance test", null); if (!o.order_number) throw new Error("no order number"); }
          } catch (e) { ok = false; error = e.message; }
          results.push({ user: w + 1, type: job.type, ms: Math.round(performance.now() - t0), ok, error });
          $("perfProgress").textContent = `${++done} of ${nMenu + nOrders} requests finished…`;
        }
      }
      await Promise.all(Array.from({ length: users }, (_, w) => worker(w)));
      const block = type => { const r = results.filter(x => x.type === type); const ms = r.filter(x => x.ok).map(x => x.ms);
        return { n: r.length, within: r.filter(x => x.ok && x.ms <= limit).length, within5: r.filter(x => x.ok && x.ms <= 5000).length, avg: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0, med: Math.round(median(ms)), p95: pct(ms, .95), failed: r.filter(x => !x.ok).length }; };
      const m = block("Menu load"), o = block("Order submission");
      const need = n => Math.ceil(n * 0.95);
      const card = (title, b) => `<div class="${b.n && b.within >= need(b.n) ? "met" : "missed"}"><span>${title}</span><strong>${b.within} of ${b.n}</strong><span>within ${limit / 1000} s (target ${need(b.n)} of ${b.n})</span><br><span class="muted">mean ${b.avg} ms, median ${b.med} ms, 95th percentile ${b.p95} ms${b.failed ? `, ${b.failed} failed` : ""}. Within 5 s (R11): ${b.within5} of ${b.n}</span></div>`;
      $("perfProgress").textContent = `Finished ${started.toLocaleString("en-GB")} with ${users} concurrent users, ${api.mode === "demo" ? "demo mode" : "live database"}.`;
      $("perfResult").innerHTML = `<div class="verdict">${card("Menu loads", m)}${nOrders ? card("Order submissions", o) : ""}</div>
        <details><summary>All ${results.length} requests</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>#</th><th>User</th><th>Request</th><th>Time (ms)</th><th>Result</th></tr></thead><tbody>${
          results.map((r, i) => `<tr><th scope="row">${i + 1}</th><td>${r.user}</td><td>${r.type}</td><td class="${r.ms > limit ? "bad" : ""}">${r.ms}</td><td>${r.ok ? "OK" : esc(r.error)}</td></tr>`).join("")}</tbody></table></div></details>
        <button class="btn btn-ghost btn-sm" id="perfCsv" type="button" style="margin-top:12px">Download results (CSV)</button>`;
      $("perfCsv").onclick = () => download("sc3-performance.csv", [["started", started.toISOString(), "users", users, "mode", api.mode], ["request", "user", "type", "ms", "ok", "error"], ...results.map((r, i) => [i + 1, r.user, r.type, r.ms, r.ok, r.error])]);
    } catch (e) { $("perfProgress").textContent = `The test stopped: ${e.message}`; }
    finally { $("perfRun").disabled = false; }
  });

  /* ---------- Success criterion 2 ---------- */
  (async () => {
    try { const s = await api.getStaff(); $("staffState").textContent = s ? `Signed in as ${s.display_name} (${s.role}).` : "Sign in on the Staff page first, then reload this page."; $("e2eRun").disabled = !s; }
    catch { $("staffState").textContent = "Sign in on the Staff page first, then reload this page."; }
  })();
  $("e2eRun").addEventListener("click", async () => {
    $("e2eRun").disabled = true; $("e2eResult").innerHTML = "";
    const say = t => { $("e2eProgress").textContent = t; };
    try {
      await ensureMenu();
      const plan = [];
      for (let i = 0; i < 20; i++) {
        const items = cart(100 + i);
        const total = items.reduce((s, it) => s + it.quantity * Number(menu.find(m => m.item_id === it.item_id).price), 0);
        plan.push({ i: i + 1, items, total, target: ["Received", "Preparing", "Ready", "Collected"][i % 4], token: D.uuid() });
      }
      for (const p of plan) { say(`Placing scripted order ${p.i} of 20…`); const o = await api.placeOrder("Load test", p.items, p.token, `scripted ${p.i}`, null); p.order_id = o.order_id; p.number = o.order_number; }
      for (const p of plan) {
        let status = "Received";
        while (status !== p.target) { say(`Staff moves order #${p.number} to ${p.target}…`); status = (await api.advanceOrder(p.order_id, status)).status; }
      }
      say("Reading the staff dashboard and each customer status page…");
      const board = await api.getOrders();
      const rows = [];
      for (const p of plan) {
        const seen = board.filter(o => o.order_id === p.order_id);
        const s = seen[0];
        const itemsOk = !!s && JSON.stringify(s.items.map(x => [x.item_id, x.quantity]).sort((a, b) => a[0] - b[0])) === JSON.stringify(p.items.map(x => [x.item_id, x.quantity]));
        const totalOk = !!s && Math.round(Number(s.total_price)) === Math.round(p.total);
        const track = await api.getOrder(p.token);
        const statusOk = !!s && !!track && track.status === s.status && s.status === p.target;
        rows.push({ ...p, once: seen.length === 1, itemsOk, totalOk, staffStatus: s ? s.status : "missing", customerStatus: track ? track.status : "missing", statusOk });
      }
      const pass = rows.filter(r => r.once && r.itemsOk && r.totalOk && r.statusOk).length;
      say(`Finished ${new Date().toLocaleString("en-GB")}.`);
      const tick = v => v ? "Yes" : "<span class=\"bad\">No</span>";
      $("e2eResult").innerHTML = `<div class="verdict"><div class="${pass === 20 ? "met" : "missed"}"><span>Orders that passed every check</span><strong>${pass} of 20</strong><span>target 20 of 20</span></div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Order</th><th>Once on the board</th><th>Items and quantities</th><th>Total</th><th>Staff status</th><th>Customer page</th><th>Match</th></tr></thead><tbody>${
          rows.map(r => `<tr><th scope="row">${r.i}</th><td>#${r.number}</td><td>${tick(r.once)}</td><td>${tick(r.itemsOk)}</td><td>${Number(r.total).toLocaleString("en-US")} ₸ ${r.totalOk ? "" : "<span class=\"bad\">(wrong)</span>"}</td><td>${esc(r.staffStatus)}</td><td>${esc(r.customerStatus)}</td><td>${tick(r.statusOk)}</td></tr>`).join("")}</tbody></table></div>
        <button class="btn btn-ghost btn-sm" id="e2eCsv" type="button" style="margin-top:12px">Download results (CSV)</button>`;
      $("e2eCsv").onclick = () => download("sc2-end-to-end.csv", [["#", "order", "once", "items_ok", "total_kzt", "total_ok", "staff_status", "customer_status", "match"], ...rows.map(r => [r.i, r.number, r.once, r.itemsOk, r.total, r.totalOk, r.staffStatus, r.customerStatus, r.statusOk])]);
    } catch (e) { say(`The test stopped: ${e.message}`); }
    finally { $("e2eRun").disabled = false; }
  });

  /* ---------- Success criterion 1 (runs stored on this device) ---------- */
  const runs = A.storage.read("cafe.testRuns", []);
  $("sc1Result").innerHTML = runs.length
    ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Finished</th><th>Seconds</th><th>Screen width</th><th>Sideways scroll</th></tr></thead><tbody>${runs.map((r, i) => `<tr><th scope="row">${i + 1}</th><td>${new Date(r.at).toLocaleString("en-GB")}</td><td class="${r.seconds > 120 ? "bad" : ""}">${r.seconds}</td><td>${r.width}px</td><td>${r.overflow ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table></div><p class="lab-note">${runs.filter(r => r.seconds <= 120).length} of ${runs.length} runs finished within two minutes. Runs are stored on the phone where the timer was used.</p>`
    : `<p class="muted">No timed runs on this device yet.</p>`;

  /* ---------- security check (R12) ---------- */
  $("secRun").addEventListener("click", async () => {
    if (api.mode === "demo") { $("secResult").innerHTML = `<p class="muted">Switch to live mode: the check talks to the real database.</p>`; return; }
    const checks = [
      ["Connection to the database", async () => { if (!/^https:/.test(window.CAFE_CONFIG.supabaseUrl)) throw new Error("not HTTPS"); return `HTTPS (${new URL(window.CAFE_CONFIG.supabaseUrl).host})`; }, true],
      ["Anonymous visitor reads the staff order list", () => api.request("/rest/v1/rpc/cafe_staff_orders_v2", { body: {}, auth: false }), false],
      ["Anonymous visitor reads the orders table directly", () => api.request("/rest/v1/orders?select=*&limit=1", { method: "GET", auth: false }), false],
      ["Device sends readings with a wrong key", () => api.sensorReport("shelf-01", "wrong-key", []), false]
    ];
    const rows = [];
    for (const [name, fn, shouldPass] of checks) {
      let answer, passed;
      try { const r = await fn(); answer = typeof r === "string" ? r : `request was accepted (${JSON.stringify(r).slice(0, 60)})`; passed = shouldPass; }
      catch (e) { answer = `refused: ${e.message}${e.status ? ` (HTTP ${e.status})` : ""}`; passed = !shouldPass; }
      rows.push(`<tr><th scope="row">${esc(name)}</th><td>${esc(answer)}</td><td>${passed ? "As expected" : "<span class=\"bad\">Problem</span>"}</td></tr>`);
    }
    $("secResult").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Check</th><th>What the server answered</th><th>Result</th></tr></thead><tbody>${rows.join("")}</tbody></table></div><p class="lab-note">Run at ${new Date().toLocaleString("en-GB")}.</p>`;
  });

  /* ---------- availability monitor (R14) ---------- */
  let mon = null;
  $("monRun").addEventListener("click", () => {
    if (mon) { clearInterval(mon.timer); mon = null; $("monRun").textContent = "Start monitoring"; $("monProgress").textContent += " Stopped."; return; }
    const every = +$("monEvery").value * 60000, total = Math.max(1, Math.round(+$("monFor").value * 60000 / every)) ;
    mon = { log: [], timer: null }; $("monRun").textContent = "Stop";
    const check = async () => {
      const t0 = performance.now(); let ok = false, note = "";
      try { const m = await Promise.race([api.getMenu(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 10000))]); ok = !!(m.menu && m.menu.length); if (!ok) note = "empty menu"; }
      catch (e) { note = e.message; }
      mon.log.push({ at: new Date(), ok, ms: Math.round(performance.now() - t0), note });
      const good = mon.log.filter(x => x.ok).length;
      $("monProgress").textContent = `Check ${mon.log.length} of ${total}: ${good} successful (${(good / mon.log.length * 100).toFixed(1)}%).`;
      $("monResult").innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Result</th><th>ms</th></tr></thead><tbody>${mon.log.map((x, i) => `<tr><th scope="row">${i + 1}</th><td>${x.at.toLocaleTimeString("en-GB")}</td><td>${x.ok ? "OK" : `<span class="bad">${esc(x.note)}</span>`}</td><td>${x.ms}</td></tr>`).join("")}</tbody></table></div>`;
      if (mon.log.length >= total) { clearInterval(mon.timer); $("monRun").textContent = "Start monitoring"; $("monProgress").textContent += ` Finished: ${(good / total * 100).toFixed(1)}% of checks succeeded (target 99%).`; mon = null; }
    };
    check(); mon.timer = setInterval(check, every);
  });

  /* ---------- clean up ---------- */
  $("cleanRun").addEventListener("click", async () => {
    $("cleanRun").disabled = true;
    try { const n = await api.clearLoadTests(); $("cleanResult").textContent = `Removed ${n} load-test orders.`; }
    catch (e) { $("cleanResult").textContent = e.message; }
    finally { $("cleanRun").disabled = false; }
  });
})();
