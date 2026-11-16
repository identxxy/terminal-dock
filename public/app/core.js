// Constants, state, DOM handles and the helpers every other app/*.js file uses.
// app/*.js are classic scripts sharing one global scope; index.html loads them in order and main.js runs init().

const STORAGE_KEY = "kitty-remote-deck-ui";

const DEBUG_STORAGE_KEY = "kitty-remote-deck-debug";

// The ?v= cache key index.html loads this file with; reported by ?debug=1 snapshots.
const CLIENT_BUILD = (document.currentScript?.src.match(/[?&]v=([^&]+)/) || [])[1] || "dev";

const MOBILE_HISTORY_KEY = "krdMobileScreen";

const LAST_PANE_STORAGE_KEY = "kitty-remote-deck-last-pane";

const PANE_ORDER_STORAGE_KEY = "terminal-dock-pane-order";

const FONT_SIZE_RANGE = { min: 5, max: 18, default: 13 };

const THEME_SET = new Set(["dark", "graphite", "nord", "mocha", "tokyo", "gruvbox", "rosepine", "cyberpunk-dark", "light", "latte", "solarized", "cyberpunk-light"]);

const TEXT_EXTENT_SET = new Set(["screen", "all"]);

const MOBILE_TERMINAL_WIDTH_SET = new Set(["fit", "wide"]);

const MOBILE_SCREEN_SET = new Set(["connect", "sessions", "layouts", "reports", "chat", "browser"]);

const SIDEBAR_WIDTH_RANGE = { min: 220, max: 520 };

// The right sidebar (Browser list and input History).
const SECONDARY_WIDTH_RANGE = { min: 200, max: 520, default: 300 };

const SECONDARY_TAB_SET = new Set(["browser", "history"]);

// The chat composer grows with its text up to this height.
const PANEL_HEIGHT_RANGE = { min: 80, max: 420, default: 160 };

// No fixed pixel cap: the drawer may take up to maxFraction of the viewport, minus the terminal minimum.
const BROWSER_WIDTH_RANGE = { min: 320, maxFraction: 0.7, default: 560 };

// Adaptive polling: refresh fast while the pane is changing or just received input,
// then back off as it goes quiet. Polling pauses while the page is hidden.
const POLL_ACTIVE_MS = 700;

const POLL_WARM_MS = 1500;

const POLL_IDLE_MS = 4000;

const POLL_ACTIVE_WINDOW_MS = 15000;

const POLL_WARM_WINDOW_MS = 60000;

const SESSION_TREE_REFRESH_MS = 15000;

const ALL_TEXT_AUTO_REFRESH_MS = 15000;

const WHEEL_SCROLL_DEBOUNCE_MS = 70;

const WHEEL_SCROLL_MAX_LINES = 80;

const TOUCH_SCROLL_LINE_PX = 42;

const TOUCH_SCROLL_SENSITIVITY = 5;

const LOCAL_SCROLL_BOUNDARY_EPSILON = 2;

const MOBILE_AUTO_CONNECT_DELAY_MS = 1000;

const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const MAX_VIDEO_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const MAX_ATTACHMENT_COUNT = 10;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif"
]);

const SUPPORTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-m4v"
]);

const BROWSER_UTILS = window.KRDBrowserUtils;

const MOBILE_UTILS = window.KRDMobileUtils;

const PREVIEW_HISTORY = window.KRDPreviewHistory;

const COMPOSER_UTILS = window.KRDComposerUtils;
const INPUT_HISTORY_UTILS = window.KRDInputHistory;

const PANE_ORDER_UTILS = window.KRDPaneOrder;

const COMPOSER_PLACEHOLDER = "Enter sends · Shift+Enter newline · Alt+Enter sends without ⏎";

const PANE_TREE = window.KRDPaneTree;

const RESIZE_UTILS = window.KRDResizeUtils;

const LAYOUT_UTILS = window.KRDLayoutUtils;

const TERMINAL_LINES = window.KRDTerminalLines;

const PANE_FIT = window.KRDPaneFit;

const PANE_LAYOUT_STORAGE_KEY = "kitty-remote-deck.paneLayout.v1";

const SECONDARY_VIEW_POLL_MS = 2000;

// With a live tmux event stream, polling is only a safety net.
const LIVE_POLL_MS = 15000;

const LIVE_MIN_GAP_MS = { screen: 120, all: 600 };

const LIVE_RESUBSCRIBE_DEBOUNCE_MS = 150;

const LIVE_RECONNECT_MAX_MS = 60000;

const ANSI_UTILS = window.KRDAnsiUtils;

const DEFAULT_TARGET_FORM = {
  name: "Local Kitty",
  transport: "local",
  backend: "kitty",
  sshTarget: "",
  kittyBinary: "kitty",
  tmuxBinary: "tmux",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: ""
};

// The session tree keeps kitty's shape for every backend; only the names differ.
// tmux: session -> OS window, window -> tab, pane -> pane. `features` is what
// the UI shows for a backend; which helper actions a backend implements is the
// server's business (server/backend_contract.js). A new backend adds an entry
// here and an <option> in index.html.
const BACKEND_FEATURES = {
  kitty: { flatPanes: false, nestedCreate: true, closeSession: false, closeVerb: "Close", paneResize: false, zoom: false, live: false },
  tmux: { flatPanes: true, nestedCreate: false, closeSession: true, closeVerb: "Kill", paneResize: true, zoom: true, live: true },
  mock: { flatPanes: true, nestedCreate: false, closeSession: true, closeVerb: "Kill", paneResize: true, zoom: true, live: false }
};

const BACKEND_DEFAULTS = {
  kitty: {
    socketPattern: "/tmp/kitty.sock-*",
    socketPlaceholder: "/tmp/kitty.sock-*",
    defaultSocketPlaceholder: "/tmp/kitty.sock-11305",
    sectionTitle: "Kitty Remote Control",
    sectionHint: "kitty @",
    labels: {
      osWindow: "OS Window",
      tab: "Tab",
      window: "Pane",
      createWindow: "New Window",
      createTab: "New Tab",
      createSplit: "New Split"
    }
  },
  tmux: {
    socketPattern: "",
    socketPlaceholder: "auto: $TMUX_TMPDIR/tmux-UID/*",
    defaultSocketPlaceholder: "/tmp/tmux-1000/default",
    sectionTitle: "tmux Server",
    sectionHint: "tmux -S",
    labels: {
      osWindow: "Session",
      tab: "Window",
      window: "Pane",
      createWindow: "New Session",
      createTab: "New Window",
      createSplit: "New Split"
    }
  },
  mock: {
    socketPattern: "",
    socketPlaceholder: "ignored",
    defaultSocketPlaceholder: "ignored",
    sectionTitle: "Mock Backend",
    sectionHint: "canned data, no terminal",
    labels: {
      osWindow: "Session",
      tab: "Window",
      window: "Pane",
      createWindow: "New Session",
      createTab: "New Window",
      createSplit: "New Split"
    }
  }
};

const state = {
  authenticated: false,
  authDevice: null,
  targets: [],
  selectedTargetId: "",
  editingTargetId: "",
  selectedSocket: "",
  sessionTree: [],
  flatWindows: [],
  sessionLabels: BACKEND_DEFAULTS.kitty.labels,
  sessionBackend: "kitty",
  selectedWindowId: null,
  screenText: "",
  autoRefresh: true,
  refreshing: false,
  activeSidebarView: "ssh",
  sidebarVisible: true,
  uiFontSizePx: FONT_SIZE_RANGE.default,
  uiTheme: "dark",
  screenExtent: "all",
  screenExtentExplicit: false,
  autoFitPane: true,
  // Browser-side view splits (see modules/pane-tree.js). The active leaf is the
  // view that the single-selection state below describes.
  paneRoot: null,
  activePaneId: null,
  // Saved layouts from the server. activeLayoutId names the one on screen;
  // null means Scratch, this device's unsaved layout. While a named layout is
  // active, scratchLayout keeps Scratch so it can be brought back, and
  // activeLayoutSaved is the serialized form last written to the server.
  layouts: [],
  activeLayoutId: null,
  activeLayoutSaved: "",
  scratchLayout: null,
  // Pages opened in the embedded Browser, listed server-side (data/reports.json).
  reports: [],
  // The target the Browser fetches through; a report can name another target
  // than the one the terminal is connected to.
  previewTargetId: "",
  allTextFollowTail: true,
  previewVisible: false,
  previewPinned: false,
  previewUrl: "",
  previewHistory: [],
  previewHistoryIndex: -1,
  previewAccessToken: "",
  previewAccessExpiresAt: "",
  mobileScreen: "connect",
  // Phone screens as a stack: the top is mobileScreen, "back" pops.
  mobileStack: ["connect"],
  mobileTerminalWidth: "fit",
  resizeEnabled: false,
  sidebarWidth: 320,
  browserWidth: BROWSER_WIDTH_RANGE.default,
  bottomPanelHeight: PANEL_HEIGHT_RANGE.default,
  // Set by dragging the panel edge: the composer then keeps that height instead of growing with its text.
  bottomPanelPinned: false,
  imageAttachments: [],
  composerSending: false,
  // Live keys: keydowns in the composer go to the pane as they happen (session only, never persisted).
  liveKeys: false,
  sessionCreating: false,
  // Per-pane input history fetched from the server (see app/history.js), and
  // the dragged order of the Sessions cards, per target (see app/session-drag.js).
  inputHistory: {},
  paneOrder: {},
  // The right sidebar: open or not, which tab (Browser list or History) shows, and its width.
  secondaryVisible: true,
  secondaryTab: "history",
  secondaryWidth: SECONDARY_WIDTH_RANGE.default
};

// Every view slot owns one output element for its whole life. Activating a view
// only changes which element the selection, composer and sidebar act on; nothing
// moves in the DOM, so scroll positions and layout stay put.
const originalScreenOutput = document.querySelector("#screenOutput");

let activeOutput = originalScreenOutput;

let outputResizeObserver = null;

const elements = {
  appShell: document.querySelector("#appShell"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authTokenInput: document.querySelector("#authTokenInput"),
  authStatusText: document.querySelector("#authStatusText"),
  authDeviceMeta: document.querySelector("#authDeviceMeta"),
  authToast: document.querySelector("#authToast"),
  authDeviceLabel: document.querySelector("#authDeviceLabel"),
  logoutBtn: document.querySelector("#logoutBtn"),
  showSshViewBtn: document.querySelector("#showSshViewBtn"),
  showSessionsViewBtn: document.querySelector("#showSessionsViewBtn"),
  showLayoutsViewBtn: document.querySelector("#showLayoutsViewBtn"),
  showBrowserViewBtn: document.querySelector("#showBrowserViewBtn"),
  browserSidebarView: document.querySelector("#browserSidebarView"),
  mobileBackFromBrowserListBtn: document.querySelector("#mobileBackFromBrowserListBtn"),
  mobileBrowserListBtn: document.querySelector("#mobileBrowserListBtn"),
  mobileReportsBtn: document.querySelector("#mobileReportsBtn"),
  reloadReportsBtn: document.querySelector("#reloadReportsBtn"),
  reportOpenForm: document.querySelector("#reportOpenForm"),
  reportUrlInput: document.querySelector("#reportUrlInput"),
  reportSummary: document.querySelector("#reportSummary"),
  reportList: document.querySelector("#reportList"),
  primarySidebar: document.querySelector("#primarySidebar"),
  sshSidebarView: document.querySelector("#sshSidebarView"),
  sessionsSidebarView: document.querySelector("#sessionsSidebarView"),
  layoutsSidebarView: document.querySelector("#layoutsSidebarView"),
  saveLayoutBtn: document.querySelector("#saveLayoutBtn"),
  mobileLayoutsBtn: document.querySelector("#mobileLayoutsBtn"),
  mobileBackFromLayoutsBtn: document.querySelector("#mobileBackFromLayoutsBtn"),
  reloadLayoutsBtn: document.querySelector("#reloadLayoutsBtn"),
  layoutSaveForm: document.querySelector("#layoutSaveForm"),
  layoutNameInput: document.querySelector("#layoutNameInput"),
  layoutSummary: document.querySelector("#layoutSummary"),
  layoutList: document.querySelector("#layoutList"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  panelResizeHandle: document.querySelector("#panelResizeHandle"),
  browserResizeHandle: document.querySelector("#browserResizeHandle"),
  targetForm: document.querySelector("#targetForm"),
  reloadTargetsBtn: document.querySelector("#reloadTargetsBtn"),
  reloadSessionsBtn: document.querySelector("#reloadSessionsBtn"),
  reloadSessionTreeBtn: document.querySelector("#reloadSessionTreeBtn"),
  saveTargetBtn: document.querySelector("#saveTargetBtn"),
  testTargetBtn: document.querySelector("#testTargetBtn"),
  connectTargetBtn: document.querySelector("#connectTargetBtn"),
  newTargetBtn: document.querySelector("#newTargetBtn"),
  decreaseFontBtn: document.querySelector("#decreaseFontBtn"),
  increaseFontBtn: document.querySelector("#increaseFontBtn"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  themeSelect: document.querySelector("#themeSelect"),
  themeSelectMobile: document.querySelector("#themeSelectMobile"),
  decreaseFontBtnMobile: document.querySelector("#decreaseFontBtnMobile"),
  increaseFontBtnMobile: document.querySelector("#increaseFontBtnMobile"),
  fontSizeValueMobile: document.querySelector("#fontSizeValueMobile"),
  resizeToggle: document.querySelector("#resizeToggle"),
  resizeLabel: document.querySelector("#resizeLabel"),
  targetHealth: document.querySelector("#targetHealth"),
  targetStatus: document.querySelector("#targetStatus"),
  savedTargets: document.querySelector("#savedTargets"),
  targetSelect: document.querySelector("#targetSelect"),
  targetTransport: document.querySelector("#targetTransport"),
  socketSelect: document.querySelector("#socketSelect"),
  sessionSummary: document.querySelector("#sessionSummary"),
  sessionTree: document.querySelector("#sessionTree"),
  mobilePaneSwitcher: document.querySelector("#mobilePaneSwitcher"),
  mobileBackToConnectBtn: document.querySelector("#mobileBackToConnectBtn"),
  mobileBackToSessionsBtn: document.querySelector("#mobileBackToSessionsBtn"),
  mobileConnectTargetBtn: document.querySelector("#mobileConnectTargetBtn"),
  mobileTerminalWidthBtn: document.querySelector("#mobileTerminalWidthBtn"),
  editorPane: document.querySelector("#editorPane"),
  viewerMeta: document.querySelector("#viewerMeta"),
  get screenOutput() {
    return activeOutput;
  },
  latestOutputBtn: document.querySelector("#latestOutputBtn"),
  bottomPanel: document.querySelector("#bottomPanel"),
  previewDrawer: document.querySelector("#previewDrawer"),
  browserHandleBtn: document.querySelector("#browserHandleBtn"),
  browserHandleLabel: document.querySelector("#browserHandleLabel"),
  previewTitle: document.querySelector("#previewTitle"),
  previewAddress: document.querySelector("#previewAddress"),
  browserAddressForm: document.querySelector("#browserAddressForm"),
  browserAddressInput: document.querySelector("#browserAddressInput"),
  browserBackBtn: document.querySelector("#browserBackBtn"),
  browserForwardBtn: document.querySelector("#browserForwardBtn"),
  browserHistorySelect: document.querySelector("#browserHistorySelect"),
  browserGoBtn: document.querySelector("#browserGoBtn"),
  downloadPreviewBtn: document.querySelector("#downloadPreviewBtn"),
  pinBrowserBtn: document.querySelector("#pinBrowserBtn"),
  mobileBrowserBackBtn: document.querySelector("#mobileBrowserBackBtn"),
  closePreviewBtn: document.querySelector("#closePreviewBtn"),
  urlPreviewFrame: document.querySelector("#urlPreviewFrame"),
  screenModeBtn: document.querySelector("#screenModeBtn"),
  allTextModeBtn: document.querySelector("#allTextModeBtn"),
  editorMenu: document.querySelector("#editorMenu"),
  editorMenuBtn: document.querySelector("#editorMenuBtn"),
  editorMenuPopover: document.querySelector("#editorMenuPopover"),
  autoFitToggle: document.querySelector("#autoFitToggle"),
  secondarySidebar: document.querySelector("#secondarySidebar"),
  secondaryResizeHandle: document.querySelector("#secondaryResizeHandle"),
  secondaryTabs: document.querySelector("#secondaryTabs"),
  secondaryCloseBtn: document.querySelector("#secondaryCloseBtn"),
  historySidebarView: document.querySelector("#historySidebarView"),
  historyRailList: document.querySelector("#historyRailList"),
  historyRailCount: document.querySelector("#historyRailCount"),
  historyRailClearBtn: document.querySelector("#historyRailClearBtn"),
  historyRailBtn: document.querySelector("#historyRailBtn"),
  fitPaneBtn: document.querySelector("#fitPaneBtn"),
  hostStats: document.querySelector("#hostStats"),
  sessionsHostStats: document.querySelector("#sessionsHostStats"),
  zoomPaneBtn: document.querySelector("#zoomPaneBtn"),
  paneTree: document.querySelector("#paneTree"),
  splitRightBtn: document.querySelector("#splitRightBtn"),
  splitDownBtn: document.querySelector("#splitDownBtn"),
  sendRawTextBtn: document.querySelector("#sendRawTextBtn"),
  liveKeysToggle: document.querySelector("#liveKeysToggle"),
  sendTextBtn: document.querySelector("#sendTextBtn"),
  specialKeyMenu: document.querySelector("#specialKeyMenu"),
  specialKeyMenuBtn: document.querySelector("#specialKeyMenuBtn"),
  specialKeyMenuPopover: document.querySelector("#specialKeyMenuPopover"),
  sendForm: document.querySelector("#sendForm"),
  sendTextInput: document.querySelector("#sendTextInput"),
  composerStack: document.querySelector("#composerStack"),
  attachImageBtn: document.querySelector("#attachImageBtn"),
  imageInput: document.querySelector("#imageInput"),
  imageAttachment: document.querySelector("#imageAttachment"),
  uploadQueue: document.querySelector("#uploadQueue"),
  statusTargetName: document.querySelector("#statusTargetName"),
  statusSocketName: document.querySelector("#statusSocketName"),
  statusMessage: document.querySelector("#statusMessage"),
  statusPaneName: document.querySelector("#statusPaneName"),
  statusAutoRefresh: document.querySelector("#statusAutoRefresh"),
  targetName: document.querySelector("#targetName"),
  targetSsh: document.querySelector("#targetSsh"),
  targetBackend: document.querySelector("#targetBackend"),
  targetBackendSectionTitle: document.querySelector("#targetBackendSectionTitle"),
  targetBackendSectionHint: document.querySelector("#targetBackendSectionHint"),
  targetKittyBinary: document.querySelector("#targetKittyBinary"),
  targetKittyBinaryField: document.querySelector("#targetKittyBinaryField"),
  targetTmuxBinary: document.querySelector("#targetTmuxBinary"),
  targetTmuxBinaryField: document.querySelector("#targetTmuxBinaryField"),
  targetSocketPattern: document.querySelector("#targetSocketPattern"),
  targetDefaultSocket: document.querySelector("#targetDefaultSocket"),
  targetNotes: document.querySelector("#targetNotes")
};

let pollTimer = null;

let resizeSession = null;

let pendingScrollLines = 0;

let scrollFlushTimer = null;

let remoteScrollInFlight = false;

let screenTouchScroll = null;

let screenRequestSerial = 0;

let screenAbortController = null;

let sessionRequestSerial = 0;

let pollGeneration = 0;

let pollInFlight = false;

// True after Screen-mode scrolling moves the kitty viewport into history.
let viewportScrolledBack = false;

let lastScreenActivityAt = 0;

let lastTreeRefreshAt = 0;

let lastAllTextRefreshAt = 0;

// Hash of the screen currently rendered, so polls can ask the server for "unchanged".
let renderedScreen = { key: "", hash: "", text: null, data: null };

// Recently shown panes, keyed like renderedScreen: switching back repaints the
// last snapshot at once and asks the server only for what changed since.
const SCREEN_CACHE_LIMIT = 8;

const screenCache = new Map();

function screenKeyFor(targetId, socket, windowId, extent) {
  return `${targetId}|${socket || ""}|${windowId}|${extent}`;
}

function rememberScreen(entry) {
  if (!entry.key || typeof entry.text !== "string" || !entry.data) {
    return;
  }
  const isNew = !screenCache.has(entry.key);
  screenCache.delete(entry.key);
  screenCache.set(entry.key, entry);
  while (screenCache.size > SCREEN_CACHE_LIMIT) {
    screenCache.delete(screenCache.keys().next().value);
  }
  if (isNew && state.flatWindows.length) {
    renderSessions();
  }
}

function isPaneCached(windowId) {
  return ["all", "screen"].some((extent) => screenCache.has(screenKeyFor(state.selectedTargetId, state.selectedSocket, Number(windowId), extent)));
}

// Before leaving a pane, keep its snapshot plus where the user had scrolled.
function stashRenderedScreen() {
  if (!renderedScreen.key || elements.screenOutput.getAttribute("aria-busy") === "true" || renderedScreen.text !== state.screenText) {
    return;
  }
  rememberScreen({
    ...renderedScreen,
    scrollTop: elements.screenOutput.scrollTop,
    followTail: state.allTextFollowTail
  });
}

// Repaint a cached snapshot for the pane being selected; false when none.
function restoreCachedScreen(windowId) {
  const key = screenKeyFor(state.selectedTargetId, state.selectedSocket, windowId, activeExtent());
  const entry = screenCache.get(key);
  if (!entry) {
    return false;
  }
  renderedScreen = { key: entry.key, hash: entry.hash, text: entry.text, data: entry.data };
  if (activeExtent() === "all") {
    state.allTextFollowTail = entry.followTail !== false;
  }
  renderScreenData(entry.data, { scrollToBottom: activeExtent() === "all" && state.allTextFollowTail });
  if (!(activeExtent() === "all" && state.allTextFollowTail)) {
    elements.screenOutput.scrollTop = entry.scrollTop || 0;
  }
  return true;
}

// Pane id -> text last drawn into the tmux window layout (see renderWindowLayout).
function paneTextsFor(output) {
  if (!output.__paneTexts) {
    output.__paneTexts = new Map();
  }
  return output.__paneTexts;
}

let sessionPointerStart = null;

let suppressSessionClickUntil = 0;

let clientDebugEnabled = false;

let clientDebugTimer = null;

let lastClientDebugAt = 0;

let authToastTimer = null;

let mobileAutoConnectTimer = null;

let mobileAutoConnectSuppressed = false;

let mobileAutoConnectInFlight = false;

function getSelectedTarget() {
  return state.targets.find((target) => target.id === state.selectedTargetId) || null;
}

function selectedPane() {
  return state.flatWindows.find((window) => Number(window.id) === Number(state.selectedWindowId)) || null;
}

// Alternate-screen apps (Claude Code fullscreen, vim) keep no scrollback, so the
// All view would only show stale shell history. Such panes always use the
// viewport semantics, and scroll gestures become the app's PgUp/PgDn keys.
function activeExtent() {
  return selectedPane()?.alternate_on ? "screen" : state.screenExtent;
}

// tmux pane ids start at %0, so the selection must not be tested for truthiness.
function hasSelectedWindow() {
  return state.selectedWindowId !== null && state.selectedWindowId !== undefined && state.selectedWindowId !== "";
}

function normalizeBackend(value) {
  return BACKEND_DEFAULTS[value] ? value : "kitty";
}

function backendFeature(name, backend = state.sessionBackend) {
  return BACKEND_FEATURES[normalizeBackend(backend)][name];
}

function getBackendDefaults(backend) {
  return BACKEND_DEFAULTS[normalizeBackend(backend)];
}

function labelsForTarget(target) {
  return getBackendDefaults(target?.backend).labels;
}

function describePaneLocation(pane) {
  const labels = state.sessionLabels;
  const osWindowName = pane.osWindowTitle || `#${pane.osWindowId}`;
  const tabName = pane.osWindowTitle ? pane.tabTitle || `#${pane.tabId}` : `#${pane.tabId}`;
  return `${labels.osWindow} ${osWindowName} / ${labels.tab} ${tabName} / #${pane.id}`;
}

function getEditingTarget() {
  return state.targets.find((target) => target.id === state.editingTargetId) || null;
}

function captureSelectedPane() {
  return {
    targetId: state.selectedTargetId,
    socket: state.selectedSocket,
    windowId: state.selectedWindowId
  };
}

function isPaneStillSelected(pane) {
  return (
    pane.targetId === state.selectedTargetId &&
    pane.socket === state.selectedSocket &&
    Number(pane.windowId) === Number(state.selectedWindowId)
  );
}

function invalidateScreenRequests() {
  screenRequestSerial += 1;
  if (screenAbortController) {
    screenAbortController.abort();
    screenAbortController = null;
  }
  state.refreshing = false;
}

function invalidateSessionRequests() {
  sessionRequestSerial += 1;
  invalidateScreenRequests();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message, mode) {
  elements.targetStatus.textContent = message;
  elements.targetStatus.dataset.mode = mode || "neutral";
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.mode = mode || "neutral";
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    setAuthState(false);
    setAuthStatus("Sign-in expired. Enter this device's token again.", "danger");
    throw new Error(payload.error || "Authentication required.");
  }

  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function escapeHtml(text) {
  return BROWSER_UTILS.escapeHtml(text);
}

function escapeAttribute(text) {
  return BROWSER_UTILS.escapeAttribute(text);
}
