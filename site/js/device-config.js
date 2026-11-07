// Identity of the simulated shelf device. The real device key is NOT stored in the website:
// staff type it once on the simulator page and it stays only in that browser.
// A real device would keep the key in its firmware; the database stores only its SHA-256 hash.
// demoKey works only in demo mode (offline data in this browser), never with the live database.
window.SHELF_DEVICE = Object.freeze({ id: "shelf-01", demoKey: "demo-shelf-01", intervalMs: 2000 });
