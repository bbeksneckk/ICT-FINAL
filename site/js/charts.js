/* Small dependency-free SVG charts for the manager's Insights tab.
   Every chart has a title, axis titles with units, a hover tooltip per mark and a data table. */
(function () {
  "use strict";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function table(headers, rows) {
    return `<details class="chart-table"><summary>Show the numbers</summary><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></details>`;
  }
  function frame(title, svg, note, tbl) {
    return `<figure class="chart"><figcaption class="chart-title">${esc(title)}</figcaption>${svg}<p class="chart-note">${esc(note)}</p>${tbl}</figure>`;
  }

  // Vertical bars: compare a few categories (e.g. orders per hour).
  function bars({ title, data, xTitle, yTitle, note, valueLabel = v => fmt(v) }) {
    const W = 640, H = 300, L = 52, R = 12, T = 16, B = 52;
    const max = niceMax(Math.max(...data.map(d => d.value), 0));
    const iw = W - L - R, ih = H - T - B, step = iw / Math.max(data.length, 1), bw = Math.max(6, Math.min(36, step - 6));
    const y = v => T + ih - (v / max) * ih;
    const ticks = [0, .25, .5, .75, 1].map(t => t * max);
    const best = Math.max(...data.map(d => d.value));
    let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    s += ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    data.forEach((d, i) => {
      const x = L + i * step + (step - bw) / 2, h = Math.max(0, T + ih - y(d.value));
      s += `<g class="mark" data-tip="${esc(d.label)}: ${esc(valueLabel(d.value))}"><rect class="hit" x="${L + i * step}" y="${T}" width="${step}" height="${ih}"/>`;
      s += h ? `<path class="bar" d="M${x},${T + ih} V${y(d.value) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${T + ih} Z"/>` : "";
      if (d.value === best && best > 0) s += `<text class="direct" x="${x + bw / 2}" y="${y(d.value) - 6}" text-anchor="middle">${esc(valueLabel(d.value))}</text>`;
      s += `</g>`;
      if (data.length <= 16 || i % 2 === 0) s += `<text class="tick" x="${x + bw / 2}" y="${T + ih + 18}" text-anchor="middle">${esc(d.short || d.label)}</text>`;
    });
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>`;
    s += `<text class="axis-title" x="${L + iw / 2}" y="${H - 8}" text-anchor="middle">${esc(xTitle)}</text>`;
    s += `<text class="axis-title" transform="translate(14 ${T + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yTitle)}</text></svg>`;
    return frame(title, s, note, table([xTitle, yTitle], data.map(d => [d.label, valueLabel(d.value)])));
  }

  // Line: change over time (e.g. revenue per day).
  function line({ title, data, xTitle, yTitle, note, valueLabel = v => fmt(v) }) {
    const W = 640, H = 300, L = 84, R = 16, T = 16, B = 52;
    const max = niceMax(Math.max(...data.map(d => d.value), 0));
    const iw = W - L - R, ih = H - T - B;
    const x = i => L + (data.length < 2 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = v => T + ih - (v / max) * ih;
    const ticks = [0, .25, .5, .75, 1].map(t => t * max);
    let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    s += ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    s += `<path class="line" d="${data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ")}"/>`;
    const every = Math.ceil(data.length / 7);
    data.forEach((d, i) => {
      const hw = data.length < 2 ? iw : iw / (data.length - 1);
      s += `<g class="mark" data-tip="${esc(d.label)}: ${esc(valueLabel(d.value))}"><rect class="hit" x="${x(i) - hw / 2}" y="${T}" width="${hw}" height="${ih}"/><circle class="dot" cx="${x(i)}" cy="${y(d.value)}" r="4.5"/></g>`;
      if (i % every === 0 || i === data.length - 1) s += `<text class="tick" x="${x(i)}" y="${T + ih + 18}" text-anchor="middle">${esc(d.short || d.label)}</text>`;
    });
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>`;
    s += `<text class="axis-title" x="${L + iw / 2}" y="${H - 8}" text-anchor="middle">${esc(xTitle)}</text>`;
    s += `<text class="axis-title" transform="translate(14 ${T + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yTitle)}</text></svg>`;
    return frame(title, s, note, table([xTitle, yTitle], data.map(d => [d.label, valueLabel(d.value)])));
  }

  // Horizontal bars: ranked list (e.g. best sellers).
  function hbars({ title, data, xTitle, labelTitle, note, valueLabel = v => fmt(v) }) {
    const rowH = 30, W = 640, L = 190, R = 70, T = 8, B = 40, H = T + B + data.length * rowH;
    const max = niceMax(Math.max(...data.map(d => d.value), 0)); const iw = W - L - R;
    let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    data.forEach((d, i) => {
      const yy = T + i * rowH, w = (d.value / max) * iw;
      s += `<g class="mark" data-tip="${esc(d.label)}: ${esc(valueLabel(d.value))}"><rect class="hit" x="0" y="${yy}" width="${W}" height="${rowH}"/>`;
      s += `<text class="label" x="${L - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end">${esc(d.label)}</text>`;
      s += w > 0 ? `<path class="bar" d="M${L},${yy + 6} H${L + w - 4} q4,0 4,4 V${yy + rowH - 10} q0,4 -4,4 H${L} Z"/>` : "";
      s += `<text class="value" x="${L + w + 8}" y="${yy + rowH / 2 + 4}">${esc(valueLabel(d.value))}</text></g>`;
    });
    s += `<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${T + data.length * rowH}"/>`;
    s += `<text class="axis-title" x="${L + iw / 2}" y="${H - 10}" text-anchor="middle">${esc(xTitle)}</text></svg>`;
    return frame(title, s, note, table([labelTitle, xTitle], data.map(d => [d.label, valueLabel(d.value)])));
  }

  // One stacked bar: how the average order's time splits into stages.
  function stages({ title, parts, note }) {
    const W = 640, H = 120, L = 8, R = 8, T = 20, BH = 34; const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 1;
    const iw = W - L - R; let x = L;
    let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    parts.forEach((p, i) => {
      const w = Math.max(0, (p.value || 0) / total * iw - (i < parts.length - 1 ? 2 : 0));
      s += `<g class="mark" data-tip="${esc(p.label)}: ${fmt(p.value || 0)} min"><rect class="seg seg-${i + 1}" x="${x}" y="${T}" width="${w}" height="${BH}" rx="${i === 0 || i === parts.length - 1 ? 4 : 0}"/>`;
      if (w > 60) s += `<text class="seg-label" x="${x + 8}" y="${T + BH / 2 + 5}">${fmt(p.value || 0)} min</text>`;
      s += `</g>`; x += w + 2;
    });
    s += `<text class="axis-title" x="${L}" y="${H - 14}">Minutes from order to pickup, average per order</text></svg>`;
    const legend = `<ul class="legend">${parts.map((p, i) => `<li><span class="swatch seg-${i + 1}"></span>${esc(p.label)}</li>`).join("")}</ul>`;
    return frame(title, legend + s, note, table(["Stage", "Average minutes"], parts.map(p => [p.label, fmt(p.value || 0)])));
  }

  // One tooltip for every chart on the page.
  function attachTooltips(root) {
    let tip = document.getElementById("chartTip");
    if (!tip) { tip = document.createElement("div"); tip.id = "chartTip"; tip.className = "chart-tip"; tip.hidden = true; document.body.append(tip); }
    root.querySelectorAll(".mark").forEach(m => {
      const show = e => { tip.textContent = m.dataset.tip; tip.hidden = false; const r = (e.touches ? e.touches[0] : e);
        tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, r.clientX + 12) + "px"; tip.style.top = (r.clientY - 36) + "px"; m.classList.add("on"); };
      const hide = () => { tip.hidden = true; m.classList.remove("on"); };
      m.addEventListener("mousemove", show); m.addEventListener("mouseleave", hide);
      m.addEventListener("touchstart", show, { passive: true }); m.addEventListener("touchend", hide);
    });
  }

  window.CafeCharts = { bars, line, hbars, stages, attachTooltips };
})();
