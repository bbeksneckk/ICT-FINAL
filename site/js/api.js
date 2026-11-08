/* Corner Café data layer.
   SupabaseApi talks to the live database through PostgREST RPC calls and Supabase Auth (plain fetch, no SDK).
   DemoApi keeps the same interface but stores everything in this browser (offline fallback). */
(function () {
  "use strict";
  const D = window.CafeDomain;
  const CFG = window.CAFE_CONFIG;

  const storage = {
    read(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch { throw new Error("Browser storage is unavailable. Allow site storage and try again."); }
    },
    remove(key) { try { localStorage.removeItem(key); } catch {} }
  };

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ------------------------------------------------------------------ live */
  const SESSION_KEY = "cafe.staff.session";
  class SupabaseApi {
    constructor() { this.mode = "supabase"; this.base = CFG.supabaseUrl.replace(/\/$/, ""); this.key = CFG.supabasePublishableKey; }

    session() { return storage.read(SESSION_KEY, null); }

    async request(path, { method = "POST", body, auth = true, timeout = 15000 } = {}) {
      const headers = { apikey: this.key, "Content-Type": "application/json" };
      if (auth) { const token = await this.accessToken(); if (token) headers.Authorization = `Bearer ${token}`; }
      let res;
      try {
        res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
      } catch (e) {
        const err = new Error("Could not reach the café server. Check your internet connection and try again.");
        err.uncertain = true; throw err;
      }
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = text; } }
      if (!res.ok) {
        const msg = (data && (data.message || data.msg || data.error_description || data.error)) || `Request failed (${res.status}).`;
        const err = new Error(msg); err.status = res.status; err.code = data && (data.error_code || data.code);
        err.uncertain = res.status >= 500;
        if (err.code === "PGRST202") err.message = "The database is missing a function. Run the SQL files in the database folder.";
        if (err.code === "invalid_credentials") err.message = "Wrong e-mail or password.";
        throw err;
      }
      return data;
    }

    rpc(name, args = {}) { return this.request(`/rest/v1/rpc/${name}`, { body: args }); }

    async accessToken() {
      let s = this.session();
      if (!s) return null;
      if (s.expires_at && s.expires_at - 60 < Date.now() / 1000) {
        try { s = await this.refresh(s.refresh_token); } catch { storage.remove(SESSION_KEY); return null; }
      }
      return s.access_token;
    }
    async refresh(refreshToken) {
      const data = await this.request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: refreshToken }, auth: false });
      return this.saveSession(data);
    }
    saveSession(d) {
      const s = { access_token: d.access_token, refresh_token: d.refresh_token,
        expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) };
      storage.write(SESSION_KEY, s); return s;
    }

    // customers
    getMenu() { return this.rpc("cafe_get_menu"); }
    queueInfo() { return this.rpc("cafe_queue_info"); }
    placeOrder(name, items, token, note, pickupMinutes) {
      return this.rpc("cafe_place_order_v2", { p_name: name, p_items: items, p_token: token, p_note: note || null, p_pickup_in_minutes: pickupMinutes || null });
    }
    getOrder(token) { return this.rpc("cafe_track_order_v2", { p_token: token }); }
    publicInsights() { return this.rpc("cafe_public_insights"); }
    publicBoard() { return this.request("/rest/v1/rpc/cafe_public_board", { body: {}, auth: false }); }
    submitFeedback(token, rating, comment) { return this.rpc("cafe_submit_feedback", { p_token: token, p_rating: rating, p_comment: comment || null }); }

    // staff
    async getStaff() { return this.session() ? this.rpc("cafe_staff_profile") : null; }
    async login(email, password) {
      const data = await this.request("/auth/v1/token?grant_type=password", { body: { email, password }, auth: false });
      this.saveSession(data);
      try { return await this.rpc("cafe_staff_profile"); }
      catch (e) { await this.logout(); throw e; }
    }
    async logout() {
      try { if (this.session()) await this.request("/auth/v1/logout?scope=local", { body: {} }); } catch {}
      storage.remove(SESSION_KEY);
    }
    getOrders() { return this.rpc("cafe_staff_orders_v2"); }
    advanceOrder(id, expected) { return this.rpc("cafe_advance_order_v2", { p_order_id: id, p_expected_status: expected }); }
    setAvailability(id, available) { return this.rpc("cafe_set_availability", { p_item_id: id, p_available: available }); }
    setPrice(id, price) { return this.rpc("cafe_set_price", { p_item_id: id, p_price: price }); }
    managerStats(days) { return this.rpc("cafe_manager_stats", { p_days: days }); }
    managerFeedback(days) { return this.rpc("cafe_manager_feedback", { p_days: days }); }
    shelfStatus() { return this.rpc("cafe_shelf_status"); }
    clearLoadTests() { return this.rpc("cafe_clear_load_tests"); }

    // IoT device (used by the shelf simulator)
    sensorReport(deviceId, deviceKey, readings) {
      return this.request("/rest/v1/rpc/cafe_sensor_report", { body: { p_device_id: deviceId, p_device_key: deviceKey, p_readings: readings }, auth: false });
    }
  }

  /* ------------------------------------------------------------------ demo */
  const DEMO_KEY = "cafe.demo.v2";
  const DEMO_DEVICE = { id: "shelf-01", keyHash: "7770b21b35c8d6f665b5957b95712a64bb115347afb9efac99989c961606753b" }; // sha256("demo-shelf-01")
  const SHELF_STAFF = "Smart shelf";

  // Deterministic test history so the demo charts have something to show.
  function seedHistory(menu) {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const names = ["Amina", "Arman", "Dana", "Timur", "Aruzhan", "Dias", "Kamila", "Sultan", "Madina", "Nurlan", "Aliya", "Askar"];
    const hourWeights = { 8: 9, 9: 7, 10: 4, 11: 4, 12: 8, 13: 9, 14: 4, 15: 3, 16: 4, 17: 5, 18: 3 };
    const hours = Object.entries(hourWeights).flatMap(([h, w]) => Array(w).fill(Number(h)));
    const orders = []; const now = new Date();
    for (let day = 13; day >= 1; day--) {
      const count = 5 + Math.floor(rnd() * 6);
      for (let k = 0; k < count; k++) {
        const d = new Date(now); d.setDate(d.getDate() - day);
        d.setHours(hours[Math.floor(rnd() * hours.length)], Math.floor(rnd() * 60), 0, 0);
        const picks = new Map();
        const lines = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < lines; j++) {
          const pool = rnd() < 0.6 ? menu.filter(m => m.category_id <= 4) : menu;
          const m = pool[Math.floor(rnd() * pool.length)];
          if (m.is_available) picks.set(m.item_id, Math.min(3, (picks.get(m.item_id) || 0) + 1));
        }
        if (!picks.size) continue;
        const items = D.priceOrder([...picks].map(([item_id, quantity]) => ({ item_id, quantity })), menu);
        const t0 = d.getTime(), t1 = t0 + (1 + rnd() * 4) * 60000, t2 = t1 + (4 + rnd() * 8) * 60000, t3 = t2 + (2 + rnd() * 10) * 60000;
        orders.push({ created_at: new Date(t0).toISOString(), customer_first_name: names[Math.floor(rnd() * names.length)], status: "Collected", items,
          history: [["Received", t0, null], ["Preparing", t1, "Demo staff"], ["Ready", t2, "Demo staff"], ["Collected", t3, "Demo staff"]]
            .map(([s, t, by]) => ({ new_status: s, changed_at: new Date(t).toISOString(), changed_by: by })) });
      }
    }
    return orders.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  function initialDemo() {
    const menu = structuredClone(window.CAFE_DEMO_DATA.menu);
    const past = seedHistory(menu);
    const live = [
      { name: "Amina", status: "Received", items: [{ item_id: 4, quantity: 1 }, { item_id: 33, quantity: 2 }], note: "Oat milk, please" },
      { name: "Arman", status: "Preparing", items: [{ item_id: 3, quantity: 2 }] },
      { name: "Dana", status: "Ready", items: [{ item_id: 14, quantity: 1 }, { item_id: 38, quantity: 1 }] }
    ].map((s, i) => {
      const t0 = Date.now() - (3 - i) * 5 * 60000;
      return { created_at: new Date(t0).toISOString(), customer_first_name: s.name, status: s.status, customer_note: s.note || null,
        items: D.priceOrder(s.items, menu),
        history: D.statuses.slice(0, D.statuses.indexOf(s.status) + 1).map((st, j) => ({ new_status: st, changed_at: new Date(t0 + j * 3 * 60000).toISOString(), changed_by: j ? "Demo staff" : null })) };
    });
    const orders = [...past, ...live].map((o, i) => ({ order_id: i + 1, order_number: 2001 + i, status_token: D.uuid(),
      pickup_at: null, customer_note: null, ...o, total_price: D.total(o.items) }));
    const ready = orders.find(o => o.status === "Ready");
    const slots = [1, 2, 3, 4].map(n => ({ slot: n, order_id: n === 1 ? ready.order_id : null, assigned_at: n === 1 ? new Date().toISOString() : null,
      placed_at: null, weight_g: 0, last_reading_at: null }));
    return { version: 2, menu, orders, nextId: orders.length + 1, nextNumber: 2001 + orders.length, slots, readings: [] };
  }

  // Demo only: star ratings (no comments) on about a third of the seeded past orders.
  function seedRatings(db) {
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const scale = [5, 5, 5, 4, 4, 4, 3, 5, 4, 2];
    db.orders.forEach(o => { if (o.status === "Collected" && !o.feedback && rnd() < 0.35) o.feedback = { rating: scale[Math.floor(rnd() * scale.length)], comment: null, at: o.created_at }; });
    db.ratingsSeeded = true;
  }

  // Same rule as the database: test orders and orders older than 12 hours do not make the wait longer.
  const isQueued = o => (o.status === "Received" || o.status === "Preparing") && !["load test", "qa test"].includes(o.customer_first_name.trim().toLowerCase())
    && Date.now() - Date.parse(o.created_at) < 12 * 3600000;

  class DemoApi {
    constructor() { this.mode = "demo"; }
    read() {
      let d = storage.read(DEMO_KEY, null);
      if (!d || d.version !== 2) { d = initialDemo(); this.write(d); }
      if (!d.ratingsSeeded) { seedRatings(d); this.write(d); }
      return d;
    }
    write(d) { storage.write(DEMO_KEY, d); }
    get staff() { return storage.read("cafe.demo.staff", null); }
    requireStaff() { if (!this.staff) throw new Error("Sign in to open the counter dashboard."); return this.staff; }
    avgPrep(db) {
      const done = db.orders.filter(o => o.history.some(h => h.new_status === "Ready") && !["load test", "qa test"].includes(o.customer_first_name.trim().toLowerCase())).slice(-200);
      if (!done.length) return 10;
      const m = done.map(o => (Date.parse(o.history.find(h => h.new_status === "Ready").changed_at) - Date.parse(o.history[0].changed_at)) / 60000);
      return Math.round(m.reduce((a, b) => a + b, 0) / m.length * 10) / 10;
    }
    decorate(db, o) {
      const slot = db.slots.find(s => s.order_id === o.order_id);
      const fb = o.feedback ? { rating: o.feedback.rating, comment: o.feedback.comment } : null;
      return { ...o, feedback: fb, shelf_slot: slot ? slot.slot : null, on_shelf: slot ? !!slot.placed_at : null };
    }
    async getMenu() { return { categories: structuredClone(window.CAFE_DEMO_DATA.categories), menu: this.read().menu }; }
    async queueInfo() {
      const db = this.read(); const active = db.orders.filter(o => isQueued(o)).length;
      const avg = this.avgPrep(db);
      return { active_orders: active, avg_prep_minutes: avg, estimated_wait_minutes: Math.ceil(avg + 2 * active) };
    }
    async placeOrder(name, items, token, note, pickupMinutes) {
      const checked = D.validateOrder(name, items);
      const cleanNote = (note || "").trim() || null;
      if (cleanNote && cleanNote.length > 140) throw new Error("The note can have up to 140 characters.");
      if (pickupMinutes && ![15, 30, 45, 60].includes(pickupMinutes)) throw new Error("Choose a pickup time of 15, 30, 45 or 60 minutes, or as soon as possible.");
      const db = this.read();
      const existing = db.orders.find(o => o.status_token === token);
      if (existing) {
        if (!D.sameRequest(existing, checked.name, checked.items)) throw new Error("This request token belongs to a different cart.");
        return { ...this.decorate(db, existing), queue: await this.queueInfo() };
      }
      const priced = D.priceOrder(checked.items, db.menu);
      const now = new Date();
      const order = { order_id: db.nextId++, order_number: db.nextNumber++, status_token: token, customer_first_name: checked.name,
        status: "Received", created_at: now.toISOString(), items: priced, total_price: D.total(priced), customer_note: cleanNote,
        pickup_at: pickupMinutes ? new Date(now.getTime() + pickupMinutes * 60000).toISOString() : null,
        history: [{ new_status: "Received", changed_at: now.toISOString(), changed_by: null }] };
      db.orders.push(order); this.write(db);
      return { ...this.decorate(db, order), queue: await this.queueInfo() };
    }
    async getOrder(token) {
      const db = this.read(); const o = db.orders.find(x => x.status_token === token);
      if (!o) return null;
      const ahead = db.orders.filter(x => isQueued(x) && x.created_at < o.created_at).length;
      return { ...this.decorate(db, o), orders_ahead: ahead, avg_prep_minutes: this.avgPrep(db) };
    }
    async publicInsights() {
      const db = this.read(); const from = Date.now() - 21 * 86400000;
      const recent = db.orders.filter(o => Date.parse(o.created_at) >= from);
      const qty = {}; recent.forEach(o => o.items.forEach(i => { qty[i.item_id] = (qty[i.item_id] || 0) + i.quantity; }));
      const days = Math.max(1, new Set(recent.map(o => o.created_at.slice(0, 10))).size);
      const popular = Object.entries(qty).map(([id, q]) => [Number(id), q]).filter(([id]) => db.menu.find(m => m.item_id === id)?.is_available)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(x => x[0]);
      const hours = []; for (let h = 8; h <= 20; h++) hours.push({ hour: h, avg_orders: Math.round(recent.filter(o => new Date(o.created_at).getHours() === h).length / days * 10) / 10 });
      const nowHour = new Date().getHours(); const near = {};
      recent.filter(o => Math.abs(new Date(o.created_at).getHours() - nowHour) <= 1).forEach(o => o.items.forEach(i => { near[i.item_id] = (near[i.item_id] || 0) + i.quantity; }));
      const nowPicks = Object.entries(near).map(([id, q]) => [Number(id), q]).filter(([id, q]) => q >= 2 && db.menu.find(m => m.item_id === id)?.is_available)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(x => x[0]);
      return { popular_item_ids: popular, avg_orders_by_hour: hours, now_hour: nowHour, now_picks: nowPicks, days_counted: days };
    }
    async publicBoard() {
      const db = this.read(); const from = Date.now() - 12 * 3600000;
      const recent = db.orders.filter(o => Date.parse(o.created_at) > from).sort((a, b) => a.order_number - b.order_number);
      return {
        in_progress: recent.filter(o => o.status === "Received" || o.status === "Preparing").map(o => ({ order_number: o.order_number, status: o.status })),
        ready: recent.filter(o => o.status === "Ready").map(o => ({ order_number: o.order_number, shelf_slot: db.slots.find(s => s.order_id === o.order_id)?.slot || null,
          ready_at: o.history.find(x => x.new_status === "Ready")?.changed_at || null })),
        avg_prep_minutes: this.avgPrep(db), server_time: new Date().toISOString()
      };
    }
    async submitFeedback(token, rating, comment) {
      const db = this.read(); const o = db.orders.find(x => x.status_token === token);
      if (!o) throw new Error("We could not find that order.");
      if (o.status !== "Collected") throw new Error("You can rate the order after you collect it.");
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Choose from 1 to 5 stars.");
      const c = (comment || "").trim() || null;
      if (c && c.length > 200) throw new Error("The comment can have up to 200 characters.");
      o.feedback = { rating, comment: c, at: new Date().toISOString() }; this.write(db);
      return { rating, comment: c };
    }
    async managerFeedback(days) {
      if (this.requireStaff().role !== "manager") throw new Error("Manager access is required.");
      const db = this.read(); const from = Date.now() - days * 86400000;
      const isTest = o => ["load test", "qa test"].includes(o.customer_first_name.trim().toLowerCase());
      const all = db.orders.filter(o => Date.parse(o.created_at) >= from);
      const testRatings = all.filter(o => isTest(o) && o.feedback).length;
      const orders = all.filter(o => !isTest(o));
      const rated = orders.filter(o => o.feedback);
      const avg = rated.length ? Math.round(rated.reduce((a, o) => a + o.feedback.rating, 0) / rated.length * 10) / 10 : null;
      return { period_days: days, count: rated.length, test_ratings: testRatings, collected: orders.filter(o => o.status === "Collected").length, avg_rating: avg,
        by_rating: [1, 2, 3, 4, 5].map(r => ({ rating: r, n: rated.filter(o => o.feedback.rating === r).length })),
        recent: rated.filter(o => o.feedback.comment).sort((a, b) => b.feedback.at.localeCompare(a.feedback.at)).slice(0, 6)
          .map(o => ({ order_number: o.order_number, rating: o.feedback.rating, comment: o.feedback.comment, at: o.feedback.at })) };
    }
    async clearLoadTests() {
      if (this.requireStaff().role !== "manager") throw new Error("Manager access is required.");
      const db = this.read(); const ids = db.orders.filter(o => ["load test", "qa test"].includes(o.customer_first_name.trim().toLowerCase())).map(o => o.order_id);
      db.orders = db.orders.filter(o => !ids.includes(o.order_id));
      db.slots.forEach(s => { if (ids.includes(s.order_id)) Object.assign(s, { order_id: null, assigned_at: null, placed_at: null }); });
      this.write(db); return ids.length;
    }
    async getStaff() { return this.staff; }
    async login() { const s = { staff_id: 1, display_name: "Demo manager", role: "manager" }; storage.write("cafe.demo.staff", s); return s; }
    async logout() { storage.remove("cafe.demo.staff"); }
    async getOrders() {
      this.requireStaff(); const db = this.read();
      const sorted = [...db.orders].sort((a, b) => b.order_number - a.order_number);
      const recent = sorted.filter(o => o.status === "Collected").slice(0, 30);
      return sorted.filter(o => o.status !== "Collected" || recent.includes(o)).map(o => this.decorate(db, o));
    }
    async advanceOrder(id, expected) {
      const staff = this.requireStaff(); const db = this.read(); const o = db.orders.find(x => x.order_id === id);
      if (!o || o.status !== expected) throw new Error("This order changed. Refresh the board before trying again.");
      o.status = D.nextStatus(o.status);
      o.history.push({ new_status: o.status, changed_at: new Date().toISOString(), changed_by: staff.display_name });
      if (o.status === "Ready") { const free = db.slots.find(s => !s.order_id); if (free) Object.assign(free, { order_id: o.order_id, assigned_at: new Date().toISOString(), placed_at: null }); }
      if (o.status === "Collected") db.slots.filter(s => s.order_id === o.order_id).forEach(s => Object.assign(s, { order_id: null, assigned_at: null, placed_at: null }));
      this.write(db); return this.decorate(db, o);
    }
    async setAvailability(id, available) {
      if (this.requireStaff().role !== "manager") throw new Error("Manager access is required.");
      const db = this.read(); const m = db.menu.find(x => x.item_id === id); if (!m) throw new Error("Menu item not found.");
      m.is_available = available; this.write(db);
    }
    async setPrice(id, price) {
      if (this.requireStaff().role !== "manager") throw new Error("Manager access is required.");
      if (!Number.isInteger(price) || price < 100 || price > 20000) throw new Error("Enter a whole price between 100 and 20,000 KZT.");
      const db = this.read(); const m = db.menu.find(x => x.item_id === id); if (!m) throw new Error("Menu item not found.");
      m.price = price; this.write(db);
    }
    async managerStats(days) {
      if (this.requireStaff().role !== "manager") throw new Error("Manager access is required.");
      const db = this.read(); const from = Date.now() - days * 86400000;
      const orders = db.orders.filter(o => Date.parse(o.created_at) >= from);
      const lines = orders.flatMap(o => o.items.map(i => ({ ...i, o })));
      const sum = a => a.reduce((x, y) => x + y, 0);
      const revenue = sum(lines.map(l => l.quantity * l.unit_price));
      const group = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); (m[k] = m[k] || []).push(x); return m; }, {});
      const byHour = group(orders, o => new Date(o.created_at).getHours());
      const byDay = group(orders, o => { const d = new Date(o.created_at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
      const byItem = group(lines, l => l.name);
      const catName = id => window.CAFE_DEMO_DATA.categories.find(c => c.category_id === id).name;
      const byCat = group(lines, l => catName(db.menu.find(m => m.item_id === l.item_id).category_id));
      const stage = (a, b) => { const v = orders.map(o => { const x = o.history.find(h => h.new_status === a), y = o.history.find(h => h.new_status === b); return x && y ? (Date.parse(y.changed_at) - Date.parse(x.changed_at)) / 60000 : null; }).filter(v => v !== null); return v.length ? Math.round(sum(v) / v.length * 10) / 10 : null; };
      return {
        period_days: days,
        totals: { orders: orders.length, revenue, items: sum(lines.map(l => l.quantity)), avg_order_value: orders.length ? Math.round(revenue / orders.length) : 0 },
        by_hour: Object.entries(byHour).map(([h, a]) => ({ hour: Number(h), orders: a.length })).sort((a, b) => a.hour - b.hour),
        by_day: Object.entries(byDay).map(([d, a]) => ({ day: d, orders: a.length, revenue: sum(a.flatMap(o => o.items.map(i => i.quantity * i.unit_price))) })).sort((a, b) => a.day.localeCompare(b.day)),
        top_items: Object.entries(byItem).map(([name, a]) => ({ name, quantity: sum(a.map(l => l.quantity)), revenue: sum(a.map(l => l.quantity * l.unit_price)) })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 8),
        by_category: Object.entries(byCat).map(([category, a]) => ({ category, quantity: sum(a.map(l => l.quantity)), revenue: sum(a.map(l => l.quantity * l.unit_price)) })).sort((a, b) => b.revenue - a.revenue),
        stage_minutes: { received_to_preparing: stage("Received", "Preparing"), preparing_to_ready: stage("Preparing", "Ready"), ready_to_collected: stage("Ready", "Collected") },
        avg_prep_minutes: this.avgPrep(db)
      };
    }
    async shelfStatus() {
      this.requireStaff(); const db = this.read(); const now = Date.now();
      const last = db.slots.map(s => s.last_reading_at).filter(Boolean).sort().pop() || null;
      return { device_online: !!last && now - Date.parse(last) < 15000, last_reading_at: last,
        readings_last_hour: db.readings.filter(r => now - Date.parse(r.recorded_at) < 3600000).length,
        slots: db.slots.map(s => { const o = db.orders.find(x => x.order_id === s.order_id);
          return { slot: s.slot, weight_g: s.weight_g, order_number: o ? o.order_number : null, customer_first_name: o ? o.customer_first_name : null,
            assigned_at: s.assigned_at, placed_at: s.placed_at, last_reading_at: s.last_reading_at }; }),
        recent: db.readings.filter(r => now - Date.parse(r.recorded_at) < 120000).slice(-240) };
    }
    async sensorReport(deviceId, deviceKey, readings) {
      if (deviceId !== DEMO_DEVICE.id || (await sha256Hex(deviceKey || "")) !== DEMO_DEVICE.keyHash) throw new Error("Unknown device or wrong device key.");
      const db = this.read(); const now = new Date().toISOString(); const events = [];
      for (const r of readings || []) {
        const s = db.slots.find(x => x.slot === r.slot); if (!s) continue;
        const w = Math.max(0, Math.min(20000, Math.round(r.weight_g)));
        db.readings.push({ slot_no: s.slot, weight_g: w, recorded_at: now });
        if (s.order_id && !s.placed_at && w >= 100) { s.placed_at = now; events.push({ event: "placed", slot: s.slot }); }
        else if (s.order_id && s.placed_at && w < 30) {
          const o = db.orders.find(x => x.order_id === s.order_id);
          if (o && o.status === "Ready") { o.status = "Collected"; o.history.push({ new_status: "Collected", changed_at: now, changed_by: SHELF_STAFF }); }
          events.push({ event: "collected", slot: s.slot, order_number: o && o.order_number });
          Object.assign(s, { order_id: null, assigned_at: null, placed_at: null });
        }
        s.weight_g = w; s.last_reading_at = now;
      }
      db.readings = db.readings.filter(r => Date.now() - Date.parse(r.recorded_at) < 86400000).slice(-2000);
      this.write(db);
      return { events, slots: db.slots.map(s => { const o = db.orders.find(x => x.order_id === s.order_id);
        return { slot: s.slot, has_order: !!s.order_id, order_number: o ? o.order_number : null, placed: !!s.placed_at, weight_g: s.weight_g }; }) };
    }
  }

  function currentMode() { return storage.read("cafe.mode", CFG.defaultMode) === "demo" ? "demo" : "supabase"; }
  window.CafeApi = { storage, currentMode, create: mode => (mode || currentMode()) === "supabase" ? new SupabaseApi() : new DemoApi() };
})();
