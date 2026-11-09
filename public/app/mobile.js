// Phone layout: one screen at a time on a history stack; auto-connect to the last target.

function isMobileViewport() {
  return MOBILE_UTILS.isMobileViewport();
}

const MOBILE_NAV_NONCE = Math.random().toString(36).slice(2);

const MOBILE_SCREEN_TITLES = {
  connect: "Connect",
  sessions: "Sessions",
  layouts: "Layouts",
  reports: "Reports",
  chat: "Terminal",
  browser: "Browser"
};

function mobileHistoryEntry(index) {
  return { [MOBILE_HISTORY_KEY]: state.mobileStack[index], krdIndex: index, krdNonce: MOBILE_NAV_NONCE };
}

// Shows a screen without touching the stack or the browser history.
function applyMobileScreen(screen) {
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";
  state.mobileScreen = nextScreen;

  if (isMobileViewport()) {
    if (nextScreen === "browser") {
      state.previewVisible = Boolean(state.previewUrl);
    } else {
      state.previewVisible = false;
      state.previewPinned = false;
    }
    if (nextScreen === "connect") {
      cancelMobileAutoConnect({ suppress: true });
    }
  }

  const sidebarView = MOBILE_SIDEBAR_VIEWS[nextScreen];
  state.sidebarVisible = Boolean(sidebarView);
  if (sidebarView) {
    state.activeSidebarView = sidebarView;
  }
  state.secondaryVisible = nextScreen === "reports";

  applyUiState();
  if (nextScreen === "browser") {
    syncPreviewFrame();
  }
  if (nextScreen === "chat") {
    refreshPaneAfterMobileReturn();
  }
  sendClientDebug(`setMobileScreen:${nextScreen}`, null, { force: true });
}

// Forward navigation: pushes the screen (or unwinds to it when it is already
// on the stack) and mirrors the stack into the browser history, so a swipe
// back and the in-page back buttons agree. history: "replace" swaps the top,
// false shows the screen without recording it.
function setMobileScreen(screen, options = {}) {
  const nextScreen = MOBILE_SCREEN_SET.has(screen) ? screen : "connect";
  if (isMobileViewport() && options.history !== false) {
    const before = state.mobileStack;
    const after = options.history === "replace"
      ? MOBILE_UTILS.replaceTop(before, nextScreen)
      : MOBILE_UTILS.pushScreen(before, nextScreen);
    state.mobileStack = after;
    const top = after.length - 1;
    if (after.length > before.length) {
      history.pushState(mobileHistoryEntry(top), "", window.location.href);
    } else if (after.length === before.length) {
      history.replaceState(mobileHistoryEntry(top), "", window.location.href);
    } else {
      // Unwinding: the entries above are ours, so the history can follow.
      history.go(after.length - before.length);
    }
  }
  applyMobileScreen(nextScreen);
}

// Makes the current history entry the base of a fresh stack.
function resetMobileStack(screen) {
  state.mobileStack = [MOBILE_SCREEN_SET.has(screen) ? screen : "connect"];
  if (isMobileViewport()) {
    history.replaceState(mobileHistoryEntry(0), "", window.location.href);
  }
}

// Every back button pops one screen. The history follows so that a later
// swipe back continues from the same place.
function handleMobileBack() {
  if (!isMobileViewport() || state.mobileStack.length <= 1) {
    applyMobileScreen(state.mobileStack[0]);
    return;
  }
  state.mobileStack = MOBILE_UTILS.popScreen(state.mobileStack);
  applyMobileScreen(state.mobileStack[state.mobileStack.length - 1]);
  history.back();
}

function refreshPaneAfterMobileReturn() {
  if (
    !isMobileViewport() ||
    state.mobileScreen !== "chat" ||
    !state.selectedTargetId ||
    !hasSelectedWindow()
  ) {
    return;
  }

  refreshScreen({
    force: true,
    scrollToBottom: activeExtent() === "all" && state.allTextFollowTail
  }).catch((error) => setStatus(error.message, "danger"));
}

// Swipe back/forward and the hardware back key land here.
function handleMobileHistoryChange(event) {
  if (!isMobileViewport()) {
    return;
  }
  const result = MOBILE_UTILS.stackForHistoryEntry({
    stack: state.mobileStack,
    entry: event.state,
    key: MOBILE_HISTORY_KEY,
    nonce: MOBILE_NAV_NONCE,
    allowedScreens: MOBILE_SCREEN_SET
  });
  state.mobileStack = result.stack;
  if (result.foreign) {
    history.replaceState(mobileHistoryEntry(0), "", window.location.href);
  }
  if (result.screen !== state.mobileScreen) {
    applyMobileScreen(result.screen);
  } else {
    applyUiState();
  }
}

function cancelMobileAutoConnect(options = {}) {
  if (mobileAutoConnectTimer) {
    clearTimeout(mobileAutoConnectTimer);
    mobileAutoConnectTimer = null;
  }

  if (options.suppress) {
    mobileAutoConnectSuppressed = true;
  }
}

function scheduleMobileAutoConnect(options = {}) {
  cancelMobileAutoConnect();

  if (options.resetSuppression) {
    mobileAutoConnectSuppressed = false;
  }

  if (
    mobileAutoConnectSuppressed ||
    !isMobileViewport() ||
    !state.authenticated ||
    !state.selectedTargetId
  ) {
    return;
  }

  mobileAutoConnectTimer = setTimeout(async () => {
    mobileAutoConnectTimer = null;

    if (
      mobileAutoConnectSuppressed ||
      mobileAutoConnectInFlight ||
      !state.authenticated ||
      !state.selectedTargetId ||
      state.mobileScreen !== "connect"
    ) {
      return;
    }

    mobileAutoConnectInFlight = true;
    setStatus("Auto Connect: connecting to the last target...", "neutral");

    try {
      await connectSelectedTarget({ source: "auto" });
    } catch (error) {
      setTargetHealth("Auto Connect failed", "danger");
      setStatus(`Auto Connect failed: ${error.message}`, "danger");
    } finally {
      mobileAutoConnectInFlight = false;
    }
  }, MOBILE_AUTO_CONNECT_DELAY_MS);
}

function applyMobileBackLabels() {
  if (!isMobileViewport()) {
    return;
  }
  const stack = state.mobileStack;
  const below = stack.length > 1 ? stack[stack.length - 2] : null;
  Object.entries(MOBILE_BACK_BUTTONS).forEach(([screen, id]) => {
    const button = elements[id];
    if (!button) {
      return;
    }
    if (screen === state.mobileScreen) {
      button.textContent = `‹ ${MOBILE_SCREEN_TITLES[below] || "Back"}`;
    }
  });
}

function bindMobileEvents() {
  elements.mobileBackToConnectBtn.addEventListener("click", () => {
    handleMobileBack("connect");
  });

  elements.mobileBackToSessionsBtn.addEventListener("click", () => {
    handleMobileBack("sessions");
  });

  elements.mobileTerminalWidthBtn.addEventListener("click", () => {
    state.mobileTerminalWidth = state.mobileTerminalWidth === "wide" ? "fit" : "wide";
    applyUiState();
  });

  window.addEventListener("popstate", handleMobileHistoryChange);
}
