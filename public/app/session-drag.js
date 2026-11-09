// Drag pane cards in the Sessions list to reorder them. The order is kept per
// target and socket in this browser; the terminal's own pane order is untouched.
// Mouse: drag a card a few pixels. Touch and pen: hold the card, then drag.

const PANE_DRAG_HOLD_MS = 380;

const PANE_DRAG_MOUSE_SLOP = 6;

const PANE_DRAG_TOUCH_SLOP = 10;

let paneDrag = null;

let paneDragRenderPending = false;

function paneOrderKey() {
  return `${state.selectedTargetId}|${state.selectedSocket || ""}`;
}

function loadPaneOrder() {
  try {
    state.paneOrder = PANE_ORDER_UTILS.sanitizeOrders(JSON.parse(localStorage.getItem(PANE_ORDER_STORAGE_KEY) || "{}"));
  } catch (error) {
    state.paneOrder = {};
  }
}

function savePaneOrder() {
  try {
    localStorage.setItem(PANE_ORDER_STORAGE_KEY, JSON.stringify(state.paneOrder));
  } catch (error) {
    // Storage can be unavailable (private mode); the order then lasts for this page only.
  }
}

function orderedPanes(windows) {
  return PANE_ORDER_UTILS.orderPanes(windows, state.paneOrder[paneOrderKey()]);
}

function isPaneDragActive() {
  return Boolean(paneDrag && paneDrag.active);
}

function handlePaneDragPointerDown(event) {
  const card = event.target.closest?.(".pane-item[data-window-id]");
  if (!card || event.target.closest?.("[data-close-kind]") || (event.pointerType === "mouse" && event.button !== 0)) {
    return;
  }
  cancelPaneDrag();
  paneDrag = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    card,
    grid: card.parentElement,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    timer: null
  };
  if (event.pointerType !== "mouse") {
    card.classList.add("drag-armed");
    paneDrag.timer = setTimeout(() => beginPaneDrag(event.clientX, event.clientY), PANE_DRAG_HOLD_MS);
  }
}

function beginPaneDrag() {
  if (!paneDrag || paneDrag.active) {
    return;
  }
  clearTimeout(paneDrag.timer);
  paneDrag.timer = null;
  paneDrag.active = true;
  // The tap-to-select gesture must not fire for this touch.
  sessionPointerStart = null;
  const { card, pointerId } = paneDrag;
  card.classList.remove("drag-armed");
  card.classList.add("dragging");
  elements.sessionTree.classList.add("dragging-panes");
  try {
    card.setPointerCapture(pointerId);
  } catch (error) {
    // Capture is a convenience: without it the tree still receives the moves while the pointer stays inside.
  }
}

function handlePaneDragPointerMove(event) {
  if (!paneDrag || event.pointerId !== paneDrag.pointerId) {
    return;
  }
  const moved = Math.hypot(event.clientX - paneDrag.startX, event.clientY - paneDrag.startY);
  if (!paneDrag.active) {
    if (paneDrag.pointerType === "mouse") {
      if (moved > PANE_DRAG_MOUSE_SLOP) {
        beginPaneDrag();
      }
    } else if (moved > PANE_DRAG_TOUCH_SLOP) {
      // The finger is scrolling the list, not holding a card.
      cancelPaneDrag();
    }
    return;
  }
  event.preventDefault();
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".pane-item[data-window-id]");
  if (!over || over === paneDrag.card || over.parentElement !== paneDrag.grid) {
    return;
  }
  const rect = over.getBoundingClientRect();
  const horizontal = rect.width < paneDrag.grid.getBoundingClientRect().width - 1;
  const after = horizontal ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
  paneDrag.grid.insertBefore(paneDrag.card, after ? over.nextElementSibling : over);
}

function handlePaneDragPointerUp(event) {
  if (!paneDrag || event.pointerId !== paneDrag.pointerId) {
    return;
  }
  if (!paneDrag.active) {
    cancelPaneDrag();
    return;
  }
  const ids = [...elements.sessionTree.querySelectorAll(".pane-item[data-window-id]")].map((node) => Number(node.dataset.windowId));
  state.paneOrder[paneOrderKey()] = ids;
  savePaneOrder();
  suppressSessionClickUntil = Date.now() + 650;
  cancelPaneDrag();
  renderSessions();
  setStatus("Pane order saved for this browser.", "neutral");
}

function cancelPaneDrag() {
  if (!paneDrag) {
    return;
  }
  clearTimeout(paneDrag.timer);
  paneDrag.card.classList.remove("drag-armed", "dragging");
  elements.sessionTree.classList.remove("dragging-panes");
  const wasActive = paneDrag.active;
  paneDrag = null;
  if (wasActive && paneDragRenderPending) {
    paneDragRenderPending = false;
    renderSessions();
  }
}

function bindSessionDragEvents() {
  const tree = elements.sessionTree;
  tree.addEventListener("pointerdown", handlePaneDragPointerDown);
  tree.addEventListener("pointermove", handlePaneDragPointerMove);
  tree.addEventListener("pointerup", handlePaneDragPointerUp);
  tree.addEventListener("pointercancel", cancelPaneDrag);
  // Blocking on purpose: once a card is held, the finger moves the card, not the list.
  tree.addEventListener(
    "touchmove",
    (event) => {
      if (isPaneDragActive()) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
  tree.addEventListener("contextmenu", (event) => {
    if (paneDrag) {
      event.preventDefault();
    }
  });
}
