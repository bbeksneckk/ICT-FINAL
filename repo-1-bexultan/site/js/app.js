/* Corner Café front end: menu and cart, order tracking, staff counter (board, shelf, insights, menu). */
(function () {
  "use strict";
  const D = window.CafeDomain, A = window.CafeApi, S = A.storage, CFG = window.CAFE_CONFIG, C = window.CafeCharts, ART = window.CafeArt;
  const mode = A.currentMode();
  const api = A.create(mode);
  const $ = id => document.getElementById(id);

  /* ---------- helpers ---------- */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;            // only for our own static SVG markup
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const money = v => `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })} ₸`;
  const hm = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const timers = new Set();
  function every(ms, fn) { const id = setInterval(() => { if (!document.hidden) fn(); }, ms); timers.add(id); return id; }
  function clearTimers() { timers.forEach(clearInterval); timers.clear(); }
  function toast(message, type) {
    const t = h("div", { class: `toast${type === "error" ? " error" : ""}`, role: type === "error" ? "alert" : "status", text: message });
    $("toasts").append(t); setTimeout(() => t.remove(), 5000);
  }
  function errorText(e) { return e && e.message ? e.message : "Something went wrong. Try again."; }

  // Sound: off on every page load (no autoplay); used only after the customer ticks the box.
  const audio = $("confirmationAudio");
  let audioCtx = null;
  function chime() { if (!$("soundEnabled").checked) return; try { audio.currentTime = 0; audio.volume = .4; audio.play().catch(() => {}); } catch {} }
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, .18].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; g.gain.value = .08;
        o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + .12); });
    } catch {}
  }

  /* ---------- theme and mode ---------- */
  function isDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
  function syncThemeButton() { $("themeToggle").setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme"); }
  $("themeToggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = next;
    try { S.write("cafe.theme", next); } catch {} syncThemeButton();
  });
  syncThemeButton();
  $("modeBanner").hidden = mode !== "demo";
  $("footerMode").textContent = mode === "demo" ? "Switch to the live database" : "Switch to demo mode (offline)";
  $("footerMode").dataset.modeSwitch = mode === "demo" ? "supabase" : "demo";
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-mode-switch]"); if (!b) return;
    S.write("cafe.mode", b.dataset.modeSwitch); location.reload();
  });

  /* ---------- state ---------- */
  const state = {
    menu: [], categories: [], category: 0, search: "", menuReady: false,
    cart: S.read("cafe.cart", []), pending: S.read("cafe.pending", null), busy: false,
    popular: [], nowPicks: [], nowHour: null, staff: null, staffTab: "board", orders: [], knownIds: null, statsDays: 30, shelfLog: [], lastShelf: null, view: "menu"
  };
  const saveCart = () => { try { S.write("cafe.cart", state.cart); } catch (e) { toast(errorText(e), "error"); } };

  /* ================================================================ MENU */
  function renderCategories() {
    const box = $("categoryChips"); box.replaceChildren();
    [{ category_id: 0, name: "All" }, ...(state.popular.length ? [{ category_id: -1, name: "Popular" }] : []), ...state.categories].forEach(c => box.append(
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.category === c.category_id),
        onclick: () => { state.category = c.category_id; renderCategories(); renderMenu(); } }, c.name)));
  }
  function qtyOf(id) { return state.cart.find(x => x.item_id === id)?.quantity || 0; }
  function stepper(item, qty, small) {
    const locked = state.busy || !!state.pending;
    return h("div", { class: "stepper", role: "group", "aria-label": `${item.name} quantity` },
      h("button", { type: "button", "aria-label": `Remove one ${item.name}`, disabled: locked || null, onclick: () => changeQty(item.item_id, -1) }, "−"),
      h("span", { "aria-live": "polite" }, qty),
      h("button", { type: "button", "aria-label": `Add one more ${item.name}`, disabled: locked || qty >= 20 || !item.is_available || null, onclick: () => changeQty(item.item_id, 1) }, "+"));
  }
  function renderMenu() {
    const q = state.search;
    const list = state.menu.filter(m => (!state.category || (state.category === -1 ? state.popular.includes(m.item_id) : m.category_id === state.category)) && `${m.name} ${m.description}`.toLowerCase().includes(q));
    $("menuCount").textContent = `${plural(list.length, "item", "items")}, prices in tenge`;
    const grid = $("menuGrid"); grid.replaceChildren();
    list.forEach(m => {
      const qty = qtyOf(m.item_id);
      const foot = h("div", { class: "dish-foot" }, h("span", { class: "price" }, money(m.price)));
      if (!m.is_available) foot.append(h("span", { class: "sold-out" }, "Sold out today"));
      else if (qty) foot.append(stepper(m, qty));
      else foot.append(h("button", { class: "add", type: "button", "aria-label": `Add ${m.name} to your order`, disabled: state.busy || !!state.pending || null,
        onclick: () => changeQty(m.item_id, 1) }, "Add"));
      grid.append(h("article", { class: `dish${m.is_available ? "" : " unavailable"}${qty ? " in-cart" : ""}` },
        h("div", { class: "dish-art", style: `--tile-c:${ART.tile(m.category_id)}` }, h("span", { html: ART.svg(m.category_id) }),
          state.popular.includes(m.item_id) ? h("span", { class: "badge-popular", title: "One of the five most ordered items in the last three weeks" }, "Popular") : null),
        h("div", { class: "dish-body" }, h("h3", {}, m.name), h("p", {}, m.description)), foot));
    });
    if (!list.length) grid.append(h("p", { class: "muted" }, "Nothing matches that search. Try another word or category."));
    renderPicks();
  }
  // "Often ordered around this hour", from the last three weeks of orders.
  function renderPicks() {
    const box = $("nowPicks");
    const items = state.nowPicks.map(id => state.menu.find(m => m.item_id === id)).filter(m => m && m.is_available);
    box.hidden = items.length < 2 || state.category !== 0 || !!state.search;
    if (box.hidden) return;
    box.replaceChildren(h("p", { class: "picks-title" }, `Often ordered around ${state.nowHour}:00`),
      h("div", { class: "picks-row" }, items.map(m => {
        const qty = qtyOf(m.item_id);
        return h("div", { class: `pick${qty ? " in-cart" : ""}` },
          h("span", { class: "pick-art", style: `--tile-c:${ART.tile(m.category_id)}`, html: ART.svg(m.category_id) }),
          h("span", { class: "pick-text" }, h("strong", {}, m.name), h("span", {}, money(m.price))),
          qty ? h("span", { class: "pick-in" }, `${qty} in order`)
            : h("button", { class: "add", type: "button", "aria-label": `Add ${m.name} to your order`, disabled: state.busy || !!state.pending || null, onclick: () => changeQty(m.item_id, 1) }, "Add"));
      })));
  }
  function changeQty(id, delta) {
    if (state.busy || state.pending) return;
    const item = state.menu.find(m => m.item_id === id); if (!item) return;
    const line = state.cart.find(x => x.item_id === id);
    if (delta > 0 && !item.is_available) return;
    if (line) line.quantity = Math.max(0, Math.min(20, line.quantity + delta));
    else if (delta > 0) state.cart.push({ item_id: id, quantity: 1 });
    state.cart = state.cart.filter(x => x.quantity > 0);
    // The menu and cart are redrawn, so remember where the keyboard focus was (bug QA-01).
    const active = document.activeElement;
    const zone = active && active.closest ? active.closest("#menuGrid, #cartItems, #nowPicks") : null;
    const label = zone ? active.getAttribute("aria-label") : null;
    saveCart(); renderCart(); renderMenu();
    if (zone) restoreFocus(zone.id, label, item);
  }
  function restoreFocus(zoneId, label, item) {
    const qty = qtyOf(item.item_id);
    const labels = [label, qty ? `Add one more ${item.name}` : `Add ${item.name} to your order`, `Remove one ${item.name}`].filter(Boolean);
    const pick = root => { for (const l of labels) { const el = root.querySelector(`[aria-label="${CSS.escape(l)}"]`); if (el && !el.disabled) return el; } return null; };
    const zone = $(zoneId);
    const target = pick(zone) ||
      (zoneId === "nowPicks" ? zone.querySelector("button:not([disabled])") : null) ||
      (zoneId === "cartItems" ? (zone.querySelector("button:not([disabled])") || $("customerNote")) : null) ||
      pick($("menuGrid"));
    if (target) target.focus({ preventScroll: true });
  }
  function renderCart() {
    const lines = state.pending ? state.pending.items : state.cart;
    const box = $("cartItems"); box.replaceChildren();
    let total = 0, count = 0;
    const loading = !state.menuReady;   // after a reload the saved cart is shown before the menu arrives
    lines.forEach(l => {
      const item = state.menu.find(m => m.item_id === l.item_id);
      const value = item ? Number(item.price) * l.quantity : 0; total += value; count += l.quantity;
      const row = h("div", { class: "line-row" },
        h("span", { class: "line-name" }, item ? item.name : loading ? `${l.quantity} × loading…` : "Item no longer on the menu"),
        h("span", { class: "line-price" }, loading && !item ? "…" : money(value)));
      if (item) row.append(stepper(item, l.quantity, true),
        h("button", { class: "line-remove", type: "button", disabled: state.busy || !!state.pending || null, onclick: () => changeQty(l.item_id, -20) }, "Remove"));
      if (item && !item.is_available) row.append(h("p", { class: "field-msg", style: "grid-column:1/-1" }, "Sold out now. Remove it to continue."));
      box.append(row);
    });
    if (!lines.length) box.append(h("div", { class: "ticket-empty" }, h("strong", {}, "Nothing here yet"), h("span", {}, "Add a drink or something to eat from the menu.")));
    const totalText = loading && lines.length ? "…" : money(total);
    $("cartCount").textContent = count; $("cartTotal").textContent = totalText;
    $("cartBar").hidden = !count || state.view !== "menu";
    $("cartBarCount").textContent = plural(count, "item", "items"); $("cartBarTotal").textContent = totalText;
    const locked = state.busy || !!state.pending;
    ["customerName", "customerNote"].forEach(id => $(id).disabled = locked);
    document.querySelectorAll('#pickupSeg input').forEach(i => i.disabled = locked);
    $("checkoutButton").textContent = state.busy ? "Placing your order…" : state.pending ? "Try the same order again" : "Place order";
    $("checkoutButton").disabled = state.busy || (!state.pending && (!state.menuReady || !lines.length));
  }
  function renderOrderAgain() {
    const last = S.read("cafe.lastItems", null); const box = $("orderAgain");
    const items = (last || []).map(l => ({ ...l, item: state.menu.find(m => m.item_id === l.item_id) })).filter(l => l.item && l.item.is_available);
    box.hidden = !items.length || state.cart.length > 0; box.replaceChildren();
    if (box.hidden) return;
    box.append(h("span", {}, "Last time: ", h("strong", {}, items.map(l => `${l.item.name}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`).join(", "))),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => {
        state.cart = items.map(l => ({ item_id: l.item_id, quantity: l.quantity })); saveCart(); renderCart(); renderMenu(); renderOrderAgain(); toast("Your last order is in the cart."); } }, "Order the same again"));
  }
  async function loadMenu() {
    try {
      const data = await api.getMenu();
      state.menu = data.menu || []; state.categories = data.categories || []; state.menuReady = true;
      renderCategories(); renderMenu(); renderCart(); renderOrderAgain();
    } catch (e) {
      state.menuReady = false;
      $("menuGrid").replaceChildren(h("p", { class: "muted" }, `The menu could not be loaded. ${errorText(e)}`),
        h("button", { class: "btn btn-ghost", type: "button", onclick: loadMenu }, "Load the menu again"));
      renderCart();
    }
  }
  async function loadInsights() {
    try {
      const p = await api.publicInsights();
      state.popular = p.popular_item_ids || [];
      state.nowPicks = p.now_picks || []; state.nowHour = p.now_hour ?? new Date().getHours();
      renderCategories(); renderMenu();
      const hours = (p.avg_orders_by_hour || []).filter(x => x.hour >= 8 && x.hour <= 20);
      if (!hours.length || !hours.some(x => x.avg_orders > 0)) return;
      const max = Math.max(...hours.map(x => x.avg_orders));
      const now = new Date().getHours();
      const open = hours.filter(x => x.hour < 19);
      const quiet = open.reduce((a, b) => b.avg_orders < a.avg_orders ? b : a);
      const busy = hours.reduce((a, b) => b.avg_orders > a.avg_orders ? b : a);
      $("busyText").textContent = `Usually busiest at ${busy.hour}:00 and quietest around ${quiet.hour}:00.`;
      $("busyBars").setAttribute("aria-label", hours.map(x => `${x.hour}:00 about ${x.avg_orders} orders`).join(", "));
      $("busyBars").replaceChildren(...hours.map(x => h("span", { class: `busy-bar${x.hour === now ? " now" : ""}`, title: `${x.hour}:00, about ${x.avg_orders} orders per day` },
        h("i", { style: `height:${Math.max(6, x.avg_orders / max * 100)}%` }), h("b", {}, x.hour % 2 === 0 ? x.hour : ""))));
      $("busyStrip").hidden = false;
    } catch { /* insights are optional */ }
  }
  async function loadQueue() {
    try {
      const q = await api.queueInfo(); $("queueCard").classList.remove("offline");
      $("queueWait").textContent = q.active_orders ? `Ready in about ${q.estimated_wait_minutes} min` : `Ready in about ${Math.ceil(q.avg_prep_minutes)} min`;
      $("queueText").textContent = q.active_orders ? `${plural(q.active_orders, "order is", "orders are")} being made right now` : "No queue at the bar right now";
    } catch {
      $("queueCard").classList.add("offline"); $("queueWait").textContent = "Live estimate unavailable"; $("queueText").textContent = "You can still place an order";
    }
  }

  $("menuSearch").addEventListener("input", e => { state.search = e.target.value.trim().toLowerCase(); renderMenu(); });
  $("customerNote").addEventListener("input", e => { $("noteCount").textContent = `${e.target.value.length}/140`; });

  // mobile sheet
  function openSheet(open) {
    $("cart").classList.toggle("open", open);
    document.querySelector(".scrim")?.remove();
    if (open) { document.body.append(h("div", { class: "scrim", onclick: () => openSheet(false) })); $("cartClose").focus(); }
  }
  $("cartBarButton").addEventListener("click", () => openSheet(true));
  $("cartClose").addEventListener("click", () => openSheet(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("cart").classList.contains("open")) openSheet(false); });

  $("checkoutForm").addEventListener("submit", async e => {
    e.preventDefault(); if (state.busy) return;
    $("checkoutMessage").textContent = "";
    let request = state.pending; let confirmed = false;
    try {
      if (!request) {
        const checked = D.validateOrder($("customerName").value, state.cart);
        D.priceOrder(checked.items, state.menu);
        const pickup = Number(document.querySelector('#pickupSeg input:checked').value) || null;
        request = { ...checked, note: $("customerNote").value.trim(), pickup, token: D.uuid() };
        S.write("cafe.pending", request); state.pending = request;
      }
      state.busy = true; renderCart(); renderMenu();
      const order = await api.placeOrder(request.name, request.items, request.token, request.note, request.pickup);
      confirmed = true;
      S.write("cafe.lastToken", request.token);
      S.write("cafe.lastItems", request.items);
      S.remove("cafe.pending"); state.pending = null; state.cart = []; saveCart();
      $("customerName").value = ""; $("customerNote").value = ""; $("noteCount").textContent = "0/140";
      $("orderDot").hidden = false;
      openSheet(false); chime();
      toast(`Order #${order.order_number} placed. Thank you, ${order.customer_first_name}!`);
      location.hash = `order/${request.token}`;
    } catch (err) {
      if (!err.uncertain && !confirmed) { state.pending = null; S.remove("cafe.pending"); }
      $("checkoutMessage").textContent = state.pending ? "We could not confirm the order. Try the same order again: it will not be placed twice." : errorText(err);
    } finally { state.busy = false; renderCart(); renderMenu(); }
  });

  /* ================================================================ ORDER PAGE */
  let lastStatus = null;
  function readyAround(o) {
    const minutes = Number(o.avg_prep_minutes || 10) + 2 * Number(o.orders_ahead || 0);
    return new Date(Date.parse(o.created_at) + minutes * 60000);
  }
  function renderTrack(o, token) {
    const root = $("trackRoot"); root.replaceChildren();
    if (!o) {
      root.append(h("div", { class: "empty-state" }, h("h1", {}, token ? "We could not find that order" : "No order yet"),
        h("p", {}, token ? "The link may be incomplete. Ask the café for your order number, or place a new order." : "Place an order and you can follow it here, from the bar to the pickup shelf."),
        h("a", { class: "btn btn-primary", href: "#menu" }, "Go to the menu")));
      return;
    }
    const idx = D.statuses.indexOf(o.status);
    const at = s => o.history.find(x => x.new_status === s)?.changed_at;
    let headline, sub;
    if (o.status === "Ready") { headline = o.shelf_slot ? `Ready on shelf ${o.shelf_slot}` : "Ready at the counter"; sub = `Pay at the counter and pick up the bag with #${o.order_number}.`; }
    else if (o.status === "Collected") { headline = "Collected. Enjoy!"; sub = `Picked up at ${hm(at("Collected"))}. Thank you for ordering ahead.`; }
    else {
      const eta = readyAround(o); const late = eta.getTime() < Date.now();
      headline = late ? "Almost ready" : `Ready around ${hm(eta.toISOString())}`;
      sub = Number(o.orders_ahead) ? `${plural(Number(o.orders_ahead), "order is", "orders are")} ahead of yours.` : (o.status === "Preparing" ? "The barista is making it now." : "Yours is next in line.");
    }
    const fill = h("span", { class: "fill", style: `width:${idx / 3 * 76}%` });
    const rail = h("ol", { class: "rail", "aria-label": "Order progress" }, fill,
      D.statuses.map((s, i) => h("li", { class: i < idx ? "done" : i === idx ? "done current" : "", "aria-current": i === idx ? "step" : null },
        s, h("time", {}, at(s) ? hm(at(s)) : "–"))));
    const tags = h("div", { class: "ot-meta" });
    if (o.pickup_at) tags.append(h("span", { class: "tag" }, `Pickup at ${hm(o.pickup_at)}`));
    if (o.customer_note) tags.append(h("span", { class: "tag" }, `Note: ${o.customer_note}`));
    const link = `${location.origin}${location.pathname}#order/${token}`;
    const actions = h("div", { class: "ot-actions" },
      h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast("Order link copied. Open it on any phone to follow this order."); }
        catch { prompt("Copy your private order link:", link); } } }, "Copy order link"),
      "Notification" in window && Notification.permission !== "granted" && o.status !== "Collected"
        ? h("button", { class: "btn btn-ghost", type: "button", onclick: async () => {
            const p = await Notification.requestPermission(); toast(p === "granted" ? "We will tell you when your order is ready." : "Alerts are off. Keep this page open instead."); renderTrack(o, token); } }, "Alert me when ready")
        : null,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => loadTrack(true) }, "Refresh"));
    const ticket = h("article", { class: `order-ticket${o.status === "Ready" ? " is-ready" : ""}`, "aria-live": "polite" },
      h("div", { class: "ot-top" }, h("span", { class: "ot-label" }, "Order"), h("span", { class: "ot-number" }, `#${o.order_number}`), h("span", { class: "ot-name" }, `for ${o.customer_first_name}`)),
      h("p", { class: "ot-headline" }, headline), h("p", { class: "ot-sub" }, sub), rail, tags,
      h("ul", { class: "ot-lines" }, o.items.map(i => h("li", {}, h("span", {}, `${i.quantity} × ${i.name}`), h("span", {}, money(i.quantity * i.unit_price))))),
      h("div", { class: "ot-total" }, h("span", {}, "To pay at the counter"), h("span", {}, money(o.total_price))), actions,
      o.status === "Collected" ? rateBlock(o, token) : null,
      h("p", { class: "fine", style: "text-align:left;margin-top:14px" }, o.status === "Collected" ? `Checked at ${new Date().toLocaleTimeString("en-GB")}.` : `Checked at ${new Date().toLocaleTimeString("en-GB")}. This page refreshes by itself.`));
    const qr = window.CafeQR ? h("div", { class: "order-qr", html: window.CafeQR.svg(link, { label: `QR code with the link to order ${o.order_number}`, dark: "#17221D", light: "#FFFFFF" }) }) : null;
    const side = h("aside", {},
      h("div", { class: "side-card" }, h("h2", {}, "How pickup works"),
        h("ol", {}, h("li", {}, "The barista starts your order and this page moves to Preparing."),
          h("li", {}, "When it is ready, the bag goes on the pickup shelf and this page shows the shelf number."),
          h("li", {}, "Pay at the counter and lift your bag. The shelf sensor marks it as collected."))),
      qr ? h("div", { class: "side-card side-qr" }, h("h2", {}, "Follow on another phone"),
        h("details", {}, h("summary", {}, "Show the QR code"), qr,
          h("p", { class: "muted" }, "Scan it with a friend’s phone to follow the same order."))) : null,
      h("div", { class: "side-card" }, h("h2", {}, "Keep this link private"),
        h("p", { class: "muted" }, "Anyone with the order link can see this order's items and first name. It shows nothing else about you.")));
    root.append(h("div", { class: "track" }, ticket, side));
  }

  // Rating after pickup: 1-5 stars and an optional comment, sent with the private order token.
  const RATE_WORDS = ["Bad", "Not good", "OK", "Good", "Great"];
  const starText = n => "★".repeat(n) + "☆".repeat(5 - n);
  function rateBlock(o, token) {
    const box = h("div", { class: "rate" });
    const draw = editing => {
      box.replaceChildren();
      if (o.feedback && !editing) {
        box.append(h("p", { class: "rate-title" }, h("span", { class: "rate-stars-static", "aria-hidden": "true" }, starText(o.feedback.rating)),
            ` You rated this order ${o.feedback.rating} of 5. Thank you!`),
          o.feedback.comment ? h("p", { class: "rate-comment" }, `“${o.feedback.comment}”`) : null,
          h("button", { class: "link-btn", type: "button", onclick: () => draw(true) }, "Change my rating"));
        return;
      }
      let chosen = o.feedback?.rating || 0;
      const hint = h("span", { class: "rate-hint", "aria-live": "polite" }, chosen ? RATE_WORDS[chosen - 1] : "Choose a star");
      const labels = [1, 2, 3, 4, 5].map(n => h("label", { class: n <= chosen ? "on" : "" },
        h("input", { type: "radio", name: `rate-${o.order_number}`, value: String(n), checked: n === chosen || null, onchange: () => {
          chosen = n; hint.textContent = RATE_WORDS[n - 1]; send.disabled = false;
          labels.forEach((l, i) => l.classList.toggle("on", i < n));
        } }),
        h("span", { "aria-hidden": "true" }, "★"), h("span", { class: "sr-only" }, `${n} of 5, ${RATE_WORDS[n - 1]}`)));
      const comment = h("textarea", { id: "rateComment", rows: "2", maxlength: "200", placeholder: "What was good? What could be better? (optional)" });
      if (o.feedback?.comment) comment.value = o.feedback.comment;
      const msg = h("p", { class: "field-msg", role: "status" });
      const send = h("button", { class: "btn btn-primary btn-sm", type: "submit", disabled: !chosen || null }, "Send rating");
      box.append(h("form", { onsubmit: async e => {
        e.preventDefault(); if (!chosen) return;
        send.disabled = true; send.textContent = "Sending…"; msg.textContent = "";
        try { o.feedback = await api.submitFeedback(token, chosen, comment.value.trim()); draw(false); toast("Thank you! The café sees your rating."); }
        catch (err) { msg.textContent = errorText(err); send.disabled = false; send.textContent = "Send rating"; }
      } },
        h("fieldset", { class: "rate-set" }, h("legend", { class: "rate-title" }, "How was your order?"),
          h("div", { class: "stars" }, labels, hint)),
        h("label", { class: "sr-only", for: "rateComment" }, "Comment for the café"), comment, msg,
        h("div", { class: "rate-actions" }, send, o.feedback ? h("button", { class: "link-btn", type: "button", onclick: () => draw(false) }, "Cancel") : null)));
    };
    draw(false);
    return box;
  }
  async function loadTrack(manual) {
    const fromHash = location.hash.match(/^#order\/([0-9a-f-]{36})$/i)?.[1];
    const token = fromHash || S.read("cafe.lastToken", null);
    if (fromHash) S.write("cafe.lastToken", fromHash);
    if (!token) { renderTrack(null, null); return; }
    try {
      const o = await api.getOrder(token);
      // do not wipe a rating the customer is still writing
      if (!manual && o && o.status === "Collected" && lastStatus === "Collected" && document.activeElement?.closest(".rate")) return;
      if (o && lastStatus && lastStatus !== o.status && o.status === "Ready") {
        chime(); navigator.vibrate?.(200);
        toast(o.shelf_slot ? `Order #${o.order_number} is ready on shelf ${o.shelf_slot}.` : `Order #${o.order_number} is ready.`);
        if ("Notification" in window && Notification.permission === "granted") new Notification(`Order #${o.order_number} is ready`, { body: o.shelf_slot ? `Collect it from shelf ${o.shelf_slot}.` : "Collect it at the counter.", icon: "assets/icons/logo.svg" });
      }
      lastStatus = o ? o.status : null;
      $("orderDot").hidden = !o || o.status === "Collected";
      renderTrack(o, token);
      if (manual) toast("Status updated.");
    } catch (e) { if (manual || !$("trackRoot").childElementCount) toast(`Could not load the order. ${errorText(e)}`, "error"); }
  }

  /* ================================================================ STAFF */
  async function loadStaff() {
    const root = $("staffRoot"); root.replaceChildren(h("p", { class: "muted", style: "padding:40px 0" }, "Opening the counter…"));
    try { state.staff = await api.getStaff(); } catch { state.staff = null; }
    state.staff ? renderDashboard() : renderLogin();
  }
  function renderLogin() {
    const root = $("staffRoot"); root.replaceChildren();
    const msg = h("p", { class: "field-msg", role: "status" });
    const card = h("div", { class: "login-card" }, h("h1", {}, "Staff sign in"));
    if (mode === "demo") {
      card.append(h("p", {}, "Demo mode has no password. Orders here live only in this browser."),
        h("button", { class: "btn btn-primary btn-block", type: "button", onclick: async () => { state.staff = await api.login(); beep(); renderDashboard(); } }, "Open the demo counter"));
    } else {
      const email = h("input", { id: "staffEmail", type: "email", autocomplete: "username", required: true });
      const pass = h("input", { id: "staffPassword", type: "password", autocomplete: "current-password", required: true });
      const btn = h("button", { class: "btn btn-primary btn-block", type: "submit", style: "margin-top:16px" }, "Sign in");
      card.append(h("p", {}, "Use your café staff account."),
        h("form", { onsubmit: async e => {
          e.preventDefault(); btn.disabled = true; btn.textContent = "Signing in…"; msg.textContent = "";
          try { state.staff = await api.login(email.value.trim(), pass.value); pass.value = ""; beep(); renderDashboard(); }
          catch (err) { msg.textContent = errorText(err); }
          finally { btn.disabled = false; btn.textContent = "Sign in"; }
        } }, h("div", { class: "field" }, h("label", { for: "staffEmail" }, "E-mail"), email),
          h("div", { class: "field" }, h("label", { for: "staffPassword" }, "Password"), pass), msg, btn));
    }
    root.append(card);
  }
  function renderDashboard() {
    clearTimers();
    const isManager = state.staff.role === "manager";
    const tabs = [["board", "Orders"], ["shelf", "Pickup shelf"], ...(isManager ? [["insights", "Insights"], ["menu", "Menu & prices"]] : [])];
    if (!tabs.some(t => t[0] === state.staffTab)) state.staffTab = "board";
    const panel = h("div", { id: "staffPanel", role: "tabpanel" });
    const tabBar = h("div", { class: "tabs", role: "tablist", "aria-label": "Counter sections" },
      tabs.map(([id, label]) => h("button", { class: "tab", role: "tab", type: "button", id: `tab-${id}`, "aria-selected": String(state.staffTab === id),
        onclick: () => { state.staffTab = id; renderDashboard(); } }, label)));
    panel.setAttribute("aria-labelledby", `tab-${state.staffTab}`);
    $("staffRoot").replaceChildren(h("div", { class: "staff" },
      h("div", { class: "staff-top" },
        h("div", {}, h("h1", {}, "Counter"), h("p", { class: "staff-who" }, `Signed in as ${state.staff.display_name} (${state.staff.role})`)),
        tabBar,
        h("a", { class: "btn btn-ghost btn-sm", href: "screen.html", target: "_blank", rel: "noopener", title: "Order numbers for a TV at the counter" }, "Pickup screen"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await api.logout(); state.staff = null; clearTimers(); renderLogin(); toast("Signed out."); } }, "Sign out")),
      panel));
    ({ board: showBoard, shelf: showShelf, insights: showInsights, menu: showMenuAdmin })[state.staffTab](panel);
  }

  // --- board
  function age(o) {
    const since = o.status === "Ready" ? (o.history.find(x => x.new_status === "Ready")?.changed_at || o.created_at) : o.created_at;
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));
    return { text: s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, mins: s / 60 };
  }
  function slip(o, fresh) {
    const a = age(o);
    const labels = { Received: "Start preparing", Preparing: "Mark as ready", Ready: "Mark as collected" };
    const btn = h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => {
      btn.disabled = true;
      try { await api.advanceOrder(o.order_id, o.status); await refreshBoard(); }
      catch (e) { toast(errorText(e), "error"); await refreshBoard(); }
    } }, labels[o.status]);
    const tags = h("div", { class: "slip-tags" });
    if (o.pickup_at) tags.append(h("span", { class: "tag" }, `Pickup ${hm(o.pickup_at)}`));
    if (o.status === "Ready") tags.append(h("span", { class: "tag" }, o.shelf_slot ? (o.on_shelf ? `On shelf ${o.shelf_slot}` : `Put on shelf ${o.shelf_slot}`) : "Shelf full: hand over at the counter"));
    return h("article", { class: `slip${fresh ? " is-new" : ""}`, "data-id": o.order_id },
      h("div", { class: "slip-top" }, h("span", { class: "slip-num" }, `#${o.order_number}`), h("span", { class: "slip-name" }, o.customer_first_name),
        h("span", { class: `age${a.mins >= 20 ? " late" : a.mins >= 10 ? " warn" : ""}`, "data-age": o.order_id, title: o.status === "Ready" ? "Time on the shelf" : "Time since the order arrived" }, a.text)),
      tags.childElementCount ? tags : null,
      o.customer_note ? h("p", { class: "slip-note" }, o.customer_note) : null,
      h("ul", {}, o.items.map(i => h("li", {}, h("span", {}, `${i.quantity} × ${i.name}`), h("span", {}, money(i.quantity * i.unit_price))))),
      h("details", {}, h("summary", {}, `Total ${money(o.total_price)}, history`),
        o.history.map(x => h("div", {}, `${x.new_status} at ${hm(x.changed_at)}${x.changed_by ? ` by ${x.changed_by}` : ""}`))),
      btn);
  }
  function drawBoard(panel, q) {
    const active = s => state.orders.filter(o => o.status === s).sort((a, b) => a.order_number - b.order_number);
    const kpis = h("div", { class: "kpis" },
      [["New", active("Received").length], ["Preparing", active("Preparing").length], ["Ready on the shelf", active("Ready").length],
       ["Average prep time", q ? `${q.avg_prep_minutes} min` : "–"]].map(([l, v]) => h("div", { class: "kpi" }, h("strong", {}, v), h("span", {}, l))));
    const cols = h("div", { class: "board" }, [["Received", "New"], ["Preparing", "Preparing"], ["Ready", "Ready"]].map(([s, title]) => {
      const list = active(s);
      return h("section", { class: "column", "data-col": s, "aria-label": `${title} orders` },
        h("div", { class: "column-head" }, h("h2", {}, title), h("span", { class: "ticket-count" }, list.length)),
        list.length ? list.map(o => slip(o, state.knownIds && !state.knownIds.has(o.order_id))) : h("p", { class: "empty-col" }, s === "Received" ? "No new orders. New ones appear here by themselves." : "Nothing here."));
    }));
    const done = state.orders.filter(o => o.status === "Collected").slice(0, 10);
    const table = h("div", { class: "collected-list" }, h("h2", {}, "Recently collected"),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Order", "Name", "Items", "Total", "Collected", "By", "Rating"].map(t => h("th", { scope: "col" }, t)))),
        h("tbody", {}, done.map(o => { const c = o.history.find(x => x.new_status === "Collected");
          return h("tr", {}, h("th", { scope: "row" }, `#${o.order_number}`), h("td", {}, o.customer_first_name), h("td", {}, o.items.reduce((a, i) => a + i.quantity, 0)),
            h("td", {}, money(o.total_price)), h("td", {}, c ? hm(c.changed_at) : "–"), h("td", {}, c?.changed_by || "–"),
            h("td", { title: o.feedback?.comment || null }, o.feedback ? `${o.feedback.rating} ★` : "–")); })))));
    panel.replaceChildren(kpis, cols, table);
  }
  let boardQueue = null;
  async function refreshBoard() {
    const panel = $("staffPanel"); if (!panel || state.staffTab !== "board") return;
    try {
      const [orders, q] = await Promise.all([api.getOrders(), api.queueInfo().catch(() => null)]);
      const fresh = orders.filter(o => o.status === "Received" && state.knownIds && !state.knownIds.has(o.order_id));
      state.orders = orders; boardQueue = q || boardQueue;
      drawBoard(panel, boardQueue);
      if (fresh.length) { beep(); fresh.forEach(o => toast(`New order #${o.order_number} from ${o.customer_first_name}`)); }
      state.knownIds = new Set(orders.map(o => o.order_id));
    } catch (e) {
      if (e.status === 401 || /staff account|Sign in/i.test(errorText(e))) { state.staff = null; renderLogin(); toast("Your session ended. Sign in again.", "error"); return; }
      toast(`Could not refresh orders. ${errorText(e)}`, "error");
    }
  }
  function showBoard(panel) {
    panel.append(h("p", { class: "muted" }, "Loading orders…"));
    refreshBoard();
    every(CFG.poll.board, refreshBoard);
    every(1000, () => state.orders.forEach(o => { const el = document.querySelector(`[data-age="${o.order_id}"]`); if (el) { const a = age(o); el.textContent = a.text; el.className = `age${a.mins >= 20 ? " late" : a.mins >= 10 ? " warn" : ""}`; } }));
  }

  // --- smart shelf
  function showShelf(panel) {
    const head = h("div", { class: "shelf-head" });
    const grid = h("div", { class: "shelf" });
    const log = h("ul", { class: "event-log", "aria-live": "polite" });
    panel.replaceChildren(
      h("p", { class: "muted", style: "max-width:70ch;margin-bottom:14px" }, "Each shelf slot has a weight sensor. When a ready order is on the shelf and the customer lifts the bag, the sensor reports the drop and the order is marked as collected automatically."),
      head, grid, h("h2", { style: "font-size:20px;margin-top:22px" }, "Sensor events"), log);
    const draw = s => {
      const ago = s.last_reading_at ? Math.round((Date.now() - Date.parse(s.last_reading_at)) / 1000) : null;
      head.replaceChildren(
        h("span", { class: `device${s.device_online ? " online" : ""}` }, h("i"), s.device_online ? "Shelf sensor online" : "Shelf sensor offline"),
        h("span", { class: "muted" }, ago === null ? "No readings yet" : `Last reading ${ago} s ago, ${s.readings_last_hour} readings in the last hour`),
        h("a", { class: "btn btn-ghost btn-sm", href: "shelf-simulator.html", target: "_blank", rel: "noopener" }, "Open the shelf simulator"));
      grid.replaceChildren(...s.slots.map(sl => {
        const bag = sl.order_number && sl.placed_at;
        const stateText = !sl.order_number ? (sl.weight_g >= 100 ? "Something is on this slot, but no order is assigned" : "Free")
          : bag ? `Bag on the shelf for ${sl.customer_first_name}` : `Waiting for the bag of ${sl.customer_first_name}`;
        return h("div", { class: `slot${bag ? " has-bag" : ""}` }, h("span", { class: "slot-no" }, `Slot ${sl.slot}`),
          h("span", { class: "slot-order" }, sl.order_number ? `#${sl.order_number}` : "Empty"),
          h("span", { class: "slot-state" }, stateText),
          h("div", { class: "gauge", role: "img", "aria-label": `Weight ${sl.weight_g} grams` }, h("span", { style: `width:${Math.min(100, sl.weight_g / 10)}%` })),
          h("span", { class: "slot-weight" }, `${sl.weight_g} g`));
      }));
      // events from the difference between two readings of the shelf
      const prev = state.lastShelf;
      if (prev) s.slots.forEach(sl => {
        const p = prev.slots.find(x => x.slot === sl.slot);
        if (p && p.order_number && p.placed_at && !sl.order_number) state.shelfLog.unshift(`${hm(new Date().toISOString())}: order #${p.order_number} lifted from slot ${sl.slot}, marked as collected`);
        if (sl.order_number && sl.placed_at && !(p && p.placed_at)) state.shelfLog.unshift(`${hm(new Date().toISOString())}: bag for order #${sl.order_number} placed on slot ${sl.slot}`);
        if (sl.order_number && !(p && p.order_number)) state.shelfLog.unshift(`${hm(new Date().toISOString())}: slot ${sl.slot} reserved for order #${sl.order_number}`);
      });
      state.lastShelf = s; state.shelfLog = state.shelfLog.slice(0, 12);
      log.replaceChildren(...(state.shelfLog.length ? state.shelfLog.map(t => h("li", {}, t)) : [h("li", { class: "muted" }, "Events appear here while the sensor is sending readings.")]));
    };
    const tick = async () => { try { draw(await api.shelfStatus()); } catch (e) { head.replaceChildren(h("span", { class: "muted" }, `Shelf status unavailable. ${errorText(e)}`)); } };
    tick(); every(CFG.poll.shelf, tick);
  }

  // --- insights (manager)
  async function showInsights(panel) {
    const days = state.statsDays;
    const period = h("div", { class: "period", role: "group", "aria-label": "Period" },
      [[7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, l]) => h("button", { class: "chip", type: "button", "aria-pressed": String(d === days),
        onclick: () => { state.statsDays = d; renderDashboard(); } }, l)));
    panel.replaceChildren(h("div", { class: "insights-head" }, h("h2", { style: "font-size:24px" }, "What the orders tell us"), period), h("p", { class: "muted" }, "Loading statistics…"));
    let s, fb;
    try { [s, fb] = await Promise.all([api.managerStats(days), api.managerFeedback(days).catch(() => null)]); }
    catch (e) { panel.lastChild.textContent = `Statistics unavailable. ${errorText(e)}`; return; }
    if (state.staffTab !== "insights") return;
    const src = `Source: ${mode === "demo" ? "demo data in this browser" : "café database"}, orders from the last ${days} days.`;
    const hours = []; for (let hr = 7; hr <= 21; hr++) hours.push({ label: `${String(hr).padStart(2, "0")}:00`, short: String(hr), value: (s.by_hour.find(x => x.hour === hr) || {}).orders || 0 });
    const daysData = s.by_day.map(d => ({ label: d.day, short: d.day.slice(5).replace("-", "."), value: Number(d.revenue) }));
    const st = s.stage_minutes || {};
    const kpis = h("div", { class: "kpis" },
      [[s.totals.orders, "Orders"], [money(s.totals.revenue), "Revenue"], [money(s.totals.avg_order_value || 0), "Average order"], [`${s.avg_prep_minutes} min`, "Average time to ready"]]
        .map(([v, l]) => h("div", { class: "kpi" }, h("strong", {}, v), h("span", {}, l))));
    const charts = h("div", { class: "charts" });
    charts.innerHTML =
      C.bars({ title: "When do customers order?", data: hours, xTitle: "Hour of the day (Astana time)", yTitle: "Orders", note: `${src} Counted by the hour the order was placed.` }) +
      C.hbars({ title: "Best sellers", data: s.top_items.map(t => ({ label: t.name, value: Number(t.quantity) })), xTitle: "Portions sold", labelTitle: "Menu item", note: `${src} Top 8 items by quantity.` }) +
      C.line({ title: "Revenue per day", data: daysData, xTitle: "Date", yTitle: "Revenue (KZT)", note: `${src} Sum of quantity × saved unit price.`, valueLabel: v => money(v) }) +
      C.stages({ title: "Where the time goes", parts: [{ label: "Waiting to start", value: st.received_to_preparing }, { label: "Preparing", value: st.preparing_to_ready }, { label: "On the shelf until pickup", value: st.ready_to_collected }], note: `${src} Average minutes between status changes in order_status_history.` });
    C.attachTooltips(charts);
    const csv = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => {
      const rows = [["date", "orders", "revenue_kzt"], ...s.by_day.map(d => [d.day, d.orders, d.revenue])].map(r => r.join(",")).join("\n");
      const a = h("a", { href: URL.createObjectURL(new Blob([rows], { type: "text/csv" })), download: `corner-cafe-orders-${days}d.csv` }); document.body.append(a); a.click(); a.remove();
    } }, "Download daily totals (CSV)");
    panel.replaceChildren(h("div", { class: "insights-head" }, h("h2", { style: "font-size:24px" }, "What the orders tell us"), h("div", { class: "period" }, period, csv)), kpis, charts,
      fb ? ratingsCard(fb, days) : null,
      h("p", { class: "data-note" }, "Most orders in the database are generated test data (marked is_test_data = true in the orders table); orders placed through the website, including our user tests, are not marked. The charts show that the analysis works; they do not describe real customer habits yet."));
  }

  function ratingsCard(fb, days) {
    const count = Number(fb.count) || 0;
    const max = Math.max(1, ...fb.by_rating.map(r => Number(r.n)));
    const share = fb.collected ? Math.round(count / fb.collected * 100) : 0;
    const head = h("div", { class: "ratings-score" },
      h("strong", {}, fb.avg_rating === null || fb.avg_rating === undefined ? "–" : Number(fb.avg_rating).toFixed(1)),
      h("span", { class: "ratings-of" }, "out of 5"),
      h("p", { class: "muted" }, count ? `${plural(count, "rating", "ratings")} for ${share}% of the orders collected in the last ${days} days` : "No customer ratings yet in this period."),
      Number(fb.test_ratings) ? h("p", { class: "muted ratings-test" }, `${plural(Number(fb.test_ratings), "rating", "ratings")} on test orders (“QA test”, “Load test”) ${Number(fb.test_ratings) === 1 ? "is" : "are"} not counted here.`) : null);
    const bars = h("ul", { class: "ratings-bars", "aria-label": "Number of ratings by stars" },
      [...fb.by_rating].sort((a, b) => b.rating - a.rating).map(r => h("li", {},
        h("span", { class: "rb-label" }, `${r.rating} ★`),
        h("span", { class: "rb-track" }, h("i", { style: `width:${Number(r.n) / max * 100}%` })),
        h("span", { class: "rb-n" }, r.n))));
    const list = fb.recent && fb.recent.length
      ? h("ul", { class: "ratings-comments" }, fb.recent.map(c => h("li", {},
          h("span", { class: "rc-meta" }, `${starText(c.rating)}  #${c.order_number}, ${new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`),
          h("span", {}, c.comment))))
      : h("p", { class: "muted" }, "Comments appear here when customers write one. Customers rate an order on its page after they collect it.");
    return h("section", { class: "ratings chart", "aria-labelledby": "ratingsTitle" },
      h("h3", { class: "chart-title", id: "ratingsTitle" }, "Customer ratings"),
      h("div", { class: "ratings-grid" }, head, bars, h("div", {}, h("h4", { class: "rc-title" }, "Latest comments"), list)),
      h("p", { class: "chart-note" }, `Source: ${mode === "demo" ? "demo data in this browser (seeded star ratings)" : "order_feedback table; an order can be rated only after it is collected"}.`));
  }

  // --- menu & prices (manager)
  async function showMenuAdmin(panel) {
    await loadMenu();
    const rows = state.menu.map(m => {
      const price = h("input", { class: "price-input", type: "number", min: "100", max: "20000", step: "50", value: String(Number(m.price)), "aria-label": `Price of ${m.name} in tenge` });
      const save = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => {
        save.disabled = true;
        try { await api.setPrice(m.item_id, Number(price.value)); toast(`${m.name} now costs ${money(price.value)}.`); await loadMenu(); }
        catch (e) { toast(errorText(e), "error"); } finally { save.disabled = false; } } }, "Save price");
      const sw = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(m.is_available), "aria-label": `${m.name} available today`, onclick: async () => {
        sw.disabled = true;
        try { await api.setAvailability(m.item_id, !m.is_available); toast(`${m.name} is ${m.is_available ? "now sold out" : "available again"}.`); await loadMenu(); showMenuAdmin(panel); }
        catch (e) { toast(errorText(e), "error"); sw.disabled = false; } } });
      return h("tr", {}, h("th", { scope: "row" }, m.name), h("td", {}, state.categories.find(c => c.category_id === m.category_id)?.name || ""),
        h("td", {}, h("div", { class: "row-actions" }, price, save)), h("td", {}, sw));
    });
    panel.replaceChildren(h("div", { class: "menu-admin" },
      h("div", { class: "admin-head" },
        h("p", { class: "muted" }, "Changes reach the customer menu straight away. Orders already placed keep the price they were placed with."),
        h("a", { class: "btn btn-ghost btn-sm", href: "poster.html", target: "_blank", rel: "noopener" }, "Print a scan-to-order poster")),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Item", "Category", "Price (KZT)", "Available"].map(t => h("th", { scope: "col" }, t)))), h("tbody", {}, rows)))));
  }

  /* ================================================================ ROUTER */
  async function route() {
    clearTimers(); openSheet(false);
    const hash = location.hash.slice(1);
    state.view = hash.startsWith("order") ? "order" : hash === "staff" ? "staff" : "menu";
    ["menu", "order", "staff"].forEach(v => {
      $(`view-${v}`).hidden = v !== state.view;
      const a = document.querySelector(`[data-nav="${v}"]`); if (v === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    renderCart();
    if (state.view === "menu") { if (state.menuReady) renderOrderAgain(); loadQueue(); every(CFG.poll.queue, loadQueue); }   // BUG-01: show "Order the same again" without a reload
    if (state.view === "order") { lastStatus = null; await loadTrack(); every(CFG.poll.track, () => { if (lastStatus !== "Collected") loadTrack(); }); }
    if (state.view === "staff") await loadStaff();
    if (hash && hash !== "menu") window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", e => { // demo mode: keep tabs in sync (e.g. the simulator)
    if (mode === "demo" && e.key === "cafe.demo.v2") { if (state.view === "order") loadTrack(); }
  });
  $("orderDot").hidden = !S.read("cafe.lastToken", null);
  // Usability-test timer (Success criterion 1): open index.html?test=1 on the tester's phone.
  if (new URLSearchParams(location.search).has("test")) {
    let start = null, tick = null;
    const out = h("strong", { class: "tnum" }, "0:00");
    const info = h("span", {}, `Screen width ${window.innerWidth}px`);
    const startBtn = h("button", { class: "btn btn-yolk btn-sm", type: "button", onclick: () => {
      start = performance.now(); startBtn.hidden = true; info.textContent = "Timing. Stops when the order is confirmed.";
      tick = setInterval(() => { const s = Math.floor((performance.now() - start) / 1000); out.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 250);
    } }, "Start the task");
    const panel = h("div", { class: "test-timer", role: "region", "aria-label": "Test timer" }, h("span", {}, "Test timer"), out, info, startBtn);
    document.querySelector(".topbar").after(panel);   // a slim bar under the header, so it never covers the menu
    window.addEventListener("hashchange", () => {
      if (start && location.hash.startsWith("#order/")) {
        clearInterval(tick); const secs = Math.round((performance.now() - start) / 100) / 10;
        const runs = S.read("cafe.testRuns", []); runs.push({ at: new Date().toISOString(), seconds: secs, width: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth });
        S.write("cafe.testRuns", runs); start = null;
        out.textContent = `${secs} s`; info.textContent = secs <= 120 ? "Done within 2 minutes." : "Took longer than 2 minutes."; startBtn.hidden = false; startBtn.textContent = "Start again";
      }
    });
  }
  /* ================================================================ INSTALLABLE APP */
  // The service worker keeps a copy of the site so it opens even with a weak connection.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("installApp").hidden = false; });
  window.addEventListener("appinstalled", () => { $("installApp").hidden = true; toast("Corner Café is on your home screen now."); });
  $("installApp").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; $("installApp").hidden = true;
  });

  loadMenu().then(loadInsights); route();
})();
