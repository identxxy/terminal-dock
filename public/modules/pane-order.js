// Pane card order: the user drags cards in the Sessions list; the order is a
// list of pane ids per target and socket, stored in this browser only.
(function attachPaneOrder(global) {
  // Known ids come first in the saved order; the rest keep the terminal's own
  // order after them.
  function orderPanes(windows, order) {
    const list = Array.isArray(windows) ? windows : [];
    if (!Array.isArray(order) || !order.length) {
      return list.slice();
    }
    const rank = new Map(order.map((id, index) => [Number(id), index]));
    return list
      .map((window, index) => ({
        window,
        index,
        rank: rank.has(Number(window.id)) ? rank.get(Number(window.id)) : order.length + index
      }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((item) => item.window);
  }

  function sanitizeOrders(parsed) {
    const orders = {};
    if (!parsed || typeof parsed !== "object") {
      return orders;
    }
    for (const [key, ids] of Object.entries(parsed)) {
      if (Array.isArray(ids)) {
        const clean = ids.map(Number).filter((id) => Number.isFinite(id));
        if (clean.length) {
          orders[key] = clean;
        }
      }
    }
    return orders;
  }

  const api = { orderPanes, sanitizeOrders };

  global.KRDPaneOrder = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
