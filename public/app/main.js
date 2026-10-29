// Event wiring and boot.

function attachEvents() {
  bindMobileEvents();
  bindShellEvents();
  bindBrowserEvents();
  bindScreenEvents();
  bindComposerEvents();
  bindTargetsEvents();
  bindSessionsEvents();
  bindViewsEvents();
  bindLayoutsEvents();
  bindLiveEvents();
}

async function bootAuthenticatedWorkspace() {
  await loadTargets();
  renderPaneTree();
  loadLayouts({ adoptActive: true }).catch((error) => setStatus(error.message, "danger"));
  loadReports();
  state.mobileScreen = "connect";
  resetMobileStack("connect");
  if (isMobileViewport()) {
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  if (state.previewVisible && state.previewUrl) {
    await refreshPreviewAccessToken();
    syncPreviewFrame();
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  setTargetHealth("Ready to connect", "neutral");
  restartPolling();
  scheduleMobileAutoConnect({ resetSuppression: true });
}

async function init() {
  window.__KRD_BUILD = CLIENT_BUILD;
  initializeClientDebug();
  loadUiPreferences();
  applyUiState();
  resetMobileStack(state.mobileScreen);
  renderSpecialKeyMenu();
  attachEvents();
  attachWheelContainment();
  loadPaneLayout();
  renderPaneTree();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    await bootAuthenticatedWorkspace();
  } else {
    setAuthStatus("Enter the token for this device.", "neutral");
    elements.authTokenInput.focus();
  }
}

init().catch((error) => {
  setAuthState(false);
  setStatus(error.message, "danger");
  setAuthStatus(error.message, "danger");
  setAuthDeviceMeta(null, "Authentication status check failed. Try again later or enter the token again.");
});
