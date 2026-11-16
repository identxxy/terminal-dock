// Session explorer: tree loading, pane cards, pane selection, screen refresh.

function flattenWindows(tree) {
  const flat = [];

  tree.forEach((osWindow) => {
    (osWindow.tabs || []).forEach((tab) => {
      (tab.windows || []).forEach((window) => {
        flat.push({
          ...window,
          osWindowId: osWindow.id,
          osWindowTitle: osWindow.title || "",
          tabId: tab.id,
          tabTitle: tab.title,
          tabLayout: tab.layout,
          osWindowFocused: osWindow.is_focused
        });
      });
    });
  });

  return flat;
}

function getWindowProcessLabel(windowInfo) {
  const rawLabel = (windowInfo.foreground_processes || [])
    .map((item) => (item.cmdline || []).join(" "))
    .filter(Boolean)[0] || (windowInfo.cmdline || []).join(" ");
  const firstCommand = rawLabel.split("|")[0].trim();
  const commandPath = firstCommand.split(/\s+/)[0] || "";
  const basename = commandPath.split(/[\\/]/).filter(Boolean).pop();

  return basename || "process";
}

function getFirstWindowInTab(tab) {
  return (tab?.windows || [])[0] || null;
}

function getFirstWindowInOsWindow(osWindow) {
  for (const tab of osWindow?.tabs || []) {
    const windowInfo = getFirstWindowInTab(tab);
    if (windowInfo) {
      return windowInfo;
    }
  }
  return null;
}

function getCreatePanelLabel(kind) {
  const labels = state.sessionLabels;
  const text = kind === "tab" ? labels.createTab : kind === "split" ? labels.createSplit : labels.createWindow;
  return text.replace(/^New\s+/i, "").toLowerCase();
}

function syncSessionCreateControls() {
  const buttons = Array.from(elements.sessionTree.querySelectorAll("[data-create-session]"));

  buttons.forEach((button) => {
    const lacksAnchor = button.dataset.createSession && !button.dataset.sourceWindowId;
    const kind = button.dataset.createSession || "";
    button.disabled = state.sessionCreating || lacksAnchor || !state.selectedTargetId;
    if (kind === "window") {
      button.disabled = state.sessionCreating || !state.selectedTargetId;
    }
  });
}

async function createKittyPanel(kind, context = {}) {
  if (!state.selectedTargetId) {
    setStatus("Choose a connection target first.", "warning");
    return;
  }

  if (state.sessionCreating) {
    setStatus("A create action is already running.", "neutral");
    return;
  }

  const payload = {
    targetId: state.selectedTargetId,
    socket: state.selectedSocket || "",
    kind
  };

  if (context.sourceWindowId) {
    payload.sourceWindowId = Number(context.sourceWindowId);
  }
  if (context.tabId) {
    payload.tabId = Number(context.tabId);
  }

  const label = getCreatePanelLabel(kind);
  state.sessionCreating = true;
  syncSessionCreateControls();
  setStatus(`Creating new ${label}...`, "neutral");

  try {
    const result = await apiFetch("/api/create-panel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (result.socket) {
      state.selectedSocket = result.socket;
    }

    await loadSessions({ forceRefresh: true, refreshPane: false });
    if (result.windowId !== undefined && result.windowId !== null) {
      await selectWindow(result.windowId);
    }
    setStatus(`Created new ${label} #${result.windowId ?? ""}.`, "success");
  } finally {
    state.sessionCreating = false;
    syncSessionCreateControls();
  }
}

async function selectWindow(windowId) {
  const nextWindowId = Number(windowId);
  const selectionChanged = Number(state.selectedWindowId) !== nextWindowId;
  if (selectionChanged) {
    stashRenderedScreen();
  }
  state.selectedWindowId = nextWindowId;
  if (selectionChanged) {
    viewportScrolledBack = false;
  }
  rememberSelectedPane();
  noteScreenActivity();
  if (isMobileViewport()) {
    state.previewVisible = false;
    state.previewPinned = false;
    setMobileScreen("chat");
  }
  invalidateScreenRequests();
  const layoutPane = elements.screenOutput.querySelector(`.tmux-pane[data-layout-pane-id="${nextWindowId}"]`);
  if (selectionChanged && layoutPane) {
    elements.screenOutput.querySelectorAll(".tmux-pane.selected").forEach((node) => node.classList.remove("selected"));
    layoutPane.classList.add("selected");
    state.screenText = paneTextsFor(elements.screenOutput).get(nextWindowId) || "";
  } else if (selectionChanged && !restoreCachedScreen(nextWindowId)) {
    renderPaneLoading(nextWindowId);
  }
  renderSessions();
  renderMobilePaneSwitcher();
  renderViewerMeta();
  applyUiState();
  renderHistoryRail();
  await refreshScreen({
    force: true,
    scrollToBottom: activeExtent() === "screen" || (activeExtent() === "all" && state.allTextFollowTail)
  });
  scheduleAutoFit();
}

// --- tmux pane sizing -------------------------------------------------------
// A tmux pane is as wide as its attached client, or 80x24 when it never had one,
// so lines stop short of the browser. Detached panes are resized to the cells
// that fit this view; attached ones only on request (see fitPaneToScreen).

function renderMobilePaneSwitcher() {
  if (!state.flatWindows.length) {
    elements.mobilePaneSwitcher.hidden = true;
    elements.mobilePaneSwitcher.innerHTML = "";
    return;
  }

  elements.mobilePaneSwitcher.hidden = false;
  elements.mobilePaneSwitcher.innerHTML = orderedPanes(state.flatWindows)
    .map((windowInfo) => {
      const selected = Number(windowInfo.id) === Number(state.selectedWindowId) ? "selected" : "";
      const title = [
        windowInfo.title || `Pane ${windowInfo.id}`,
        windowInfo.tabTitle ? `${state.sessionLabels.tab}: ${windowInfo.tabTitle}` : "",
        windowInfo.cwd || ""
      ].filter(Boolean).join(" · ");
      return `
        <button class="mobile-pane-tab ${selected}" type="button" data-mobile-window-id="${windowInfo.id}" title="${escapeAttribute(title)}">
          ID ${escapeHtml(String(windowInfo.id))}
        </button>
      `;
    })
    .join("");

  elements.mobilePaneSwitcher.querySelectorAll("[data-mobile-window-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectWindow(button.dataset.mobileWindowId);
    });
  });

  const selectedButton = elements.mobilePaneSwitcher.querySelector(".mobile-pane-tab.selected");
  if (selectedButton) {
    const targetLeft = selectedButton.offsetLeft - (elements.mobilePaneSwitcher.clientWidth - selectedButton.clientWidth) / 2;
    elements.mobilePaneSwitcher.scrollLeft = Math.max(0, targetLeft);
  }
}

function bindSessionCreateControls() {
  elements.sessionTree.querySelectorAll("[data-create-session]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await createKittyPanel(button.dataset.createSession, {
          sourceWindowId: button.dataset.sourceWindowId,
          tabId: button.dataset.tabId
        });
      } catch (error) {
        setTargetHealth("Create failed", "danger");
        setStatus(error.message, "danger");
      }
    });
  });

  syncSessionCreateControls();
}

function renderSessions() {
  if (isPaneDragActive()) {
    paneDragRenderPending = true;
    return;
  }
  const totalWindows = state.flatWindows.length;
  const selectedTarget = getSelectedTarget();
  const labels = state.sessionLabels;
  // tmux sessions are created and arranged from the terminal; the deck only adds sessions.
  const showNestedCreate = backendFeature("nestedCreate");
  const newWindowFooter = `
    <section class="os-window-create-block">
      <button
        class="ghost-button session-create-button create-window-card-button"
        id="createWindowBtn"
        type="button"
        data-create-session="window"
      >
        <span>${escapeHtml(labels.createWindow)}</span>
        <small>Create ${escapeHtml(labels.osWindow.toLowerCase())} #${state.sessionTree.length + 1}</small>
      </button>
    </section>
  `;

  elements.sessionSummary.textContent = selectedTarget
    ? `${selectedTarget.name} · ${state.sessionTree.length} ${labels.osWindow.toLowerCase()}s / ${totalWindows} panes`
    : "Choose a target from the top selector, then connect.";

  if (!state.sessionTree.length) {
    elements.sessionTree.innerHTML = `
      <div class="empty-note">No session data yet. Click Connect to load sessions.</div>
      ${newWindowFooter}
    `;
    renderMobilePaneSwitcher();
    bindSessionCreateControls();
    return;
  }

  // tmux panes are listed flat: the session and window levels carry no
  // information the pane card does not already show.
  const markup = backendFeature("flatPanes")
    ? `<section class="pane-grid pane-cards">${orderedPanes(state.flatWindows).map((window) => paneCardMarkup(window)).join("")}</section>`
    : state.sessionTree
    .map((osWindow) => {
      const osWindowAnchor = getFirstWindowInOsWindow(osWindow);
      const tabCreateDisabled = osWindowAnchor ? "" : "disabled";
      const tabs = (osWindow.tabs || [])
        .map((tab) => {
          const tabAnchor = getFirstWindowInTab(tab);
          const splitCreateDisabled = tabAnchor ? "" : "disabled";
          const windows = orderedPanes(tab.windows || []).map((window) => paneCardMarkup(window)).join("");

          return `
            <article class="tab-block">
              <div class="tab-head">
                <div>
                  <h4>${escapeHtml(tab.title || `${labels.tab} ${tab.id}`)}</h4>
                  <small>${escapeHtml(tab.layout || "")}</small>
                </div>
                <div class="session-head-actions">
                  <span>${escapeHtml(labels.tab.toLowerCase())} #${tab.id}</span>
                  ${closeButtonMarkup("tab", tab.id, tab.title || `${labels.tab} ${tab.id}`, (tab.windows || []).length)}
                  ${showNestedCreate ? `<button
                    class="ghost-button session-create-button"
                    type="button"
                    data-create-session="split"
                    data-tab-id="${escapeAttribute(tab.id)}"
                    data-source-window-id="${escapeAttribute(tabAnchor ? tabAnchor.id : "")}"
                    ${splitCreateDisabled}
                  >${escapeHtml(labels.createSplit)}</button>` : ""}
                </div>
              </div>
              <div class="pane-grid">${windows}</div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="os-window-block">
          <div class="os-window-head">
            <div>
              <h3>${escapeHtml(osWindow.title ? `${labels.osWindow} ${osWindow.title}` : `${labels.osWindow} #${osWindow.id}`)}</h3>
              <small>${osWindow.title
                ? (osWindow.is_focused ? "attached" : "detached")
                : (osWindow.is_focused ? "focused now" : "background window")}</small>
            </div>
            <div class="session-head-actions">
              <span>${(osWindow.tabs || []).length} ${escapeHtml(labels.tab.toLowerCase())}s</span>
              ${backendFeature("closeSession")
                ? closeButtonMarkup("session", osWindow.id, osWindow.title || `#${osWindow.id}`, countOsWindowPanes(osWindow))
                : ""}
              ${showNestedCreate ? `<button
                class="ghost-button session-create-button"
                type="button"
                data-create-session="tab"
                data-os-window-id="${escapeAttribute(osWindow.id)}"
                data-source-window-id="${escapeAttribute(osWindowAnchor ? osWindowAnchor.id : "")}"
                ${tabCreateDisabled}
              >${escapeHtml(labels.createTab)}</button>` : ""}
            </div>
          </div>
          ${tabs}
        </section>
      `;
    })
    .join("");

  elements.sessionTree.innerHTML = `${markup}${newWindowFooter}`;

  elements.sessionTree.querySelectorAll("[data-window-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      if (event.target.closest("[data-close-kind]") || Date.now() < suppressSessionClickUntil) {
        return;
      }
      await selectWindow(button.dataset.windowId);
    });
  });

  renderMobilePaneSwitcher();
  bindSessionCreateControls();
}

function paneBadges(window) {
  const badges = [];
  if (window.is_active) badges.push("active");
  if (window.is_focused) badges.push("focused");
  if (window.is_attached) badges.push("attached");
  if (isPaneCached(window.id)) badges.push("cached");
  if (window.alternate_on) badges.push("alt-screen");
  if (window.zoomed) badges.push("zoomed");
  if (window.at_prompt) badges.push("prompt");
  return badges;
}

// Three rows: title with the pane number, cwd shortened in the middle so the
// directory name stays visible, then the process beside the badges.
function paneCardMarkup(window) {
  const activeClass = Number(window.id) === Number(state.selectedWindowId) ? "selected" : "";
  const title = window.title || `Pane ${window.id}`;
  const cwd = window.cwd || "";
  const cut = cwd.lastIndexOf("/");
  const cwdHead = cut > 0 ? cwd.slice(0, cut + 1) : "";
  const cwdTail = cut > 0 ? cwd.slice(cut + 1) : cwd;
  return `
    <button class="pane-item ${activeClass}" type="button" data-window-id="${window.id}">
      <div class="pane-item-head">
        <strong>${escapeHtml(title)}</strong>
        <span>#${window.id} ${closeButtonMarkup("pane", window.id, title)}</span>
      </div>
      <p class="pane-cwd" title="${escapeAttribute(cwd)}"><span class="pane-cwd-head">${escapeHtml(cwdHead)}</span><span class="pane-cwd-tail">${escapeHtml(cwdTail)}</span></p>
      <div class="badge-row">
        <small>${escapeHtml(getWindowProcessLabel(window))}</small>
        <span class="badge-list">${paneBadges(window).map((badge) => `<span class="mini-badge">${badge}</span>`).join("")}</span>
      </div>
    </button>
  `;
}

function countOsWindowPanes(osWindow) {
  return (osWindow.tabs || []).reduce((total, tab) => total + (tab.windows || []).length, 0);
}

// The close control lives inside the pane button, so it is a span, not a button.
function closeButtonMarkup(kind, id, title, paneCount = 1) {
  return `<span
    class="session-close-button"
    role="button"
    tabindex="0"
    aria-label="Close ${escapeAttribute(title)}"
    title="Close ${escapeAttribute(title)}"
    data-close-kind="${kind}"
    data-close-id="${escapeAttribute(id)}"
    data-close-title="${escapeAttribute(title)}"
    data-close-panes="${paneCount}"
  >×</span>`;
}

async function handleSessionCloseClick(event) {
  const control = event.target.closest?.("[data-close-kind]");
  if (!control) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!state.selectedTargetId) {
    return;
  }
  const kind = control.dataset.closeKind;
  const labels = state.sessionLabels;
  const kindLabel = { session: labels.osWindow, tab: labels.tab, pane: "pane" }[kind] || kind;
  const panes = Number(control.dataset.closePanes) || 1;
  const verb = backendFeature("closeVerb");
  const question =
    `${verb} ${kindLabel.toLowerCase()} "${control.dataset.closeTitle}"?` +
    (panes > 1 ? ` ${panes} panes and their processes will be closed.` : " Its process will be closed.");
  if (!window.confirm(question)) {
    return;
  }
  try {
    await apiFetch("/api/close-panel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: state.selectedTargetId,
        socket: state.selectedSocket || "",
        kind,
        id: Number(control.dataset.closeId)
      })
    });
    setStatus(`${kindLabel} "${control.dataset.closeTitle}" closed.`, "success");
    await loadSessions();
  } catch (error) {
    setStatus(error.message, "danger");
  }
}

function getSessionPaneFromEvent(event) {
  return event.target.closest?.("[data-window-id]") || null;
}

function handleSessionPointerDown(event) {
  const pane = getSessionPaneFromEvent(event);
  if (!pane || event.target.closest?.("[data-close-kind]") || !["touch", "pen"].includes(event.pointerType)) {
    sessionPointerStart = null;
    return;
  }

  sessionPointerStart = {
    pointerId: event.pointerId,
    windowId: pane.dataset.windowId,
    x: event.clientX,
    y: event.clientY,
    time: Date.now()
  };
}

async function handleSessionPointerUp(event) {
  if (!sessionPointerStart || sessionPointerStart.pointerId !== event.pointerId) {
    return;
  }

  const start = sessionPointerStart;
  sessionPointerStart = null;
  const pane = getSessionPaneFromEvent(event);
  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  const elapsed = Date.now() - start.time;

  if (!pane || pane.dataset.windowId !== start.windowId || moved > 14 || elapsed > 900) {
    return;
  }

  suppressSessionClickUntil = Date.now() + 650;
  event.preventDefault();
  await selectWindow(start.windowId);
}

async function loadSessions(options = {}) {
  if (!state.selectedTargetId) {
    setStatus("Choose a connection target from the top selector first.", "warning");
    return;
  }

  // The host can be reachable while its terminal list fails (no tmux server).
  refreshHostStats().catch(() => {});
  const requestSerial = ++sessionRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const query = new URLSearchParams({
    targetId: capturedTargetId
  });

  if (capturedSocket) {
    query.set("socket", capturedSocket);
  }

  const data = await apiFetch(`/api/sessions?${query.toString()}`);
  if (
    requestSerial !== sessionRequestSerial ||
    capturedTargetId !== state.selectedTargetId ||
    capturedSocket !== state.selectedSocket
  ) {
    return;
  }

  const previousWindowId = state.selectedWindowId;
  const deferPaneRefresh = isMobileViewport() && state.mobileScreen !== "chat";
  state.sessionTree = data.tree || [];
  state.sessionLabels = data.labels || labelsForTarget(getSelectedTarget());
  state.sessionBackend = normalizeBackend(data.backend || getSelectedTarget()?.backend);
  state.flatWindows = flattenWindows(state.sessionTree);
  state.selectedSocket = data.selectedSocket || "";
  renderSocketOptions(data.sockets || [], state.selectedSocket);

  const restoredWindowId = hasSelectedWindow() ? null : findRestorablePane(capturedTargetId);
  if (restoredWindowId !== null) {
    state.selectedWindowId = restoredWindowId;
  } else if (deferPaneRefresh && state.selectedWindowId) {
    if (!state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))) {
      state.selectedWindowId = null;
    }
  } else if (!deferPaneRefresh && !hasSelectedWindow() && state.flatWindows[0]) {
    state.selectedWindowId = Number(state.flatWindows[0].id);
  } else if (
    !deferPaneRefresh &&
    hasSelectedWindow() &&
    !state.flatWindows.some((window) => Number(window.id) === Number(state.selectedWindowId))
  ) {
    state.selectedWindowId = state.flatWindows[0] ? Number(state.flatWindows[0].id) : null;
  }

  const selectedWindowChanged = Number(previousWindowId) !== Number(state.selectedWindowId);
  rememberSelectedPane();
  if (selectedWindowChanged) {
    invalidateScreenRequests();
    if (hasSelectedWindow() && !deferPaneRefresh) {
      renderPaneLoading(state.selectedWindowId);
    }
  }

  renderSessions();
  renderViewerMeta();
  setTargetHealth("Connected", "success");
  updateStatusBar();
  sendClientDebug("loadSessions:rendered", null, { force: true });
  if (hasSelectedWindow() && !selectedWindowChanged && !selectedWindowFitsView()) {
    scheduleExternalFit();
  }

  if (hasSelectedWindow() && !deferPaneRefresh) {
    if (options.refreshPane !== false) {
      await refreshScreen({
        force: Boolean(options.forceRefresh),
        scrollToBottom: Boolean(options.scrollToBottom || (selectedWindowChanged && activeExtent() === "screen"))
      });
    } else if (selectedWindowChanged) {
      state.screenText = "";
      elements.screenOutput.textContent = "The current pane changed. Click Refresh to update content.";
    }
  } else if (!hasSelectedWindow()) {
    elements.screenOutput.textContent = deferPaneRefresh
      ? "Select a session before loading pane content."
      : "No pane is available to display.";
  }
}

async function refreshScreen(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }

  if (state.refreshing && !options.force) {
    return;
  }

  if (activeExtent() === "all" && !state.allTextFollowTail && !options.force) {
    setStatus("Browsing history · All auto refresh paused.", "neutral");
    return;
  }

  const requestSerial = ++screenRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const capturedWindowId = state.selectedWindowId;
  const capturedExtent = activeExtent();
  if (screenAbortController) {
    screenAbortController.abort();
  }
  const requestController = new AbortController();
  screenAbortController = requestController;
  state.refreshing = true;

  try {
    const query = new URLSearchParams({
      targetId: capturedTargetId,
      windowId: String(capturedWindowId),
      extent: capturedExtent
    });

    if (capturedSocket) {
      query.set("socket", capturedSocket);
    }

    const screenKey = `${capturedTargetId}|${capturedSocket}|${capturedWindowId}|${capturedExtent}`;
    // Loading/error placeholders clear state.screenText, which disables the shortcut.
    const canSkipUnchanged =
      renderedScreen.key === screenKey &&
      state.screenText !== "" &&
      renderedScreen.text === state.screenText &&
      elements.screenOutput.getAttribute("aria-busy") !== "true";
    if (canSkipUnchanged && renderedScreen.hash && !options.noDelta) {
      query.set("since", renderedScreen.hash);
      query.set("delta", "1");
    }

    const data = await apiFetch(`/api/screen?${query.toString()}`, {
      signal: requestController.signal
    });
    if (data.delta) {
      // The server described the new text relative to the one we rendered.
      if (canSkipUnchanged && data.base === renderedScreen.hash && typeof renderedScreen.text === "string") {
        data.text = TERMINAL_LINES.applyLineDelta(TERMINAL_LINES.splitLines(renderedScreen.text), data).join("\n");
      } else if (requestSerial === screenRequestSerial) {
        state.refreshing = false;
        return refreshScreen({ ...options, force: true, noDelta: true });
      }
    }
    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      capturedExtent === activeExtent()
    ) {
      if (data.unchanged && canSkipUnchanged) {
        renderScreenData(renderedScreen.data || { text: state.screenText }, options);
      } else {
        const nextText = data.text || "";
        if (renderedScreen.key === screenKey && nextText !== state.screenText) {
          noteScreenActivity();
        }
        renderScreenData(data, options);
        renderedScreen = { key: screenKey, hash: data.hash || "", text: state.screenText, data };
        rememberScreen(renderedScreen);
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId)
    ) {
      state.screenText = "";
      leaveWindowLayout();
      elements.screenOutput.textContent = `Pane #${capturedWindowId} could not be loaded. Click Refresh to try again.`;
      elements.screenOutput.setAttribute("aria-busy", "false");
      elements.screenOutput.dataset.paneId = String(capturedWindowId);
    }
    throw error;
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
      if (screenAbortController === requestController) {
        screenAbortController = null;
      }
    }
  }
}

function bindSessionsEvents() {
  elements.reloadSessionsBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
    } catch (error) {
      setTargetHealth("Refresh failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.reloadSessionTreeBtn.addEventListener("click", async () => {
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
    } catch (error) {
      setTargetHealth("Refresh failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.sessionTree.addEventListener("click", (event) => {
    handleSessionCloseClick(event).catch((error) => setStatus(error.message, "danger"));
  });

  elements.sessionTree.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-close-kind]")) {
      handleSessionCloseClick(event).catch((error) => setStatus(error.message, "danger"));
    }
  });

  elements.sessionTree.addEventListener("pointerdown", handleSessionPointerDown);

  elements.sessionTree.addEventListener("pointerup", (event) => {
    handleSessionPointerUp(event).catch((error) => setStatus(error.message, "danger"));
  });

  elements.sessionTree.addEventListener("pointercancel", () => {
    sessionPointerStart = null;
  });
}
