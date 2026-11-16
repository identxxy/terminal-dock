// Terminal output: Transcript/Screen rendering, tmux window layout, scroll forwarding, pane fit.

function isScreenOutputNearBottom(threshold = 48) {
  const output = elements.screenOutput;
  return output.scrollHeight - output.scrollTop - output.clientHeight < threshold;
}

function setScreenOutputScrollTop(scrollTop) {
  const output = elements.screenOutput;
  const maxScrollTop = Math.max(0, output.scrollHeight - output.clientHeight);
  output.scrollTop = clamp(scrollTop, 0, maxScrollTop);
}

function getScreenOutputScrollBoundary() {
  const output = elements.screenOutput;
  const maxScrollTop = Math.max(0, output.scrollHeight - output.clientHeight);
  return {
    maxScrollTop,
    atTop: output.scrollTop <= LOCAL_SCROLL_BOUNDARY_EPSILON,
    atBottom: output.scrollTop >= maxScrollTop - LOCAL_SCROLL_BOUNDARY_EPSILON
  };
}

function shouldForwardScrollDeltaToKitty(deltaY) {
  if (!deltaY) {
    return false;
  }

  const boundary = getScreenOutputScrollBoundary();
  if (boundary.maxScrollTop <= LOCAL_SCROLL_BOUNDARY_EPSILON) {
    return true;
  }

  return deltaY < 0 ? boundary.atTop : boundary.atBottom;
}

function shouldForwardWheelToKitty(event) {
  return shouldForwardScrollDeltaToKitty(event.deltaY || 0);
}

function renderScreenData(data, options = {}) {
  if (data && Array.isArray(data.panes) && data.window) {
    renderWindowLayout(data, options);
  } else {
    renderScreenText(data?.text || "", options);
  }
  scheduleHistoryRail();
}

function leaveWindowLayout() {
  const output = elements.screenOutput;
  const wasLayout = output.classList.contains("window-layout");
  output.classList.remove("window-layout");
  delete output.dataset.layoutKey;
  paneTextsFor(output).clear();
  return wasLayout;
}

// Draw every pane of the selected pane's tmux window where tmux puts it, so the
// view matches an attached terminal: splits, borders, zoom. Clicking a pane
// makes it the input target without leaving the window.
function renderWindowLayout(data, options = {}) {
  const output = elements.screenOutput;
  const previousTop = output.scrollTop;
  const previousLeft = output.scrollLeft;
  state.screenText = drawWindowLayout(output, data, Number(state.selectedWindowId), paneTextsFor(output));
  noteWindowSize(state.selectedWindowId, Number(data.window.columns), Number(data.window.rows));
  output.setAttribute("aria-busy", "false");
  output.dataset.paneId = hasSelectedWindow() ? String(state.selectedWindowId) : "";
  if (options.scrollToTop) {
    output.scrollTop = 0;
  } else {
    output.scrollTop = previousTop;
    output.scrollLeft = previousLeft;
  }
  updateLatestOutputButton();
}

// Draw a tmux window into any output element; returns the selected pane's text.
function drawWindowLayout(output, data, selectedId, paneTexts) {
  const selected =
    data.panes.find((pane) => Number(pane.id) === selectedId) || data.panes.find((pane) => pane.active) || data.panes[0];

  const layoutKey = [
    `${data.window.columns}x${data.window.rows}`,
    ...data.panes.map((pane) => `${pane.id}:${pane.left},${pane.top},${pane.columns},${pane.rows}`)
  ].join("|");
  let container = output.querySelector(".tmux-window");
  if (!container || output.dataset.layoutKey !== layoutKey || output.getAttribute("aria-busy") === "true") {
    output.innerHTML = "";
    paneTexts.clear();
    container = document.createElement("div");
    container.className = "tmux-window";
    data.panes.forEach((pane) => {
      const node = document.createElement("pre");
      node.className = "tmux-pane";
      node.dataset.layoutPaneId = String(pane.id);
      node.style.left = `calc(${pane.left} * var(--cell-w))`;
      node.style.top = `calc(${pane.top} * var(--cell-h))`;
      node.style.width = `calc(${pane.columns} * var(--cell-w))`;
      node.style.height = `calc(${pane.rows} * var(--cell-h))`;
      container.appendChild(node);
    });
    output.appendChild(container);
    output.dataset.layoutKey = layoutKey;
  }
  output.classList.add("window-layout");
  const cell = measureCellSize(output);
  container.style.setProperty("--cell-w", `${cell.width}px`);
  container.style.setProperty("--cell-h", `${cell.height}px`);
  container.style.width = `calc(${data.window.columns} * var(--cell-w))`;
  container.style.height = `calc(${data.window.rows} * var(--cell-h))`;

  data.panes.forEach((pane) => {
    const node = container.querySelector(`[data-layout-pane-id="${pane.id}"]`);
    if (!node) {
      return;
    }
    const text = pane.text || "";
    if (paneTexts.get(Number(pane.id)) !== text) {
      renderTerminalLines(node, text, " ");
      paneTexts.set(Number(pane.id), text);
    }
    node.classList.toggle("selected", Number(pane.id) === selectedId);
    node.classList.toggle("active", Boolean(pane.active));
    node.title = `${pane.title || `Pane ${pane.id}`} · #${pane.id} · ${pane.columns}×${pane.rows}`;
  });
  return selected ? selected.text || "" : "";
}

// After a remote scroll only the selected pane's text changes; keep the layout.
function renderScrolledPaneText(text, options = {}) {
  const node = elements.screenOutput.querySelector(`.tmux-pane[data-layout-pane-id="${state.selectedWindowId}"]`);
  if (!node || !elements.screenOutput.classList.contains("window-layout")) {
    renderScreenText(text, options);
    return;
  }
  const nextText = text || "";
  state.screenText = nextText;
  renderTerminalLines(node, nextText, " ");
  paneTextsFor(elements.screenOutput).set(Number(state.selectedWindowId), nextText);
  const cached = renderedScreen.data?.panes?.find((pane) => Number(pane.id) === Number(state.selectedWindowId));
  if (cached) {
    cached.text = nextText;
  }
  renderedScreen.text = nextText;
  updateLatestOutputButton();
}

function renderScreenText(text, options = {}) {
  const output = elements.screenOutput;
  const previousTop = output.scrollTop;
  const wasNearBottom = isScreenOutputNearBottom();
  const nextText = text || "";
  const wasLayout = leaveWindowLayout();

  if (wasLayout || state.screenText !== nextText || output.getAttribute("aria-busy") === "true") {
    state.screenText = nextText;
    renderTerminalLines(output, state.screenText, "(current screen is empty)");
  }
  output.setAttribute("aria-busy", "false");
  output.dataset.paneId = hasSelectedWindow() ? String(state.selectedWindowId) : "";

  if (activeExtent() === "all") {
    if (options.scrollToBottom || state.allTextFollowTail || wasNearBottom) {
      output.scrollTop = output.scrollHeight;
      state.allTextFollowTail = true;
    } else {
      output.scrollTop = previousTop;
    }
    updateLatestOutputButton();
    return;
  }

  if (options.scrollToTop) {
    output.scrollTop = 0;
  } else if (options.scrollToBottom) {
    output.scrollTop = output.scrollHeight;
  } else {
    setScreenOutputScrollTop(previousTop);
  }
  updateLatestOutputButton();
}

function updateLatestOutputButton() {
  const awayFromLatest =
    activeExtent() === "all" ? !state.allTextFollowTail : viewportScrolledBack;
  const hidden = !hasSelectedWindow() || !awayFromLatest;
  if (elements.latestOutputBtn.hidden !== hidden) {
    elements.latestOutputBtn.hidden = hidden;
  }
}

// Return to the live end: Screen mode scrolls the kitty viewport back to its end;
// All mode resumes tailing the browser-side scrollback.
async function jumpToLatestOutput() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }

  pendingScrollLines = 0;
  if (activeExtent() === "all") {
    state.allTextFollowTail = true;
    updateLatestOutputButton();
    await refreshScreen({ force: true, scrollToBottom: true });
    return;
  }

  await scrollRemoteWindow(0, { toEnd: true });
}

function renderPaneLoading(windowId) {
  state.screenText = "";
  leaveWindowLayout();
  elements.screenOutput.textContent = `Loading pane #${windowId}...`;
  elements.screenOutput.setAttribute("aria-busy", "true");
  elements.screenOutput.dataset.paneId = String(windowId ?? "");
  elements.screenOutput.scrollTop = 0;
  scheduleHistoryRail();
}

// Scroll events arrive per frame while swiping; the bookkeeping runs once per
// animation frame and touches the DOM only when something changes.
let screenScrollFrame = 0;

function handleScreenOutputScroll() {
  if (screenScrollFrame) {
    return;
  }
  screenScrollFrame = requestAnimationFrame(() => {
    screenScrollFrame = 0;
    if (activeExtent() === "all") {
      trackTranscriptScroll();
    }
    updateHistoryRailCurrent();
  });
}

function trackTranscriptScroll() {
  const wasFollowing = state.allTextFollowTail;
  state.allTextFollowTail = isScreenOutputNearBottom();
  updateLatestOutputButton();

  if (wasFollowing && !state.allTextFollowTail) {
    setStatus("Browsing history · All auto refresh paused.", "neutral");
  } else if (!wasFollowing && state.allTextFollowTail) {
    setStatus("All mode tailing latest output.", "neutral");
  }
}

// Size of one terminal cell in the screen output, measured from a two-line probe
// so the height is the real line box, not the glyph box.
function measureCellSize(output = elements.screenOutput) {
  const probe = document.createElement("pre");
  probe.textContent = `${"M".repeat(50)}\n${"M".repeat(50)}`;
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;margin:0;padding:0;border:0;pointer-events:none;font:inherit;line-height:inherit;";
  output.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  output.removeChild(probe);
  return { width: rect.width / 50, height: rect.height / 2 };
}

function measureScreenCells() {
  const output = elements.screenOutput;
  const cell = measureCellSize();
  const style = getComputedStyle(output);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  if (!cell.width || !cell.height || output.clientWidth === 0) {
    return null;
  }
  return {
    columns: clamp(Math.floor((output.clientWidth - padX) / cell.width), 20, 500),
    rows: clamp(Math.floor((output.clientHeight - padY) / cell.height), 5, 300)
  };
}

// With ?debug=1: the view geometry behind each auto-fit decision, appended to
// tmp/client-debug.log on the server.
function reportFitDiagnostics(info) {
  if (!clientDebugEnabled) {
    return;
  }
  try {
    const output = elements.screenOutput;
    const body = output.parentElement;
    const cell = measureCellSize();
    const payload = {
      source: "krd-fit-diag",
      build: CLIENT_BUILD,
      ua: navigator.userAgent,
      standalone: Boolean(navigator.standalone),
      inner: { w: window.innerWidth, h: window.innerHeight },
      output: { cw: output.clientWidth, ch: output.clientHeight, sh: output.scrollHeight, rect: output.getBoundingClientRect().toJSON() },
      body: body ? { ch: body.clientHeight, rect: body.getBoundingClientRect().toJSON() } : null,
      tree: elements.paneTree ? { ch: elements.paneTree.clientHeight } : null,
      cell,
      fontPx: state.uiFontSizePx,
      autoFit: state.autoFitPane,
      extent: activeExtent(),
      ...info
    };
    fetch("/api/client-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
  } catch (error) {
    // diagnostics only
  }
}

let autoFitTimer = null;

// Each local trigger (selection, viewport or font change, input, coming back
// to the foreground) opens an epoch. A window size that this view did not set
// (another deck client, or this one under an earlier layout) is re-fitted at
// most once per epoch, so two decks on the same pane cannot fight for it:
// the one the user is interacting with wins.
let autoFitEpoch = 0;

let externalFitEpoch = -1;

// "deliberate" or "settle" (see modules/pane-fit.js). A deliberate trigger
// inside the debounce window wins over view-size changes around it.
let autoFitMode = "deliberate";

function queueAutoFit() {
  if (autoFitTimer) {
    clearTimeout(autoFitTimer);
  }
  autoFitTimer = setTimeout(() => {
    autoFitTimer = null;
    const mode = autoFitMode;
    if (state.autoFitPane) {
      fitPaneToScreen({ mode }).catch((error) => setStatus(error.message, "danger"));
    }
  }, 500);
}

function scheduleAutoFit(mode = "deliberate") {
  const pending = Boolean(autoFitTimer);
  autoFitEpoch += 1;
  autoFitMode = mode === "settle" && !(pending && autoFitMode === "deliberate") ? "settle" : "deliberate";
  queueAutoFit();
}

// The selected pane's window is a size other than this view's cell grid.
function scheduleExternalFit() {
  if (!state.autoFitPane || externalFitEpoch === autoFitEpoch) {
    return;
  }
  externalFitEpoch = autoFitEpoch;
  queueAutoFit();
}

function planSelectedPaneFit(mode) {
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  const cells = pane && backendFeature("paneResize") ? measureScreenCells() : null;
  if (!cells) {
    return null;
  }
  return PANE_FIT.planPaneFit({
    windowColumns: pane.window_columns || pane.columns,
    windowRows: pane.window_lines || pane.lines,
    viewColumns: cells.columns,
    viewRows: cells.rows,
    alternate: Boolean(pane.alternate_on),
    mode
  });
}

function selectedWindowFitsView() {
  return !planSelectedPaneFit(autoFitMode);
}

// Window size as reported by a screen capture; it may have changed since the
// session tree was loaded.
function noteWindowSize(windowId, columns, rows) {
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(windowId));
  if (!pane || !columns || !rows) {
    return;
  }
  pane.window_columns = columns;
  pane.window_lines = rows;
  if (Number(windowId) === Number(state.selectedWindowId) && !selectedWindowFitsView()) {
    scheduleExternalFit();
  }
}

async function fitPaneToScreen(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return null;
  }
  if (!backendFeature("paneResize")) {
    if (options.force) {
      setStatus(`Pane resize is not available for ${state.sessionBackend} targets.`, "warning");
    }
    return null;
  }
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  const cells = measureScreenCells();
  // Split panes share the window, so the window is what must match the view.
  const windowColumns = pane ? pane.window_columns || pane.columns : 0;
  const windowLines = pane ? pane.window_lines || pane.lines : 0;
  const mode = options.force ? "force" : options.mode || "deliberate";
  // Fit pane always asks: on an attached pane it also pins window-size manual.
  const size = pane && cells ? planSelectedPaneFit(mode) || (options.force ? { columns: cells.columns, rows: cells.rows } : null) : null;
  const skip = !pane || !cells
    ? "no pane or cells"
    : !options.force && (pane.is_attached || pane.osWindowFocused)
      ? "attached"
      : !size
        ? "same size"
        : "";
  reportFitDiagnostics({ skip, cells, size, mode, windowColumns, windowLines, force: Boolean(options.force) });
  if (skip) {
    return null;
  }

  const result = await apiFetch("/api/resize-window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: state.selectedTargetId,
      socket: state.selectedSocket || "",
      windowId: state.selectedWindowId,
      columns: size.columns,
      rows: size.rows,
      force: Boolean(options.force)
    })
  });

  if (result.skipped) {
    setStatus("Pane kept its size: a terminal is attached. Use Fit pane to screen in the ⋯ menu to override.", "neutral");
    return result;
  }

  pane.window_columns = result.columns;
  pane.window_lines = result.rows;
  setStatus(
    `Window resized to ${result.columns}×${result.rows}` +
      (result.paneCount > 1 ? ` · ${result.paneCount} panes share it` : "") +
      (result.manualSize ? " · window-size manual; the attached terminal now sees a fixed canvas." : "."),
    "success"
  );
  await refreshScreen({ force: true, scrollToBottom: activeExtent() === "screen" || state.allTextFollowTail });
  return result;
}

// --- browser-side view splits ----------------------------------------------
// Modeled on deepseek-harness ui-layout: a device-local binary tree of views,
// persisted per origin. The active leaf holds #screenOutput and all the
// single-selection machinery; every other leaf is a read-only SecondaryViewer
// that polls its own pane. Phones show only the active leaf.

function renderViewerMeta() {
  renderUploadQueue();
  const windowInfo = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));

  if (!windowInfo) {
    elements.viewerMeta.textContent = "Select a pane to show its title and directory.";
    return;
  }

  elements.viewerMeta.innerHTML = `
    <strong>${escapeHtml(windowInfo.title || `Pane ${windowInfo.id}`)}</strong>
    <span>pane #${windowInfo.id}</span>
    <span>${escapeHtml(windowInfo.cwd || "")}</span>
  `;
}

function wheelDeltaToLines(event) {
  if (event.deltaMode === 1) {
    return event.deltaY;
  }

  if (event.deltaMode === 2) {
    return event.deltaY * 24;
  }

  return event.deltaY / 42;
}

function queueRemoteScrollLines(lines) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  pendingScrollLines += lines;

  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
  }

  scrollFlushTimer = setTimeout(flushRemoteScroll, WHEEL_SCROLL_DEBOUNCE_MS);
  return true;
}

function queueRemoteScrollFromWheel(event) {
  if (activeExtent() !== "screen") {
    return;
  }

  if (!shouldForwardWheelToKitty(event)) {
    return;
  }

  event.stopImmediatePropagation();

  queueRemoteScrollLines(wheelDeltaToLines(event));
}

function handleScreenTouchStart(event) {
  if (event.touches.length !== 1) {
    screenTouchScroll = null;
    return;
  }

  screenTouchScroll = {
    lastY: event.touches[0].clientY
  };
}

function handleScreenTouchMove(event) {
  if (activeExtent() !== "screen" || !screenTouchScroll || event.touches.length !== 1) {
    return;
  }

  const nextY = event.touches[0].clientY;
  const deltaY = screenTouchScroll.lastY - nextY;
  screenTouchScroll.lastY = nextY;

  if (!shouldForwardScrollDeltaToKitty(deltaY)) {
    // Native panning is off in Screen mode (touch-action), so scroll the
    // wrapped viewport text locally until an edge is reached.
    event.currentTarget.scrollTop += deltaY;
    return;
  }

  queueRemoteScrollLines((deltaY / TOUCH_SCROLL_LINE_PX) * TOUCH_SCROLL_SENSITIVITY);
}

function handleScreenTouchEnd() {
  screenTouchScroll = null;
}

async function flushRemoteScroll() {
  scrollFlushTimer = null;

  if (remoteScrollInFlight) {
    return;
  }

  const lines = clamp(Math.round(pendingScrollLines), -WHEEL_SCROLL_MAX_LINES, WHEEL_SCROLL_MAX_LINES);
  if (!lines) {
    return;
  }

  pendingScrollLines -= lines;
  remoteScrollInFlight = true;

  try {
    await scrollRemoteWindow(lines);
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    remoteScrollInFlight = false;
    if (Math.abs(pendingScrollLines) >= 1) {
      scrollFlushTimer = setTimeout(flushRemoteScroll, WHEEL_SCROLL_DEBOUNCE_MS);
    }
  }
}

async function scrollRemoteWindow(lines, options = {}) {
  const toEnd = Boolean(options.toEnd);
  const requestSerial = ++screenRequestSerial;
  const capturedTargetId = state.selectedTargetId;
  const capturedSocket = state.selectedSocket;
  const capturedWindowId = state.selectedWindowId;
  state.refreshing = true;

  try {
    const data = await apiFetch("/api/scroll-window", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: capturedTargetId,
        socket: capturedSocket,
        windowId: capturedWindowId,
        lines,
        toEnd
      })
    });

    if (
      requestSerial === screenRequestSerial &&
      capturedTargetId === state.selectedTargetId &&
      capturedSocket === state.selectedSocket &&
      Number(capturedWindowId) === Number(state.selectedWindowId) &&
      activeExtent() === "screen"
    ) {
      if (toEnd) {
        viewportScrolledBack = false;
      } else if (lines < 0) {
        viewportScrolledBack = true;
      }
      renderScrolledPaneText(data.text || "", toEnd ? { scrollToBottom: true } : {});
      setStatus(
        toEnd
          ? `Pane #${state.selectedWindowId} is showing its latest output.`
          : `Scrolled pane #${state.selectedWindowId} by ${Math.abs(lines)} lines.`,
        "success"
      );
    }
  } finally {
    if (requestSerial === screenRequestSerial) {
      state.refreshing = false;
    }
  }
}

async function setScreenExtent(extent) {
  const nextExtent = extent === "all" ? "all" : "screen";
  if (state.screenExtent === nextExtent) {
    return;
  }

  state.screenExtent = nextExtent;
  state.screenExtentExplicit = true;
  state.allTextFollowTail = true;
  invalidateScreenRequests();
  pendingScrollLines = 0;
  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
    scrollFlushTimer = null;
  }

  applyUiState();
  await refreshScreen({ force: true, scrollToBottom: true });
  setStatus(
    nextExtent === "all"
      ? "Transcript: this pane's text and scrollback, scrolled in the browser."
      : "Screen: the live window; swipes and the wheel scroll the pane itself.",
    "neutral"
  );
}

function trimUrlPunctuation(url) {
  return BROWSER_UTILS.trimUrlPunctuation(url);
}

function linkifyTerminalText(text) {
  return BROWSER_UTILS.linkifyTerminalText(text);
}

function renderTerminalText(text) {
  if (ANSI_UTILS && typeof ANSI_UTILS.renderAnsiTerminalText === "function") {
    return ANSI_UTILS.renderAnsiTerminalText(text);
  }

  return linkifyTerminalText(text);
}

// Draw terminal text as one block per line and only touch the lines that
// changed since the previous draw into the same element. tmux starts every
// captured line from default attributes, so lines render independently.
function renderTerminalLines(output, text, placeholder) {
  if (!text) {
    output.textContent = placeholder;
    output.__renderedLines = null;
    return;
  }
  TERMINAL_LINES.renderLines(output, TERMINAL_LINES.splitLines(text), renderTerminalText);
}

function bindScreenEvents() {
  elements.latestOutputBtn.addEventListener("click", () => {
    jumpToLatestOutput().catch((error) => setStatus(error.message, "danger"));
  });

  elements.screenModeBtn.addEventListener("click", async () => {
    try {
      await setScreenExtent("screen");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.allTextModeBtn.addEventListener("click", async () => {
    try {
      await setScreenExtent("all");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.autoFitToggle.addEventListener("change", () => {
    state.autoFitPane = elements.autoFitToggle.checked;
    saveUiPreferences();
    if (state.autoFitPane) {
      scheduleAutoFit();
    }
  });

  elements.fitPaneBtn.addEventListener("click", async () => {
    closeEditorMenu();
    try {
      await fitPaneToScreen({ force: true });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.zoomPaneBtn.addEventListener("click", async () => {
    closeEditorMenu();
    if (!state.selectedTargetId || !hasSelectedWindow() || !backendFeature("zoom")) {
      setStatus(`Pane zoom is not available for ${state.sessionBackend} targets.`, "warning");
      return;
    }
    try {
      const result = await apiFetch("/api/toggle-zoom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: state.selectedTargetId,
          socket: state.selectedSocket || "",
          windowId: state.selectedWindowId
        })
      });
      setStatus(result.zoomed ? `Pane #${state.selectedWindowId} zoomed.` : "Window unzoomed; split layout restored.", "neutral");
      await loadSessions();
      await refreshScreen({ force: true });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  // Sidebar, browser drawer and bottom panel drags change the output box without a window resize.
  if (typeof ResizeObserver === "function") {
    outputResizeObserver = new ResizeObserver(() => scheduleAutoFit("settle"));
    outputResizeObserver.observe(elements.screenOutput);
  }
}
