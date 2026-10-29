// Browser-side view splits: the pane tree of output elements and secondary viewers.

const leafSlots = new Map();

const secondaryViewers = new Map();

let paneTreeMobileMode = null;

let renderedTreeSignature = "";

function currentActor() {
  return {
    targetId: state.selectedTargetId || null,
    socket: state.selectedSocket || "",
    windowId: hasSelectedWindow() ? Number(state.selectedWindowId) : null
  };
}

function ensurePaneTree() {
  if (!state.paneRoot || !PANE_TREE.hasPaneId(state.paneRoot, state.activePaneId)) {
    if (!state.paneRoot) {
      state.paneRoot = PANE_TREE.leaf(currentActor());
    }
    state.activePaneId = PANE_TREE.firstPaneId(state.paneRoot);
  }
}

function activeLeaf() {
  ensurePaneTree();
  return PANE_TREE.findPane(state.paneRoot, state.activePaneId);
}

// The active leaf always mirrors the current selection.
function syncActivePaneActor() {
  ensurePaneTree();
  state.paneRoot = PANE_TREE.replacePaneActor(state.paneRoot, state.activePaneId, currentActor());
  savePaneLayout();
  updateSlotHead(state.activePaneId);
}

function getLeafSlot(leafNode) {
  let slot = leafSlots.get(leafNode.id);
  if (slot) {
    return slot;
  }
  slot = document.createElement("div");
  slot.className = "pane-slot";
  slot.dataset.paneId = leafNode.id;
  slot.innerHTML = `
    <div class="pane-slot-head">
      <span class="pane-slot-title"></span>
      <span class="pane-slot-actions">
        <button class="pane-slot-button" type="button" data-pane-action="split-right" title="Split right" aria-label="Split right">◫</button>
        <button class="pane-slot-button" type="button" data-pane-action="split-down" title="Split down" aria-label="Split down">⊟</button>
        <button class="pane-slot-button" type="button" data-pane-action="close" title="Close view" aria-label="Close view">×</button>
      </span>
    </div>
    <div class="pane-slot-body"></div>
  `;
  const output = originalScreenOutput.__adopted ? createOutputElement() : originalScreenOutput;
  originalScreenOutput.__adopted = true;
  slot.querySelector(".pane-slot-body").replaceChildren(output);
  bindOutputElement(output);
  leafSlots.set(leafNode.id, slot);
  return slot;
}

function applySplitRatio(element, ratio) {
  element.style.setProperty("--first", `${ratio}fr`);
  element.style.setProperty("--second", `${1 - ratio}fr`);
}

function buildPaneNode(node) {
  if (node.kind === "leaf") {
    return getLeafSlot(node);
  }
  const split = document.createElement("div");
  split.className = `pane-split ${node.direction}`;
  split.dataset.splitId = node.id;
  applySplitRatio(split, node.ratio);
  const divider = document.createElement("div");
  divider.className = "pane-divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", node.direction === "horizontal" ? "vertical" : "horizontal");
  split.append(buildPaneNode(node.first), divider, buildPaneNode(node.second));
  return split;
}

// Listeners live on each output element; they only act while that element is
// the active view (a click on another view activates it through the tree).
function bindOutputElement(output) {
  if (output.__bound) {
    return;
  }
  output.__bound = true;
  const whenActive = (handler) => (event) => (output === activeOutput ? handler(event) : undefined);
  output.addEventListener("click", whenActive(handleScreenPaneClick));
  // Passive as well: Screen mode forwards wheel steps at the edges without
  // needing preventDefault (overscroll-behavior already stops chaining).
  output.addEventListener("wheel", whenActive(queueRemoteScrollFromWheel), { passive: true });
  output.addEventListener("touchstart", whenActive(handleScreenTouchStart), { passive: true });
  // Passive on purpose: a blocking touchmove listener makes iOS scroll the
  // whole transcript on the main thread. Screen mode disables native vertical
  // panning with CSS touch-action instead and moves the pane itself.
  output.addEventListener("touchmove", whenActive(handleScreenTouchMove), { passive: true });
  output.addEventListener("touchend", whenActive(handleScreenTouchEnd), { passive: true });
  output.addEventListener("touchcancel", whenActive(handleScreenTouchEnd), { passive: true });
  output.addEventListener("scroll", whenActive(handleScreenOutputScroll), { passive: true });
  output.addEventListener("click", whenActive(handleScreenLinkClick));
  attachWheelContainmentTo(output);
}

async function handleScreenPaneClick(event) {
  const paneNode = event.target.closest?.(".tmux-pane");
  if (!paneNode || window.getSelection()?.toString()) {
    return;
  }
  const paneId = Number(paneNode.dataset.layoutPaneId);
  if (paneId !== Number(state.selectedWindowId)) {
    await selectWindow(paneId);
  }
}

async function handleScreenLinkClick(event) {
  const link = event.target.closest?.("[data-preview-url]");
  if (!link) {
    return;
  }
  event.preventDefault();
  try {
    await loadUrlPreview(link.dataset.previewUrl, { history: "reset" });
  } catch (error) {
    setPreviewStatus(error.message, "danger");
  }
}

function createOutputElement() {
  const output = document.createElement("pre");
  output.className = "screen-output scroll-panel";
  output.textContent = "Loading view...";
  return output;
}

function slotOutput(paneId) {
  return leafSlots.get(paneId)?.querySelector(".screen-output") || null;
}

function treeSignature(node) {
  return node.kind === "leaf" ? node.id : `(${node.direction}:${treeSignature(node.first)},${treeSignature(node.second)})`;
}

// Hand the selection to another slot's element. The element being left keeps
// everything it shows and is picked up by a secondary viewer seeded with that
// screen; the element being entered already shows its last screen, which
// becomes the rendered screen so the next refresh only revalidates.
function setActiveOutput(paneId) {
  const output = slotOutput(paneId);
  if (!output || output === activeOutput) {
    return;
  }
  const previous = activeOutput;
  if (renderedScreen.key && renderedScreen.text === state.screenText && previous.getAttribute("aria-busy") !== "true") {
    const [targetId, socket, windowId, extent] = renderedScreen.key.split("|");
    secondaryScreenCache.set(paneLiveKey(targetId, socket, Number(windowId)), {
      hash: renderedScreen.hash,
      data: renderedScreen.data,
      text: renderedScreen.text,
      extent,
      followTail: state.allTextFollowTail,
      element: previous
    });
  }
  stashRenderedScreen();
  const viewer = secondaryViewers.get(paneId);
  activeOutput = output;
  if (outputResizeObserver) {
    outputResizeObserver.disconnect();
    outputResizeObserver.observe(output);
  }
  if (viewer) {
    viewer.destroy();
    secondaryViewers.delete(paneId);
  }
  if (viewer && viewer.hash && viewer.data && viewer.extent === state.screenExtent) {
    renderedScreen = {
      key: screenKeyFor(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId, viewer.extent),
      hash: viewer.hash,
      text: viewer.text,
      data: viewer.data
    };
    state.screenText = viewer.text;
    if (viewer.extent === "all") {
      state.allTextFollowTail = viewer.followTail;
    }
  } else {
    renderedScreen = { key: "", hash: "", text: null, data: null };
    state.screenText = "";
  }
}

function destroySecondaryViewer(paneId) {
  const viewer = secondaryViewers.get(paneId);
  if (viewer) {
    viewer.destroy();
    secondaryViewers.delete(paneId);
  }
}

function sameActor(a, b) {
  return a.targetId === b.targetId && (a.socket || "") === (b.socket || "") && a.windowId === b.windowId;
}

function renderPaneTree() {
  ensurePaneTree();
  const container = elements.paneTree;
  const leavesNow = PANE_TREE.leaves(state.paneRoot);
  const liveIds = new Set(leavesNow.map((item) => item.id));
  leafSlots.forEach((slot, id) => {
    if (!liveIds.has(id)) {
      destroySecondaryViewer(id);
      leafSlots.delete(id);
      slot.remove();
    }
  });

  const mobile = isMobileViewport();
  const signature = mobile ? `mobile:${state.activePaneId}` : treeSignature(state.paneRoot);
  container.classList.toggle("single", leavesNow.length === 1);
  container.classList.toggle("mobile", mobile);
  if (signature !== renderedTreeSignature) {
    // Only splits, closes and the mobile/desktop switch rebuild the containers;
    // slots keep their elements, and scroll positions survive the re-insert.
    const scrolls = new Map();
    leafSlots.forEach((slot, id) => {
      const output = slot.querySelector(".screen-output");
      scrolls.set(id, [output.scrollTop, output.scrollLeft]);
    });
    container.replaceChildren(mobile ? getLeafSlot(activeLeaf()) : buildPaneNode(state.paneRoot));
    leafSlots.forEach((slot, id) => {
      const output = slot.querySelector(".screen-output");
      const saved = scrolls.get(id);
      if (saved && slot.isConnected) {
        output.scrollTop = saved[0];
        output.scrollLeft = saved[1];
      }
    });
    renderedTreeSignature = signature;
  }
  paneTreeMobileMode = mobile;
  setActiveOutput(state.activePaneId);

  leavesNow.forEach((leafNode) => {
    const slot = leafSlots.get(leafNode.id);
    if (!slot) {
      return;
    }
    slot.classList.toggle("active", leafNode.id === state.activePaneId);
    slot.querySelector(".screen-output").classList.toggle("secondary-output", leafNode.id !== state.activePaneId);
    if (leafNode.id === state.activePaneId) {
      return;
    }
    if (!slot.isConnected) {
      destroySecondaryViewer(leafNode.id);
      return;
    }
    const existing = secondaryViewers.get(leafNode.id);
    if (existing && sameActor(existing.actor, leafNode.actor)) {
      return;
    }
    destroySecondaryViewer(leafNode.id);
    secondaryViewers.set(leafNode.id, new SecondaryViewer(leafNode.id, leafNode.actor, slot.querySelector(".screen-output")));
  });
  leavesNow.forEach((leafNode) => updateSlotHead(leafNode.id));
  syncLiveSubscriptions();
}

function updateSlotHead(paneId) {
  const slot = leafSlots.get(paneId);
  const node = state.paneRoot ? PANE_TREE.findPane(state.paneRoot, paneId) : null;
  if (!slot || !node) {
    return;
  }
  const target = state.targets.find((item) => item.id === node.actor.targetId);
  const treePane = node.actor.targetId === state.selectedTargetId ? state.flatWindows.find((item) => Number(item.id) === node.actor.windowId) : null;
  const paneTitle = paneId === state.activePaneId ? selectedPane()?.title || "" : secondaryViewers.get(paneId)?.title || treePane?.title || "";
  slot.querySelector(".pane-slot-title").textContent = [
    target?.name || node.actor.targetId || "No target",
    node.actor.windowId !== null ? `#${node.actor.windowId}` : "no pane",
    paneTitle
  ]
    .filter(Boolean)
    .join(" · ");
}

// Last screen drawn for each pane by any view, so a view that is re-bound or
// re-created starts with content instead of a placeholder.
const secondaryScreenCache = new Map();

class SecondaryViewer {
  constructor(paneId, actor, output) {
    this.paneId = paneId;
    this.actor = actor;
    this.output = output;
    this.extent = state.screenExtent;
    this.hash = "";
    this.text = "";
    this.data = null;
    this.title = "";
    this.followTail = true;
    this.failures = 0;
    this.timer = null;
    this.destroyed = false;
    this.inFlight = false;
    this.pending = false;
    const cached = secondaryScreenCache.get(paneLiveKey(actor.targetId, actor.socket, actor.windowId));
    if (cached && cached.extent === this.extent) {
      this.hash = cached.hash;
      this.text = cached.text;
      this.data = cached.data;
      this.followTail = cached.followTail !== false;
      if (cached.element !== output) {
        this.draw(cached.data);
      }
    } else if (!output.__renderedLines && !output.querySelector(".tmux-window")) {
      this.output.textContent = "Loading view...";
    }
    this.poll();
  }

  get live() {
    return liveWindows.has(paneLiveKey(this.actor.targetId, this.actor.socket, this.actor.windowId));
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), this.live ? Math.max(delay, LIVE_POLL_MS) : delay);
  }

  // A live event arrived for this view: refresh now, or once more after the
  // refresh already running.
  trigger() {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.poll();
  }

  async poll() {
    if (this.destroyed) {
      return;
    }
    if (document.hidden || !this.output.isConnected) {
      this.schedule(SECONDARY_VIEW_POLL_MS);
      return;
    }
    if (!this.actor.targetId || this.actor.windowId === null) {
      this.output.textContent = "No pane bound. Click this view, then pick a pane in the sidebar.";
      return;
    }
    if (this.extent !== state.screenExtent) {
      this.extent = state.screenExtent;
      this.hash = "";
    }
    this.inFlight = true;
    try {
      const query = new URLSearchParams({
        targetId: this.actor.targetId,
        windowId: String(this.actor.windowId),
        extent: this.extent
      });
      if (this.actor.socket) {
        query.set("socket", this.actor.socket);
      }
      if (this.hash) {
        query.set("since", this.hash);
        if (typeof this.text === "string" && !this.data?.panes) {
          query.set("delta", "1");
        }
      }
      const data = await apiFetch(`/api/screen?${query.toString()}`);
      if (this.destroyed) {
        return;
      }
      if (data.delta) {
        if (data.base === this.hash && typeof this.text === "string") {
          data.text = TERMINAL_LINES.applyLineDelta(TERMINAL_LINES.splitLines(this.text), data).join("\n");
        } else {
          this.hash = "";
          this.schedule(0);
          this.inFlight = false;
          return;
        }
      }
      if (!data.unchanged) {
        this.hash = data.hash || "";
        this.data = data;
        this.draw(data);
        secondaryScreenCache.set(paneLiveKey(this.actor.targetId, this.actor.socket, this.actor.windowId), {
          hash: this.hash,
          data,
          text: this.text,
          extent: this.extent,
          followTail: this.followTail,
          element: this.output
        });
      }
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      this.hash = "";
      this.output.classList.remove("window-layout");
      delete this.output.dataset.layoutKey;
      this.output.textContent = `View unavailable: ${error.message}`;
    }
    this.inFlight = false;
    if (this.pending && !this.destroyed) {
      this.pending = false;
      this.poll();
      return;
    }
    this.schedule(Math.min(SECONDARY_VIEW_POLL_MS * (1 + this.failures), 15000));
  }

  draw(data) {
    if (Array.isArray(data.panes) && data.window) {
      const top = this.output.scrollTop;
      const left = this.output.scrollLeft;
      this.text = drawWindowLayout(this.output, data, this.actor.windowId, paneTextsFor(this.output));
      this.output.scrollTop = top;
      this.output.scrollLeft = left;
      const selected = data.panes.find((pane) => Number(pane.id) === this.actor.windowId);
      this.title = selected?.title || "";
    } else {
      const output = this.output;
      const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 48;
      const firstDraw = !output.__renderedLines;
      output.classList.remove("window-layout");
      delete output.dataset.layoutKey;
      this.text = data.text || "";
      renderTerminalLines(output, this.text, "(current screen is empty)");
      if (this.extent === "all" && (firstDraw || nearBottom || this.followTail)) {
        output.scrollTop = output.scrollHeight;
        this.followTail = true;
      } else if (this.extent === "all") {
        this.followTail = false;
      }
    }
    updateSlotHead(this.paneId);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}

// Point the single-selection state at a view's pane, switching target when needed.
async function bindSelectionToActor(actor) {
  if (!actor.targetId || !state.targets.some((item) => item.id === actor.targetId)) {
    setStatus("This view has no target; pick a pane in the sidebar to bind it.", "warning");
    return;
  }
  const sameSelection =
    actor.targetId === state.selectedTargetId &&
    hasSelectedWindow() &&
    Number(state.selectedWindowId) === actor.windowId &&
    (state.selectedSocket || "") === (actor.socket || "");
  if (actor.targetId !== state.selectedTargetId) {
    state.selectedTargetId = actor.targetId;
    state.editingTargetId = actor.targetId;
    clearSessionSelection();
    const target = getSelectedTarget();
    writeTargetForm(target);
    renderSavedTargets();
    renderTargetSelect();
    setTargetHealth("Switching", "neutral");
    await apiFetch("/api/targets/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: actor.targetId })
    });
  }
  if (!sameSelection) {
    stashRenderedScreen();
    state.selectedSocket = actor.socket || "";
    state.selectedWindowId = actor.windowId;
    invalidateScreenRequests();
  }
  if (actor.windowId !== null) {
    const key = screenKeyFor(state.selectedTargetId, state.selectedSocket, actor.windowId, activeExtent());
    if (renderedScreen.key !== key && !restoreCachedScreen(actor.windowId)) {
      renderPaneLoading(actor.windowId);
    }
  }
  if (sameSelection) {
    await refreshScreen({ force: true });
    return;
  }
  await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "screen" });
}

async function activatePane(paneId, override = {}) {
  const leafNode = PANE_TREE.findPane(state.paneRoot, paneId);
  if (!leafNode) {
    return;
  }
  if (paneId === state.activePaneId) {
    if (override.windowId !== undefined && override.windowId !== Number(state.selectedWindowId)) {
      await selectWindow(override.windowId);
    }
    return;
  }
  const actor = PANE_TREE.normalizeActor({ ...leafNode.actor, ...override });
  state.paneRoot = PANE_TREE.replacePaneActor(state.paneRoot, paneId, actor);
  state.activePaneId = paneId;
  savePaneLayout();
  renderPaneTree();
  await bindSelectionToActor(actor);
}

async function splitActivePane(direction) {
  const current = activeLeaf();
  const { tree, newPaneId } = PANE_TREE.splitPane(state.paneRoot, current.id, direction, current.actor);
  if (!newPaneId) {
    setStatus("No room for another view.", "warning");
    return;
  }
  state.paneRoot = tree;
  savePaneLayout();
  // The new view starts on the same pane and takes focus, so the next sidebar pick lands in it.
  await activatePane(newPaneId);
  setStatus("View split. Pick a pane in the sidebar to show it here.", "neutral");
}

async function closeViewPane(paneId) {
  if (PANE_TREE.leaves(state.paneRoot).length <= 1) {
    setStatus("The last view stays open.", "neutral");
    return;
  }
  const wasActive = paneId === state.activePaneId;
  state.paneRoot = PANE_TREE.closePane(state.paneRoot, paneId);
  if (wasActive) {
    state.activePaneId = PANE_TREE.firstPaneId(state.paneRoot);
  }
  savePaneLayout();
  renderPaneTree();
  if (wasActive) {
    await bindSelectionToActor(activeLeaf().actor);
  }
}

function handlePaneTreeClick(event) {
  const action = event.target.closest?.("[data-pane-action]");
  const slot = event.target.closest?.(".pane-slot");
  if (!slot) {
    return;
  }
  const paneId = slot.dataset.paneId;
  if (action) {
    event.preventDefault();
    const kind = action.dataset.paneAction;
    const run =
      kind === "close"
        ? closeViewPane(paneId)
        : activatePane(paneId).then(() => splitActivePane(kind === "split-down" ? "vertical" : "horizontal"));
    run.catch((error) => setStatus(error.message, "danger"));
    return;
  }
  if (paneId === state.activePaneId || window.getSelection()?.toString()) {
    return;
  }
  const layoutPane = event.target.closest?.(".tmux-pane");
  const override = layoutPane ? { windowId: Number(layoutPane.dataset.layoutPaneId) } : {};
  activatePane(paneId, override).catch((error) => setStatus(error.message, "danger"));
}

function handleDividerPointerDown(event) {
  const divider = event.target.closest?.(".pane-divider");
  if (!divider || event.button > 0) {
    return;
  }
  const split = divider.parentElement;
  const horizontal = split.classList.contains("horizontal");
  event.preventDefault();
  divider.setPointerCapture(event.pointerId);
  divider.classList.add("dragging");
  let ratio = null;
  const move = (moveEvent) => {
    const rect = split.getBoundingClientRect();
    const raw = horizontal ? (moveEvent.clientX - rect.left) / rect.width : (moveEvent.clientY - rect.top) / rect.height;
    ratio = clamp(raw, 0.2, 0.8);
    applySplitRatio(split, ratio);
  };
  const finish = (endEvent) => {
    divider.classList.remove("dragging");
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", finish);
    divider.removeEventListener("pointercancel", finish);
    try {
      divider.releasePointerCapture(endEvent.pointerId);
    } catch (error) {
      // Capture may already be gone.
    }
    if (ratio !== null) {
      state.paneRoot = PANE_TREE.resizePaneSplit(state.paneRoot, split.dataset.splitId, ratio);
      savePaneLayout();
    }
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
}

function bindViewsEvents() {
  bindOutputElement(originalScreenOutput);

  // Toolbar splits act on the highlighted view; each view's header has its own.
  elements.splitRightBtn.addEventListener("click", () => {
    splitActivePane("horizontal").catch((error) => setStatus(error.message, "danger"));
  });

  elements.splitDownBtn.addEventListener("click", () => {
    splitActivePane("vertical").catch((error) => setStatus(error.message, "danger"));
  });

  elements.paneTree.addEventListener("click", handlePaneTreeClick);

  elements.paneTree.addEventListener("pointerdown", handleDividerPointerDown);
}
