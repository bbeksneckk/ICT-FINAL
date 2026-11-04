/* Category illustrations for menu cards: own work, drawn as inline SVG. */
(function () {
  "use strict";
  const ink = 'stroke="var(--art-ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  const svg = body => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
  const art = {
    1: svg(`<path d="M14 28h30v9a11 11 0 0 1-11 11h-8a11 11 0 0 1-11-11z" fill="#fff" ${ink}/><path d="M44 31h3a5 5 0 0 1 0 10h-4" fill="none" ${ink}/><path d="M18 31c4 3 18 3 22 0" fill="none" stroke="#8A5A33" stroke-width="3" stroke-linecap="round"/><path d="M9 52h40" ${ink}/><path d="M24 14c-2 3 2 5 0 8M32 12c-2 3 2 5 0 8" fill="none" ${ink}/>`),
    2: svg(`<path d="M20 12h24l-3 40H23z" fill="#fff" ${ink}/><path d="M21.5 30h21l-1.2 16H22.7z" fill="#B57A4A"/><path d="M21 22h22l-.6 8H21.6z" fill="#F4E6D3"/><path d="M28 39c1.5-2 4-2 4 0 0-2 2.5-2 4 0-1 2.5-4 4-4 4s-3-1.5-4-4z" fill="#fff"/><path d="M20 12h24l-3 40H23z" fill="none" ${ink}/>`),
    3: svg(`<path d="M12 30h32v6a12 12 0 0 1-12 12h-8a12 12 0 0 1-12-12z" fill="#fff" ${ink}/><path d="M44 33h3a5 5 0 0 1 0 10h-4" fill="none" ${ink}/><path d="M16 33c4 2 20 2 24 0" fill="none" stroke="#C99A3B" stroke-width="3" stroke-linecap="round"/><path d="M33 30V16" ${ink}/><rect x="29" y="10" width="9" height="8" rx="1.5" fill="#7FA36B" ${ink}/><path d="M8 52h40" ${ink}/>`),
    4: svg(`<path d="M18 18h28l-4 36H22z" fill="#fff" ${ink}/><path d="M19.5 30h25l-2.7 24H22.2z" fill="#9C6B43"/><rect x="24" y="33" width="7" height="7" rx="1.5" fill="#E8F1F5" ${ink}/><rect x="33" y="38" width="7" height="7" rx="1.5" fill="#E8F1F5" ${ink}/><path d="M15 18h34" ${ink}/><path d="M36 18l5-11h6" fill="none" ${ink}/><path d="M18 18h28l-4 36H22z" fill="none" ${ink}/>`),
    5: svg(`<path d="M18 14h28l-3 40H21z" fill="#fff" ${ink}/><path d="M19.5 26h25l-2.2 28H21.7z" fill="#F6D86B"/><circle cx="42" cy="16" r="8" fill="#F3E57A" ${ink}/><path d="M42 8v16M34 16h16M36.5 10.5l11 11M47.5 10.5l-11 11" stroke="#C9B12E" stroke-width="1.6"/><path d="M27 34h0M33 42h0M28 47h0" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M18 14h28l-3 40H21z" fill="none" ${ink}/>`),
    6: svg(`<ellipse cx="32" cy="38" rx="24" ry="14" fill="#fff" ${ink}/><path d="M18 36c0-7 6-10 12-9s7-5 13-3 7 9 2 13-11 5-17 4-10-1-10-5z" fill="#fff" ${ink}/><circle cx="32" cy="34" r="6" fill="#F2B33D" ${ink}/>`),
    7: svg(`<path d="M10 44 32 14l22 30z" fill="#F2DDB0" ${ink}/><path d="M14 40h36" stroke="#6E9A55" stroke-width="5" stroke-linecap="round"/><path d="M13 43h38" stroke="#D9573B" stroke-width="3" stroke-linecap="round"/><path d="M10 44l2 6h40l2-6" fill="#F2DDB0" ${ink}/>`),
    8: svg(`<path d="M8 32h48a24 18 0 0 1-48 0z" fill="#fff" ${ink}/><path d="M12 32h40" stroke="#D2693A" stroke-width="5" stroke-linecap="round"/><path d="M22 52h20" ${ink}/><path d="M44 30 56 12" ${ink}/><path d="M24 22c-2-3 2-5 0-8M32 22c-2-3 2-5 0-8" fill="none" ${ink}/>`),
    9: svg(`<path d="M10 42c4-12 14-20 22-20s18 8 22 20c-6 4-12 0-14-4-2 5-6 7-8 7s-6-2-8-7c-2 4-8 8-14 4z" fill="#E7A94A" ${ink}/><path d="M24 30c2 4 3 8 2 12M40 30c-2 4-3 8-2 12M32 24v18" fill="none" stroke="#B5762A" stroke-width="2.2" stroke-linecap="round"/>`),
    10: svg(`<path d="M10 46V30l40-12v28z" fill="#F7EBD8" ${ink}/><path d="M10 38l40-10" stroke="#B5546C" stroke-width="4" stroke-linecap="round"/><path d="M10 30l40-12 4 3-40 12z" fill="#fff" ${ink}/><circle cx="40" cy="15" r="4.5" fill="#C7354F" ${ink}/><path d="M6 50h48" ${ink}/>`)
  };
  const tile = { 1: "#E4D6C3", 2: "#E8D0BD", 3: "#D8E6D2", 4: "#D3E1EB", 5: "#F2E2A9", 6: "#F1E2BE", 7: "#E5DCC4", 8: "#F0D3C1", 9: "#F1DCAE", 10: "#EBD3DA" };
  window.CafeArt = { svg: id => art[id] || art[1], tile: id => tile[id] || tile[1] };
})();
