// localStorage preferences (theme, font, widths, last pane) and the width/height bounds they obey.

function getSidebarWidthBounds() {
  return RESIZE_UTILS.sidebarWidthBounds(window.innerWidth || 1200, SIDEBAR_WIDTH_RANGE);
}

function getEffectiveSidebarWidth() {
  const bounds = getSidebarWidthBounds();
  return clamp(state.sidebarWidth, bounds.min, bounds.max);
}

function getActivityBarWidth() {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--activity-width"));
  return Number.isFinite(value) ? value : 54;
}

function getBrowserWidthBounds() {
  const viewportWidth = window.innerWidth || 1200;
  return RESIZE_UTILS.browserWidthBounds({
    viewportWidth,
    activityWidth: getActivityBarWidth(),
    sidebarWidth: viewportWidth <= 720 || !state.sidebarVisible ? 0 : getEffectiveSidebarWidth(),
    range: BROWSER_WIDTH_RANGE
  });
}

function getEffectiveBrowserWidth() {
  const bounds = getBrowserWidthBounds();
  return clamp(state.browserWidth, bounds.min, bounds.max);
}

function normalizeFontSizePx(value) {
  if (Number.isFinite(value)) {
    return clamp(Math.round(value), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);
  }

  if (value === "small") {
    return 12;
  }

  if (value === "large") {
    return 14;
  }

  return FONT_SIZE_RANGE.default;
}

const SIDEBAR_VIEW_SET = new Set(["ssh", "sessions", "layouts", "browser"]);

function loadUiPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.autoFitPane = parsed.autoFitPane !== false;
    state.uiFontSizePx = normalizeFontSizePx(parsed.uiFontSizePx ?? parsed.uiFontSize);
    state.uiTheme = THEME_SET.has(parsed.uiTheme) ? parsed.uiTheme : "dark";
    // All is the default; a stored Screen choice only sticks if the user picked it from the menu.
    state.screenExtentExplicit = parsed.screenExtentExplicit === true;
    state.screenExtent =
      state.screenExtentExplicit && TEXT_EXTENT_SET.has(parsed.screenExtent) ? parsed.screenExtent : "all";
    state.mobileTerminalWidth = MOBILE_TERMINAL_WIDTH_SET.has(parsed.mobileTerminalWidth)
      ? parsed.mobileTerminalWidth
      : "fit";
    state.resizeEnabled = Boolean(parsed.resizeEnabled);
    state.activeSidebarView = SIDEBAR_VIEW_SET.has(parsed.activeSidebarView)
      ? parsed.activeSidebarView
      : "ssh";
    state.previewVisible = Boolean(parsed.previewVisible);
    state.previewPinned = Boolean(parsed.previewPinned);
    state.previewUrl = typeof parsed.previewUrl === "string" ? parsed.previewUrl : "";
    state.previewTargetId = typeof parsed.previewTargetId === "string" ? parsed.previewTargetId : "";
    state.previewHistory = Array.isArray(parsed.previewHistory)
      ? parsed.previewHistory.filter((url) => typeof url === "string" && url.trim()).slice(-30)
      : [];
    if (state.previewUrl && !state.previewHistory.includes(state.previewUrl)) {
      state.previewHistory.push(state.previewUrl);
    }
    state.previewHistoryIndex = state.previewHistory.length
      ? clamp(Number.isFinite(parsed.previewHistoryIndex) ? parsed.previewHistoryIndex : state.previewHistory.length - 1, 0, state.previewHistory.length - 1)
      : -1;
    if (state.previewHistoryIndex >= 0) {
      state.previewUrl = state.previewHistory[state.previewHistoryIndex];
    }
    state.sidebarVisible = parsed.sidebarVisible !== false;
    state.sidebarWidth = Number.isFinite(parsed.sidebarWidth)
      ? clamp(parsed.sidebarWidth, SIDEBAR_WIDTH_RANGE.min, SIDEBAR_WIDTH_RANGE.max)
      : 320;
    state.browserWidth = Number.isFinite(parsed.browserWidth)
      ? Math.max(BROWSER_WIDTH_RANGE.min, Math.round(parsed.browserWidth))
      : BROWSER_WIDTH_RANGE.default;
    state.bottomPanelHeight =
      Number.isFinite(parsed.bottomPanelHeight)
        ? clamp(parsed.bottomPanelHeight, PANEL_HEIGHT_RANGE.min, PANEL_HEIGHT_RANGE.max)
        : PANEL_HEIGHT_RANGE.default;
    state.bottomPanelPinned = Boolean(parsed.bottomPanelPinned);
  } catch (error) {
    state.autoRefresh = true;
    state.autoFitPane = true;
    state.uiFontSizePx = FONT_SIZE_RANGE.default;
    state.uiTheme = "dark";
    state.screenExtent = "all";
    state.screenExtentExplicit = false;
    state.mobileTerminalWidth = "fit";
    state.mobileScreen = "connect";
    state.resizeEnabled = false;
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
    state.previewVisible = false;
    state.previewPinned = false;
    state.previewHistory = [];
    state.previewHistoryIndex = -1;
    state.sidebarWidth = 320;
    state.browserWidth = BROWSER_WIDTH_RANGE.default;
    state.bottomPanelHeight = PANEL_HEIGHT_RANGE.default;
    state.bottomPanelPinned = false;
  }
}

// The last selected pane is restored after a reload when the same target and socket
// still list it. kitty window ids are not reused within one kitty instance, and the
// socket path names that instance.
function rememberSelectedPane() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }
  syncActivePaneActor();
  syncLiveSubscriptions();
  try {
    localStorage.setItem(
      LAST_PANE_STORAGE_KEY,
      JSON.stringify({
        targetId: state.selectedTargetId,
        socket: state.selectedSocket,
        windowId: Number(state.selectedWindowId)
      })
    );
  } catch (error) {
    // Storage can be unavailable (private mode); restoration is a convenience only.
  }
}

function findRestorablePane(targetId) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LAST_PANE_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
  if (!saved || saved.targetId !== targetId || saved.socket !== state.selectedSocket) {
    return null;
  }
  const windowId = Number(saved.windowId);
  return state.flatWindows.some((window) => Number(window.id) === windowId) ? windowId : null;
}

function saveUiPreferences() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      autoRefresh: state.autoRefresh,
      autoFitPane: state.autoFitPane,
      uiFontSizePx: state.uiFontSizePx,
      uiTheme: state.uiTheme,
      screenExtent: state.screenExtent,
      screenExtentExplicit: state.screenExtentExplicit === true,
      mobileTerminalWidth: state.mobileTerminalWidth,
      previewVisible: state.previewVisible,
      previewPinned: state.previewPinned,
      previewUrl: state.previewUrl,
      previewTargetId: state.previewTargetId,
      previewHistory: state.previewHistory,
      previewHistoryIndex: state.previewHistoryIndex,
      resizeEnabled: state.resizeEnabled,
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      sidebarWidth: state.sidebarWidth,
      browserWidth: state.browserWidth,
      bottomPanelHeight: state.bottomPanelHeight,
      bottomPanelPinned: state.bottomPanelPinned
    })
  );
}
