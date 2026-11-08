/* Corner Café pickup screen: order numbers in progress and ready, for a TV at the counter.
   Uses cafe_public_board, which returns order numbers and shelf numbers only (no names, no items). */
(function () {
  "use strict";
  const A = window.CafeApi, CFG = window.CAFE_CONFIG;
  const mode = A.currentMode(), api = A.create(mode);
  const $ = id => document.getElementById(id);
  const MAX_PROGRESS = 15, MAX_READY = 9;
  let known = null, sound = false, audioCtx = null;
  const fresh = new Map();   // order number -> when it became ready on this screen

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function chime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [[660, 0], [880, .2]].forEach(([f, d]) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; g.gain.value = .12; o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + .25); });
    } catch {}
  }

  function render(b) {
    const prog = b.in_progress || [], ready = b.ready || [];
    const now = Date.now();
    const readyNums = ready.map(r => r.order_number);
    if (known) {
      const added = readyNums.filter(n => !known.has(n));
      added.forEach(n => fresh.set(n, now));
      if (added.length && sound) chime();
    }
    known = new Set(readyNums);
    for (const [n, t] of fresh) if (now - t > 60000 || !known.has(n)) fresh.delete(n);

    const pl = $("tvProgress"); pl.replaceChildren();
    prog.slice(0, MAX_PROGRESS).forEach(o => {
      const li = el("li", "tv-item");
      li.append(el("span", "tv-num", String(o.order_number)));
      const sub = el("span", "tv-sub");
      if (o.status === "Preparing") sub.append(el("i", "tv-dot"), "Making it now"); else sub.textContent = "In the queue";
      li.append(sub); pl.append(li);
    });
    if (prog.length > MAX_PROGRESS) pl.append(el("li", "tv-more", `+${prog.length - MAX_PROGRESS} more`));
    if (!prog.length) pl.append(el("li", "tv-empty", "No orders in progress."));
    $("tvProgCount").textContent = prog.length ? String(prog.length) : "";

    const rl = $("tvReady"); rl.replaceChildren();
    ready.slice(0, MAX_READY).forEach(o => {
      const li = el("li", `tv-item${fresh.has(o.order_number) ? " fresh" : ""}`);
      li.append(el("span", "tv-num", String(o.order_number)), el("span", "tv-sub", o.shelf_slot ? `Shelf ${o.shelf_slot}` : "At the counter"));
      rl.append(li);
    });
    if (ready.length > MAX_READY) rl.append(el("li", "tv-more", `+${ready.length - MAX_READY} more`));
    if (!ready.length) rl.append(el("li", "tv-empty", "Ready orders appear here with their shelf number."));
    $("tvReadyCount").textContent = ready.length ? String(ready.length) : "";

    const wait = Math.ceil(Number(b.avg_prep_minutes || 10) + 2 * prog.length);
    $("tvWait").textContent = `About ${wait} min`;
  }

  async function tick() {
    try { render(await api.publicBoard()); $("tvOffline").hidden = true; }
    catch { $("tvOffline").hidden = false; }
  }

  function clock() { $("tvClock").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }

  // QR to the menu (same folder as this page); ?url= can point it to the public address instead.
  const target = new URLSearchParams(location.search).get("url") || new URL("index.html", location.href).href;
  if (window.CafeQR) $("tvQr").innerHTML = window.CafeQR.svg(target, { label: "QR code: open the Corner Café menu", dark: "#16241E" });

  $("tvDemo").hidden = mode !== "demo";
  $("tvSound").addEventListener("click", () => {
    sound = !sound; $("tvSound").setAttribute("aria-pressed", String(sound)); $("tvSound").textContent = sound ? "Sound on" : "Sound off";
    if (sound) chime();
  });
  $("tvFull").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => { $("tvFull").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });

  // hide the buttons and the cursor when nobody touches the mouse
  let idleTimer = null;
  const wake = () => { document.body.classList.remove("idle"); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add("idle"), 4000); };
  ["mousemove", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, wake, { passive: true }));
  wake();

  // keep the screen awake where the browser allows it
  async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch {} }
  keepAwake(); document.addEventListener("visibilitychange", () => { if (!document.hidden) keepAwake(); });

  window.addEventListener("storage", e => { if (mode === "demo" && e.key === "cafe.demo.v2") tick(); });
  clock(); setInterval(clock, 1000);
  tick(); setInterval(tick, CFG.poll.board);
})();
