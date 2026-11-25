// Named layouts shared through the server, plus this device's Scratch layout.

function loadPaneLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANE_LAYOUT_STORAGE_KEY) || "null");
    if (parsed) {
      const decoded = PANE_TREE.decodePersistedPaneLayout(parsed);
      state.paneRoot = decoded.paneRoot;
      state.activePaneId = decoded.activePaneId;
      if (typeof parsed.activeLayoutId === "string" && decoded.paneRoot) {
        state.activeLayoutId = parsed.activeLayoutId;
        state.scratchLayout = decodeLayoutPayload(parsed.scratchLayout);
      }
    }
  } catch (error) {
    state.paneRoot = null;
    state.activePaneId = null;
  }
}

function savePaneLayout() {
  try {
    localStorage.setItem(
      PANE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        paneVersion: 1,
        paneRoot: state.paneRoot,
        activePaneId: state.activePaneId,
        activeLayoutId: state.activeLayoutId || undefined,
        scratchLayout: (state.activeLayoutId && state.scratchLayout) || undefined
      })
    );
  } catch (error) {
    // Storage can be unavailable; the layout then lasts for this page only.
  }
  scheduleLayoutAutosave();
  // Keeps the Scratch row's description current.
  renderLayouts();
}

// Layouts: a pane tree plus the pinned Browser, saved on the server
// (data/layouts.json) so the same layouts can be loaded from the desk, the
// iPad and the phone. A named layout is a live document: every change made
// while it is active is written back. "Scratch" is the unnamed layout of this
// device only; it is what you work in until you save it under a name.
const SCRATCH_LAYOUT_ID = "__scratch__";

const LAYOUT_AUTOSAVE_DELAY_MS = 600;

let layoutAutosaveTimer = 0;

let layoutAutosaveInFlight = false;

let layoutApplying = false;

const { normalizeBrowserState, decodeLayoutPayload } = LAYOUT_UTILS;

// The Browser belongs to a layout only while it is pinned. Phones never pin,
// so from a phone the layout keeps whatever Browser it already had.
function pinnedBrowserState() {
  if (isMobileViewport()) {
    const active = state.layouts.find((item) => item.id === state.activeLayoutId);
    return active ? normalizeBrowserState(active.browser) : null;
  }
  if (state.previewPinned && state.previewVisible && state.previewUrl) {
    return { url: state.previewUrl, targetId: state.previewTargetId || state.selectedTargetId || "" };
  }
  return null;
}

// The current layout without side effects (no selection sync), for comparisons.
function layoutSnapshot() {
  ensurePaneTree();
  return { paneRoot: state.paneRoot, activePaneId: state.activePaneId, browser: pinnedBrowserState() };
}

function currentLayoutPayload() {
  ensurePaneTree();
  syncActivePaneActor();
  return layoutSnapshot();
}

function scheduleLayoutAutosave() {
  if (!state.activeLayoutId || layoutApplying) {
    return;
  }
  clearTimeout(layoutAutosaveTimer);
  layoutAutosaveTimer = setTimeout(async () => {
    layoutAutosaveTimer = 0;
    // One save at a time: a second one sent with the same updatedAt would be
    // refused as a conflict with our own first save, and the conflict path
    // would then put that older copy back on screen.
    if (layoutAutosaveInFlight) {
      scheduleLayoutAutosave();
      return;
    }
    layoutAutosaveInFlight = true;
    try {
      await autosaveActiveLayout();
    } catch (error) {
      setStatus(`Layout not saved: ${error.message}`, "danger");
    } finally {
      layoutAutosaveInFlight = false;
    }
  }, LAYOUT_AUTOSAVE_DELAY_MS);
}

async function autosaveActiveLayout() {
  const layout = state.layouts.find((item) => item.id === state.activeLayoutId);
  if (!layout || layoutApplying) {
    return;
  }
  const payload = layoutSnapshot();
  const serialized = JSON.stringify(payload);
  if (serialized === state.activeLayoutSaved) {
    return;
  }
  let data;
  try {
    data = await apiFetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: { id: layout.id, name: layout.name, ...payload }, expectedUpdatedAt: layout.updatedAt || "" })
    });
  } catch (error) {
    if (error.status === 409 && error.payload?.layout) {
      // Another device wrote this layout first: its copy wins, as on start-up.
      const index = state.layouts.findIndex((item) => item.id === error.payload.layout.id);
      if (index >= 0) {
        state.layouts[index] = error.payload.layout;
      }
      await adoptActiveLayout();
      renderLayouts();
      setStatus(`Layout "${layout.name}" was changed on another device; showing that copy.`, "warning");
      return;
    }
    throw error;
  }
  state.activeLayoutSaved = serialized;
  const index = state.layouts.findIndex((item) => item.id === data.layout.id);
  if (index >= 0) {
    state.layouts[index] = data.layout;
  }
  renderLayouts();
}

// Puts a layout on screen: tree, bound selection, pinned Browser.
async function applyLayoutPayload(payload) {
  layoutApplying = true;
  try {
    state.paneRoot = payload.paneRoot;
    state.activePaneId = payload.activePaneId;
    savePaneLayout();
    renderPaneTree();
    await bindSelectionToActor(activeLeaf().actor);
    if (isMobileViewport()) {
      return;
    }
    if (payload.browser) {
      const hasTarget = state.targets.some((item) => item.id === payload.browser.targetId);
      state.previewPinned = true;
      await loadUrlPreview(payload.browser.url, { targetId: hasTarget ? payload.browser.targetId : undefined, history: "reset" });
    } else if (state.previewPinned) {
      state.previewPinned = false;
      state.previewVisible = false;
      applyUiState();
    }
  } finally {
    layoutApplying = false;
  }
}

// Takes the server's copy of the active layout without touching the
// connection: used at start-up and on Reload, so edits made on another device win.
async function adoptActiveLayout() {
  const layout = state.layouts.find((item) => item.id === state.activeLayoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    // Deleted elsewhere: the current tree carries on as Scratch.
    state.activeLayoutId = null;
    state.activeLayoutSaved = "";
    state.scratchLayout = null;
    savePaneLayout();
    return;
  }
  layoutApplying = true;
  try {
    // Which view has focus belongs to this device, not to the layout.
    const keepFocus = PANE_TREE.hasPaneId(payload.paneRoot, state.activePaneId);
    state.paneRoot = payload.paneRoot;
    state.activePaneId = keepFocus ? state.activePaneId : payload.activePaneId;
    savePaneLayout();
    renderPaneTree();
    // Input and the main screen follow the selection, so it must match the focused view.
    const actor = activeLeaf().actor;
    if (state.flatWindows.length && actor.targetId && !sameActor(actor, currentActor())) {
      await bindSelectionToActor(actor);
    }
    if (!isMobileViewport()) {
      if (payload.browser) {
        state.previewTargetId = payload.browser.targetId || state.previewTargetId;
        rememberPreviewUrl(payload.browser.url, "reset");
        state.previewPinned = true;
        state.previewVisible = true;
        await refreshPreviewAccessToken();
        syncPreviewFrame();
      } else if (state.previewPinned) {
        state.previewPinned = false;
        state.previewVisible = false;
      }
      applyUiState();
    }
  } finally {
    layoutApplying = false;
  }
  state.activeLayoutSaved = JSON.stringify(layoutSnapshot());
}

// One view on the focused pane of a layout.
function singleViewLayout(payload) {
  const focused = PANE_TREE.findPane(payload.paneRoot, payload.activePaneId) || PANE_TREE.leaves(payload.paneRoot)[0];
  const view = PANE_TREE.leaf(focused.actor);
  return { paneRoot: view, activePaneId: view.id, browser: null };
}

// Switches back to Scratch. Returns false when it was already active.
async function activateScratchLayout() {
  if (!state.activeLayoutId) {
    return false;
  }
  const stash = state.scratchLayout || singleViewLayout(layoutSnapshot());
  state.activeLayoutId = null;
  state.activeLayoutSaved = "";
  state.scratchLayout = null;
  await applyLayoutPayload(stash);
  renderLayouts();
  setStatus("Back to Scratch.", "neutral");
  return true;
}

async function loadLayouts(options = {}) {
  try {
    const data = await apiFetch("/api/layouts");
    state.layouts = Array.isArray(data.layouts) ? data.layouts : [];
  } catch (error) {
    state.layouts = [];
    elements.layoutSummary.textContent = `Layouts unavailable: ${error.message}`;
  }
  if (options.adoptActive && state.activeLayoutId) {
    await adoptActiveLayout();
  }
  renderLayouts();
}

function describeLayout(layout) {
  const leafNodes = PANE_TREE.leaves(layout.paneRoot);
  const parts = leafNodes.map((leafNode) => {
    const target = state.targets.find((item) => item.id === leafNode.actor.targetId);
    const name = target ? target.name : leafNode.actor.targetId || "unbound";
    return leafNode.actor.windowId === null ? name : `${name} #${leafNode.actor.windowId}`;
  });
  const browser = normalizeBrowserState(layout.browser);
  return `${leafNodes.length} view${leafNodes.length === 1 ? "" : "s"} · ${parts.join(", ")}${browser ? " · Browser" : ""}`;
}

function renderLayouts() {
  if (!elements.layoutList) {
    return;
  }
  const scratch = state.activeLayoutId ? state.scratchLayout : layoutSnapshot();
  const scratchRow = `
    <div class="layout-row reserved ${state.activeLayoutId ? "" : "active"}" data-layout-id="${SCRATCH_LAYOUT_ID}">
      <button class="layout-row-main" type="button" data-layout-action="load" title="The unsaved layout of this device. Work here, then save it under a name.">
        <strong>Scratch <span class="layout-badge">this device</span></strong>
        <small>${escapeHtml(scratch ? describeLayout(scratch) : "No views yet")}</small>
      </button>
    </div>
  `;
  const emptyNote = state.layouts.length
    ? ""
    : `<p class="empty-note">No saved layouts yet. Arrange your views, then save them with a name above.</p>`;
  elements.layoutList.innerHTML = scratchRow + emptyNote + state.layouts
    .map((layout) => {
      const active = layout.id === state.activeLayoutId ? "active" : "";
      return `
        <div class="layout-row ${active}" data-layout-id="${escapeHtml(layout.id)}">
          <button class="layout-row-main" type="button" data-layout-action="load" title="Switch to this layout">
            <strong>${escapeHtml(layout.name)}</strong>
            <small>${escapeHtml(describeLayout(layout))}</small>
          </button>
          <div class="layout-row-actions">
            <button class="icon-button" type="button" data-layout-action="duplicate" aria-label="Duplicate layout" title="Duplicate layout">⧉</button>
            <button class="icon-button" type="button" data-layout-action="delete" aria-label="Delete layout" title="Delete layout">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// Saves the current layout under a new name and switches to it. Saved from
// Scratch, a copy stays behind as Scratch.
async function saveLayoutAs(name) {
  const payload = currentLayoutPayload();
  const bound = PANE_TREE.leaves(payload.paneRoot).filter((leafNode) => leafNode.actor.windowId !== null);
  if (!bound.length) {
    setStatus("Pick a pane in at least one view before saving a layout.", "warning");
    return null;
  }
  if (state.layouts.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    setStatus(`A layout named “${name}” already exists.`, "warning");
    return null;
  }
  const data = await apiFetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { name, ...payload } })
  });
  if (!state.activeLayoutId) {
    // The views move to the new layout; Scratch starts over as one view.
    state.scratchLayout = singleViewLayout(payload);
  }
  state.activeLayoutId = data.layout.id;
  state.activeLayoutSaved = JSON.stringify(payload);
  savePaneLayout();
  await loadLayouts();
  setStatus(`Saved layout “${data.layout.name}”.`, "success");
  return data.layout;
}

async function applyLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    return;
  }
  if (!state.activeLayoutId) {
    state.scratchLayout = layoutSnapshot();
  }
  state.activeLayoutId = layout.id;
  state.activeLayoutSaved = JSON.stringify(payload);
  await applyLayoutPayload(payload);
  state.activeLayoutSaved = JSON.stringify(layoutSnapshot());
  renderLayouts();
  if (isMobileViewport()) {
    setMobileScreen("chat");
  }
  setStatus(`Switched to layout “${layout.name}”.`, "success");
}

async function duplicateLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  const payload = layout ? decodeLayoutPayload(layout) : null;
  if (!payload) {
    return;
  }
  const data = await apiFetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { name: `${layout.name} copy`, ...payload } })
  });
  await loadLayouts();
  setStatus(`Duplicated as “${data.layout.name}”.`, "success");
}

async function deleteLayout(layoutId) {
  const layout = state.layouts.find((item) => item.id === layoutId);
  if (!layout || !window.confirm(`Delete layout “${layout.name}”?`)) {
    return;
  }
  await apiFetch("/api/layouts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: layoutId })
  });
  if (state.activeLayoutId === layoutId) {
    // The current tree carries on as Scratch.
    state.activeLayoutId = null;
    state.activeLayoutSaved = "";
    state.scratchLayout = null;
    savePaneLayout();
  }
  await loadLayouts();
  setStatus(`Deleted layout “${layout.name}”.`, "neutral");
}

// The "Save layout" button opens the Layouts view with the name field ready.
function openLayoutSaveForm() {
  if (isMobileViewport()) {
    setMobileScreen("layouts");
  } else {
    state.activeSidebarView = "layouts";
    state.sidebarVisible = true;
    applyUiState();
  }
  const active = state.layouts.find((item) => item.id === state.activeLayoutId);
  elements.layoutNameInput.value = active ? `${active.name} copy` : "";
  elements.layoutNameInput.focus();
  elements.layoutNameInput.select();
}

function bindLayoutsEvents() {
  elements.saveLayoutBtn.addEventListener("click", () => {
    openLayoutSaveForm();
  });

  elements.mobileLayoutsBtn.addEventListener("click", () => {
    setMobileScreen("layouts");
  });

  elements.mobileBackFromLayoutsBtn.addEventListener("click", () => {
    // Back to the explorer when a target is connected, otherwise to Connect.
    handleMobileBack(state.flatWindows.length ? "sessions" : "connect");
  });

  elements.reloadLayoutsBtn.addEventListener("click", async () => {
    await loadLayouts({ adoptActive: true });
    setStatus("Layouts reloaded.", "neutral");
  });

  elements.layoutSaveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.layoutNameInput.value.trim();
    if (!name) {
      elements.layoutNameInput.focus();
      return;
    }
    try {
      const layout = await saveLayoutAs(name);
      if (layout) {
        elements.layoutNameInput.value = "";
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.layoutList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-layout-action]");
    const row = event.target.closest("[data-layout-id]");
    if (!button || !row) {
      return;
    }
    const layoutId = row.dataset.layoutId;
    try {
      if (layoutId === SCRATCH_LAYOUT_ID) {
        if (button.dataset.layoutAction === "load") {
          await activateScratchLayout();
        }
      } else if (button.dataset.layoutAction === "load") {
        await applyLayout(layoutId);
      } else if (button.dataset.layoutAction === "duplicate") {
        await duplicateLayout(layoutId);
      } else if (button.dataset.layoutAction === "delete") {
        await deleteLayout(layoutId);
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });
}
