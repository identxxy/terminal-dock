// Workbench chrome: applyUiState, sidebar/activity bar, resize drags, font/theme, auth gate, status bar.

function applyUiState() {
  if (isMobileViewport()) {
    state.sidebarVisible = state.mobileScreen !== "chat";
    if (state.mobileScreen === "connect") {
      state.activeSidebarView = "ssh";
    } else if (state.mobileScreen === "sessions") {
      state.activeSidebarView = "sessions";
    } else if (state.mobileScreen === "layouts") {
      state.activeSidebarView = "layouts";
    } else if (state.mobileScreen === "reports") {
      state.activeSidebarView = "browser";
    }
  }

  const showingSsh = state.activeSidebarView === "ssh";
  const showingSessions = state.activeSidebarView === "sessions";
  const showingLayouts = state.activeSidebarView === "layouts";
  const showingBrowser = state.activeSidebarView === "browser";
  elements.sshSidebarView.hidden = !showingSsh;
  elements.sessionsSidebarView.hidden = !showingSessions;
  elements.layoutsSidebarView.hidden = !showingLayouts;
  elements.browserSidebarView.hidden = !showingBrowser;
  elements.appShell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  elements.appShell.classList.toggle("preview-open", state.previewVisible);
  elements.appShell.classList.toggle("browser-pinned", state.previewVisible && state.previewPinned);
  elements.appShell.classList.toggle("mobile-screen-connect", state.mobileScreen === "connect");
  elements.appShell.classList.toggle("mobile-screen-sessions", state.mobileScreen === "sessions");
  elements.appShell.classList.toggle("mobile-screen-layouts", state.mobileScreen === "layouts");
  elements.appShell.classList.toggle("mobile-screen-reports", state.mobileScreen === "reports");
  elements.appShell.classList.toggle("mobile-screen-chat", state.mobileScreen === "chat");
  elements.appShell.classList.toggle("mobile-screen-browser", state.mobileScreen === "browser");
  elements.appShell.classList.toggle("mobile-terminal-wide", state.mobileTerminalWidth === "wide");
  elements.showSshViewBtn.classList.toggle("active", state.sidebarVisible && showingSsh);
  elements.showSessionsViewBtn.classList.toggle("active", state.sidebarVisible && showingSessions);
  elements.showSshViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSsh));
  elements.showSessionsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingSessions));
  elements.showLayoutsViewBtn.classList.toggle("active", state.sidebarVisible && showingLayouts);
  elements.showLayoutsViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingLayouts));
  elements.showBrowserViewBtn.classList.toggle("active", state.sidebarVisible && showingBrowser);
  elements.showBrowserViewBtn.setAttribute("aria-pressed", String(state.sidebarVisible && showingBrowser));
  elements.appShell.classList.toggle("resize-enabled", state.resizeEnabled);
  elements.previewDrawer.setAttribute("aria-hidden", String(!state.previewVisible));
  applyBrowserHandle();
  applyMobileBackLabels();
  elements.browserBackBtn.disabled = state.previewHistoryIndex < 0;
  elements.browserForwardBtn.disabled = state.previewHistoryIndex < 0 || state.previewHistoryIndex >= state.previewHistory.length - 1;
  elements.browserGoBtn.disabled = !state.selectedTargetId;
  elements.pinBrowserBtn.classList.toggle("active", state.previewPinned);
  elements.pinBrowserBtn.setAttribute("aria-pressed", String(state.previewPinned));
  elements.pinBrowserBtn.title = state.previewPinned ? "Unpin Browser" : "Pin Browser";
  if (document.activeElement !== elements.browserAddressInput) {
    elements.browserAddressInput.value = state.previewUrl;
  }
  renderBrowserHistoryOptions();
  elements.autoFitToggle.checked = state.autoFitPane;
  elements.fontSizeValue.textContent = `${state.uiFontSizePx}px`;
  elements.themeSelect.value = state.uiTheme;
  if (elements.fontSizeValueMobile) {
    elements.fontSizeValueMobile.textContent = `${state.uiFontSizePx}px`;
  }
  if (elements.themeSelectMobile) {
    if (!elements.themeSelectMobile.options.length) {
      elements.themeSelectMobile.innerHTML = elements.themeSelect.innerHTML;
    }
    elements.themeSelectMobile.value = state.uiTheme;
  }
  elements.screenModeBtn.classList.toggle("active", state.screenExtent === "screen");
  elements.allTextModeBtn.classList.toggle("active", state.screenExtent === "all");
  elements.screenModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "screen"));
  elements.allTextModeBtn.setAttribute("aria-pressed", String(state.screenExtent === "all"));
  elements.screenOutput.dataset.extent = activeExtent();
  elements.mobileTerminalWidthBtn.classList.toggle("active", state.mobileTerminalWidth === "wide");
  elements.mobileTerminalWidthBtn.setAttribute("aria-pressed", String(state.mobileTerminalWidth === "wide"));
  elements.mobileTerminalWidthBtn.textContent = state.mobileTerminalWidth === "wide" ? "Wide" : "Fit";
  elements.mobileTerminalWidthBtn.title = state.mobileTerminalWidth === "wide"
    ? "Keep the terminal's original width and allow horizontal scrolling"
    : "Fit terminal text to the phone width";
  elements.resizeToggle.setAttribute("aria-pressed", String(state.resizeEnabled));
  document.documentElement.style.setProperty("--root-font-size", `${state.uiFontSizePx}px`);
  document.documentElement.dataset.theme = state.uiTheme;
  document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
  document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  document.documentElement.style.setProperty("--bottom-panel-height", `${state.bottomPanelHeight}px`);
  autosizeComposer();
  applyResizeLabel();
  updateStatusBar();
  saveUiPreferences();
  // Pinning, unpinning or navigating the Browser changes the active layout.
  scheduleLayoutAutosave();
}

// Each phone screen's back button names the screen underneath it.
const MOBILE_BACK_BUTTONS = {
  sessions: "mobileBackToConnectBtn",
  chat: "mobileBackToSessionsBtn",
  layouts: "mobileBackFromLayoutsBtn",
  reports: "mobileBackFromBrowserListBtn",
  browser: "mobileBrowserBackBtn"
};

function applyResizeLabel() {
  elements.resizeLabel.textContent = state.resizeEnabled ? "Unlocked" : "Locked";
  elements.resizeToggle.title = state.resizeEnabled
    ? "Layout unlocked. Drag the sidebar and bottom panel edges; click to lock."
    : "Layout locked. Click to allow dragging the sidebar and bottom panel edges.";
}

function stepFontSize(delta) {
  state.uiFontSizePx = clamp(state.uiFontSizePx + delta, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  applyUiState();
  // Cell size changed: redraw the layout at the new size now, then refit the pane.
  syncLayoutCellSize();
  scheduleAutoFit();
}

function syncLayoutCellSize() {
  const container = elements.screenOutput.querySelector(".tmux-window");
  if (!container) {
    return;
  }
  const cell = measureCellSize(elements.screenOutput);
  container.style.setProperty("--cell-w", `${cell.width}px`);
  container.style.setProperty("--cell-h", `${cell.height}px`);
}

function setTargetHealth(label, mode) {
  elements.targetHealth.textContent = label;
  elements.targetHealth.dataset.mode = mode || "neutral";
  updateStatusBar();
}

function setAuthStatus(message, mode) {
  elements.authStatusText.textContent = message;
  if (mode) {
    elements.authStatusText.dataset.mode = mode;
  } else {
    delete elements.authStatusText.dataset.mode;
  }
}

function getAuthDeviceText(device) {
  if (!device) {
    return "";
  }

  const label = device.label || "Unnamed device";
  const preview = device.tokenPreview ? ` · ${device.tokenPreview}` : "";
  return `${label}${preview}`;
}

function setAuthDeviceMeta(device, fallback = "Enter the token for this device.") {
  elements.authDeviceMeta.textContent = device
    ? `Current key: ${getAuthDeviceText(device)}`
    : fallback;
}

function showAuthToast(message, mode = "success") {
  if (authToastTimer) {
    clearTimeout(authToastTimer);
  }

  elements.authToast.textContent = message;
  elements.authToast.dataset.mode = mode;
  elements.authToast.hidden = false;

  authToastTimer = setTimeout(() => {
    elements.authToast.hidden = true;
  }, 3200);
}

function setAuthState(authenticated, device = null) {
  state.authenticated = Boolean(authenticated);
  if (!state.authenticated) {
    closeLiveSource();
  }
  state.authDevice = state.authenticated ? device : null;
  elements.authGate.hidden = state.authenticated;
  elements.authDeviceLabel.hidden = !state.authenticated;
  elements.logoutBtn.hidden = !state.authenticated;
  elements.authDeviceLabel.textContent = state.authDevice ? `Key: ${getAuthDeviceText(state.authDevice)}` : "";
  setAuthDeviceMeta(state.authDevice);

  if (!state.authenticated) {
    stopPolling();
  }

  if (!state.authenticated) {
    cancelMobileAutoConnect({ suppress: true });
  }
}

function updateStatusBar() {
  const target = getSelectedTarget();
  const pane = state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId));
  elements.statusTargetName.textContent = `Target: ${target ? target.name : "-"}`;
  elements.statusSocketName.textContent = `Socket: ${state.selectedSocket || "auto"}`;
  elements.statusPaneName.textContent = pane ? `Pane: ${describePaneLocation(pane)}` : "Pane: -";
  elements.statusAutoRefresh.textContent = `Updates: ${isPrimaryLive() ? "live" : "polling"}`;
}

async function checkAuthStatus() {
  setAuthState(false);
  setAuthStatus("Checking saved sign-in state...", "neutral");
  setAuthDeviceMeta(null, "If this device is already signed in, the workspace will open automatically.");
  const payload = await apiFetch("/api/auth/status");
  setAuthState(Boolean(payload.authenticated), payload.device || null);
  if (state.authenticated) {
    const deviceText = getAuthDeviceText(state.authDevice);
    setAuthStatus(`Authenticated: ${deviceText}`, "success");
    showAuthToast(`Authenticated: ${deviceText}`);
  } else {
    setAuthStatus("Authentication required: enter this device's token.", "neutral");
    setAuthDeviceMeta(null, "Not authenticated. Enter the token created for this device.");
  }
  return state.authenticated;
}

async function loginWithDeviceToken() {
  const token = elements.authTokenInput.value.trim();

  if (!token) {
    setAuthStatus("Enter a device token.", "danger");
    return;
  }

  const payload = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });

  elements.authTokenInput.value = "";
  setAuthState(true, payload.device);
  const deviceText = getAuthDeviceText(payload.device);
  setAuthStatus(`Authenticated: ${deviceText}`, "success");
  showAuthToast(`Authenticated: ${deviceText}`);
  await bootAuthenticatedWorkspace();
}

async function logoutDevice() {
  await apiFetch("/api/auth/logout", {
    method: "POST"
  });
  setAuthState(false);
  state.targets = [];
  clearSessionSelection();
  renderTargetSelect();
  renderSavedTargets();
  setAuthStatus("Signed out. Enter a device token to sign in again.", "neutral");
  setAuthDeviceMeta(null, "No authenticated key is active.");
}

function attachWheelContainment() {
  document.querySelectorAll(".scroll-panel").forEach(attachWheelContainmentTo);
}

function attachWheelContainmentTo(panel) {
  if (panel.__wheelContained) {
    return;
  }
  panel.__wheelContained = true;
  {
    panel.addEventListener(
      "wheel",
      (event) => {
        const maxScroll = panel.scrollHeight - panel.clientHeight;
        if (maxScroll <= 0) {
          return;
        }

        const nextScroll = panel.scrollTop + event.deltaY;
        if (nextScroll > 0 && nextScroll < maxScroll) {
          event.stopPropagation();
        }
      },
      { passive: true }
    );
  }
}

function setSidebarView(view) {
  const nextView = SIDEBAR_VIEW_SET.has(view) ? view : "sessions";
  if (state.sidebarVisible && state.activeSidebarView === nextView) {
    state.sidebarVisible = false;
  } else {
    state.activeSidebarView = nextView;
    state.sidebarVisible = true;
  }
  applyUiState();
}

// The Browser edge is always draggable on desktop; the sidebar and bottom
// panel handles follow the layout lock.
function startResize(kind, event) {
  if (kind !== "browser" && !state.resizeEnabled) {
    return;
  }

  event.preventDefault();
  resizeSession = {
    kind,
    startX: event.clientX,
    startY: event.clientY,
    sidebarWidth: state.sidebarWidth,
    browserWidth: getEffectiveBrowserWidth(),
    bottomPanelHeight: state.bottomPanelHeight
  };
  elements.appShell.classList.add("resizing");
  // Capture keeps pointermove flowing while the pointer crosses the Browser iframe.
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch (error) {
    // Older browsers without pointer capture still get window-level moves.
  }
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", stopResize, { once: true });
  window.addEventListener("pointercancel", stopResize, { once: true });
}

function handleResizeMove(event) {
  if (!resizeSession) {
    return;
  }

  if (resizeSession.kind === "sidebar") {
    const bounds = getSidebarWidthBounds();
    state.sidebarWidth = clamp(
      resizeSession.sidebarWidth + event.clientX - resizeSession.startX,
      bounds.min,
      bounds.max
    );
  }

  if (resizeSession.kind === "panel") {
    state.bottomPanelHeight = clamp(
      resizeSession.bottomPanelHeight + resizeSession.startY - event.clientY,
      PANEL_HEIGHT_RANGE.min,
      PANEL_HEIGHT_RANGE.max
    );
    state.bottomPanelPinned = true;
    autosizeComposer();
  }

  if (resizeSession.kind === "browser") {
    const bounds = getBrowserWidthBounds();
    state.browserWidth = clamp(
      resizeSession.browserWidth + resizeSession.startX - event.clientX,
      bounds.min,
      bounds.max
    );
  }

  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
  document.documentElement.style.setProperty("--bottom-panel-height", `${state.bottomPanelHeight}px`);
}

function stopResize() {
  if (!resizeSession) {
    return;
  }

  resizeSession = null;
  elements.appShell.classList.remove("resizing");
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  saveUiPreferences();
}

function bindShellEvents() {
  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setAuthStatus("Signing in...", "neutral");
      await loginWithDeviceToken();
    } catch (error) {
      if (!state.authenticated) {
        setAuthState(false);
        setAuthStatus(`Authentication failed: ${error.message}`, "danger");
        setAuthDeviceMeta(null, "Confirm that the token belongs to this device, or ask an administrator to create or rotate it.");
      } else {
        setAuthStatus(`Authenticated, but workspace loading failed: ${error.message}`, "danger");
        showAuthToast(`Workspace loading failed: ${error.message}`, "danger");
      }
    }
  });

  elements.logoutBtn.addEventListener("click", async () => {
    try {
      await logoutDevice();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.showSshViewBtn.addEventListener("click", () => {
    setSidebarView("ssh");
  });

  elements.showSessionsViewBtn.addEventListener("click", () => {
    setSidebarView("sessions");
  });

  elements.showLayoutsViewBtn.addEventListener("click", () => {
    setSidebarView("layouts");
  });

  elements.showBrowserViewBtn.addEventListener("click", () => {
    setSidebarView("browser");
    if (state.sidebarVisible && state.previewUrl && !state.previewVisible) {
      reopenPreview().catch((error) => setPreviewStatus(error.message, "danger"));
    }
  });

  elements.decreaseFontBtn.addEventListener("click", () => {
    stepFontSize(-1);
  });

  elements.increaseFontBtn.addEventListener("click", () => {
    stepFontSize(1);
  });

  // The phone copies of the appearance controls drive the top-bar originals.
  elements.decreaseFontBtnMobile?.addEventListener("click", () => elements.decreaseFontBtn.click());

  elements.increaseFontBtnMobile?.addEventListener("click", () => elements.increaseFontBtn.click());

  elements.themeSelectMobile?.addEventListener("change", () => {
    elements.themeSelect.value = elements.themeSelectMobile.value;
    elements.themeSelect.dispatchEvent(new Event("change"));
  });

  elements.themeSelect.addEventListener("change", () => {
    const nextTheme = elements.themeSelect.value;
    state.uiTheme = THEME_SET.has(nextTheme) ? nextTheme : "dark";
    applyUiState();
  });

  elements.resizeToggle.addEventListener("click", () => {
    state.resizeEnabled = !state.resizeEnabled;
    applyUiState();
  });

  elements.sidebarResizeHandle.addEventListener("pointerdown", (event) => startResize("sidebar", event));

  elements.panelResizeHandle.addEventListener("pointerdown", (event) => startResize("panel", event));

  elements.panelResizeHandle.addEventListener("dblclick", () => {
    state.bottomPanelPinned = false;
    applyUiState();
  });

  elements.browserResizeHandle.addEventListener("pointerdown", (event) => startResize("browser", event));

  window.addEventListener("resize", () => {
    document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);
    document.documentElement.style.setProperty("--browser-width", `${getEffectiveBrowserWidth()}px`);
    if (paneTreeMobileMode !== null && paneTreeMobileMode !== isMobileViewport()) {
      renderPaneTree();
    }
    scheduleAutoFit();
  });
}
