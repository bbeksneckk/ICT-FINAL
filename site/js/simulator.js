/* Simulated weight-sensor shelf (Project Stage 2, Part D3).
   Sends {slot, weight_g} readings every 2 s through cafe_sensor_report and reacts to the reply. */
(function () {
  "use strict";
  const api = window.CafeApi.create();
  const dev = window.SHELF_DEVICE;
  const $ = id => document.getElementById(id);
  const KEY_STORE = "cafe.deviceKey";
  const S = window.CafeApi.storage;
  // Demo mode uses the demo key. Live mode needs the real key, typed once and kept only in this browser.
  const deviceKey = () => api.mode === "demo" ? dev.demoKey : S.read(KEY_STORE, "");
  function showKeyForm(message) {
    $("keyForm").hidden = api.mode === "demo";
    $("keyMsg").textContent = message || (deviceKey() ? "A device key is saved in this browser." : "Type the shelf device key to send readings to the live database.");
  }
  $("keyForm").addEventListener("submit", e => {
    e.preventDefault();
    const k = $("keyInput").value.trim();
    if (!/^[0-9a-f]{32}$/i.test(k)) { $("keyMsg").textContent = "The key is 32 characters: digits 0–9 and letters a–f."; return; }
    try { S.write(KEY_STORE, k); } catch (err) { $("keyMsg").textContent = err.message; return; }
    $("keyInput").value = ""; showKeyForm("Saved. Press “Start sending readings”.");
  });
  $("keyForget").addEventListener("click", () => { S.remove(KEY_STORE); showKeyForm("The key was removed from this browser."); });
  showKeyForm();
  const slots = [1, 2, 3, 4].map(n => ({ slot: n, weight: 0, has_order: false, order_number: null, placed: false, plan: null }));
  let timer = null, busy = false;

  function el(tag, attrs = {}, text) { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text !== undefined) e.textContent = text; return e; }
  function log(text, isEvent) {
    const li = el("li", isEvent ? { class: "event" } : {}, `${new Date().toLocaleTimeString("en-GB")}  ${text}`);
    $("log").prepend(li); while ($("log").children.length > 14) $("log").lastChild.remove();
  }
  function render() {
    $("slots").replaceChildren(...slots.map(s => {
      const card = el("div", { class: `slot${s.weight >= 100 ? " has-bag" : ""}` });
      card.append(el("span", { class: "slot-no" }, `Slot ${s.slot}`),
        el("span", { class: "weight" }, `${s.weight} g`),
        el("span", { class: "slot-state" }, s.has_order ? (s.placed ? `Bag for order #${s.order_number} is on the slot` : `Reserved for order #${s.order_number}`) : "No order assigned"));
      const put = el("button", { class: "btn btn-ghost btn-sm", type: "button" }, "Put a bag on");
      const lift = el("button", { class: "btn btn-ghost btn-sm", type: "button" }, "Lift the bag");
      put.disabled = s.weight >= 100; lift.disabled = s.weight < 100;
      put.onclick = () => { s.weight = 380 + Math.round(Math.random() * 140); s.plan = null; render(); };
      lift.onclick = () => { s.weight = 0; s.plan = null; render(); };
      const b = el("div", { class: "slot-buttons" }); b.append(put, lift); card.append(b);
      return card;
    }));
  }
  function autoplay() {
    if (!$("autoMode").checked) return;
    const now = Date.now();
    slots.forEach(s => {
      if (s.has_order && !s.placed && s.weight < 100) {           // staff puts the ready bag on its slot
        s.plan = s.plan || { at: now + 4000, action: "put" };
      } else if (s.has_order && s.placed && s.weight >= 100) {    // customer arrives later and lifts it
        s.plan = s.plan && s.plan.action === "lift" ? s.plan : { at: now + 10000 + Math.random() * 15000, action: "lift" };
      } else s.plan = null;
      if (s.plan && now >= s.plan.at) { s.weight = s.plan.action === "put" ? 380 + Math.round(Math.random() * 140) : 0; s.plan = null; }
    });
  }
  async function send() {
    if (busy) return; busy = true;
    autoplay();
    const readings = slots.map(s => ({ slot: s.slot, weight_g: s.weight >= 100 ? s.weight + Math.round((Math.random() - .5) * 6) : Math.round(Math.random() * 3) }));
    const t0 = performance.now();
    try {
      const res = await api.sensorReport(dev.id, deviceKey(), readings);
      (res.slots || []).forEach(r => { const s = slots.find(x => x.slot === r.slot); if (s) Object.assign(s, { has_order: r.has_order, order_number: r.order_number, placed: r.placed }); });
      $("simStatus").textContent = `Sending every ${dev.intervalMs / 1000} s to the ${api.mode === "demo" ? "demo data in this browser" : "café database"}. Last reply in ${Math.round(performance.now() - t0)} ms.`;
      log(`sent ${readings.map(r => `slot ${r.slot}: ${r.weight_g} g`).join(", ")}`);
      (res.events || []).forEach(ev => log(ev.event === "collected" ? `database: order #${ev.order_number} marked as collected (slot ${ev.slot})` : `database: bag placed on slot ${ev.slot}`, true));
    } catch (e) {
      $("simStatus").textContent = `Not delivered: ${e.message}`; log(`error: ${e.message}`, true);
      if (/device key/i.test(e.message)) { showKeyForm("The database did not accept this key. Check it and save it again."); if (timer) $("runBtn").click(); }
    } finally { busy = false; render(); }
  }
  $("runBtn").addEventListener("click", () => {
    if (!timer && !deviceKey()) { showKeyForm("Save the device key first."); $("keyInput").focus(); return; }
    if (timer) { clearInterval(timer); timer = null; $("runBtn").textContent = "Start sending readings"; $("simStatus").textContent = "Stopped. The staff screen will show the sensor as offline after 15 s."; return; }
    send(); timer = setInterval(send, dev.intervalMs); $("runBtn").textContent = "Stop sending";
  });
  render();
})();
