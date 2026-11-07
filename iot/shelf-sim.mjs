// Command-line version of the pickup-shelf sensor (Project Stage 2, Part D3).
// Run:  node iot/shelf-sim.mjs <device key>     (Node.js 18 or newer, no packages needed)
//   or: SHELF_KEY=<device key> node iot/shelf-sim.mjs
// The key is never stored in this file; the database keeps only its SHA-256 hash.
// Every 2 seconds it sends the weight of 4 slots to the live database. A bag appears on a
// slot a few seconds after staff mark an order Ready, and is lifted 10–25 seconds later.
const URL_BASE = "https://ovzxxevqqvqfaeewskdm.supabase.co";
const KEY = "sb_publishable_s9ub3AU_6b0cfOY96ncKpg_rN6k4BqK";
const DEVICE = { id: "shelf-01", key: process.argv[2] || process.env.SHELF_KEY || "" };
if (!/^[0-9a-f]{32}$/i.test(DEVICE.key)) { console.error("Give the 32-character shelf device key: node tools/shelf-sim.mjs <key>"); process.exit(1); }

const slots = [1, 2, 3, 4].map(slot => ({ slot, weight: 0, hasOrder: false, placed: false, order: null, due: null }));

async function report(readings) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/cafe_sensor_report`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_device_id: DEVICE.id, p_device_key: DEVICE.key, p_readings: readings })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || res.statusText);
  return body;
}

async function tick() {
  const now = Date.now();
  for (const s of slots) {
    if (s.hasOrder && !s.placed && s.weight < 100) { s.due ??= now + 4000; if (now >= s.due) { s.weight = 400 + Math.round(Math.random() * 120); s.due = null; } }
    else if (s.hasOrder && s.placed && s.weight >= 100) { s.due ??= now + 10000 + Math.random() * 15000; if (now >= s.due) { s.weight = 0; s.due = null; } }
    else s.due = null;
  }
  const readings = slots.map(s => ({ slot: s.slot, weight_g: s.weight >= 100 ? s.weight + Math.round((Math.random() - 0.5) * 6) : 0 }));
  try {
    const res = await report(readings);
    for (const r of res.slots) Object.assign(slots.find(s => s.slot === r.slot), { hasOrder: r.has_order, placed: r.placed, order: r.order_number });
    const line = readings.map(r => `${r.slot}:${String(r.weight_g).padStart(4)} g`).join("  ");
    console.log(new Date().toLocaleTimeString("en-GB"), line, res.events.map(e => e.event === "collected" ? `-> #${e.order_number} collected` : `-> bag on slot ${e.slot}`).join(" "));
  } catch (e) { console.error("not delivered:", e.message); }
}

console.log("Pickup shelf sensor running. Press Ctrl+C to stop.");
tick(); setInterval(tick, 2000);
