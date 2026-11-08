(function (root) {
  "use strict";
  const statuses = ["Received", "Preparing", "Ready", "Collected"];
  function validateOrder(name, items) {
    if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 50) {
      throw new Error("Enter a first name between 1 and 50 characters.");
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 40) {
      throw new Error("Add at least one item to your order (up to 40 different items).");
    }
    const seen = new Set();
    for (const item of items) {
      if (!Number.isSafeInteger(item.item_id) || item.item_id < 1 || seen.has(item.item_id)) {
        throw new Error("The cart contains an invalid or repeated item.");
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        throw new Error("Choose between 1 and 20 of each item.");
      }
      seen.add(item.item_id);
    }
    return { name: name.trim(), items: items.map(({ item_id, quantity }) => ({ item_id, quantity })) };
  }
  function priceOrder(items, menu) {
    return items.map(item => {
      const product = menu.find(x => x.item_id === item.item_id);
      if (!product || !product.is_available) throw new Error("An item is no longer available. Refresh the menu and update your cart.");
      return { item_id: product.item_id, name: product.name, quantity: item.quantity, unit_price: Number(product.price) };
    });
  }
  function total(items) {
    return items.reduce((sum, item) => sum + Math.round(Number(item.unit_price) * 100) * item.quantity, 0) / 100;
  }
  function sameRequest(order, name, items) {
    const signature = a => a.map(x => [x.item_id, x.quantity]).sort((a, b) => a[0] - b[0]);
    return order.customer_first_name === name && JSON.stringify(signature(order.items)) === JSON.stringify(signature(items));
  }
  function nextStatus(status) {
    const index = statuses.indexOf(status);
    if (index < 0 || index === statuses.length - 1) throw new Error("This order cannot move to another status.");
    return statuses[index + 1];
  }
  function uuid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    if (!root.crypto?.getRandomValues) throw new Error("This browser cannot create a secure order token. Open the app on localhost or HTTPS.");
    const b = root.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const domain = { statuses, validateOrder, priceOrder, total, sameRequest, nextStatus, uuid };
  root.CafeDomain = domain;
  if (typeof module !== "undefined") module.exports = domain;
})(typeof window !== "undefined" ? window : globalThis);
