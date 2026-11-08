/* Scan-to-order poster: builds the QR code for the link in the box and keeps the link for next time. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const KEY = "cafe.posterUrl";
  const fallback = new URL("index.html", location.href).href;
  let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
  const fromQuery = new URLSearchParams(location.search).get("url");
  const input = $("posterUrl");
  input.value = fromQuery || saved || fallback;

  function draw() {
    let url = input.value.trim() || fallback;
    try { url = new URL(url).href; input.setCustomValidity(""); }
    catch { input.setCustomValidity("Enter a full address that starts with https://"); input.reportValidity(); return; }
    $("posterQr").innerHTML = window.CafeQR.svg(url, { label: `QR code: ${url}`, dark: "#17221D" });
    $("posterUrlText").textContent = url.replace(/^https?:\/\//, "").replace(/\/index\.html$/, "/");
    try { if (url !== fallback) localStorage.setItem(KEY, url); else localStorage.removeItem(KEY); } catch {}
  }
  input.addEventListener("change", draw);
  input.addEventListener("keydown", e => { if (e.key === "Enter") draw(); });
  $("posterPrint").addEventListener("click", () => { draw(); window.print(); });

  // shrink the A4 preview on narrow screens (print is not affected)
  function fit() {
    const sheet = $("sheet"), w = document.documentElement.clientWidth - 16, full = sheet.offsetWidth;
    if (w < full) { const k = w / full; sheet.style.transform = `scale(${k})`; sheet.style.marginBottom = `${-(1 - k) * sheet.offsetHeight + 24}px`; sheet.style.marginLeft = "8px"; }
    else { sheet.style.transform = ""; sheet.style.marginBottom = ""; sheet.style.marginLeft = ""; }
  }
  window.addEventListener("resize", fit);
  window.addEventListener("beforeprint", () => { const s = $("sheet"); s.style.transform = ""; s.style.marginBottom = ""; s.style.marginLeft = ""; });
  window.addEventListener("afterprint", fit);
  draw(); fit();
})();
