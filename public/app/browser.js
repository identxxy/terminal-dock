// Embedded Browser drawer (proxied previews, history, handle) and the Reports list.

function truncateLabel(value, maxLength = 84) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function renderBrowserHistoryOptions() {
  const items = state.previewHistory.map((url, index) => {
    const prefix = index === state.previewHistoryIndex ? "Current" : `${index + 1}`;
    return `<option value="${index}">${escapeHtml(`${prefix} · ${truncateLabel(url)}`)}</option>`;
  });

  elements.browserHistorySelect.innerHTML = [
    `<option value="">History</option>`,
    ...items
  ].join("");
  elements.browserHistorySelect.value = state.previewHistoryIndex >= 0
    ? String(state.previewHistoryIndex)
    : "";
  elements.browserHistorySelect.disabled = state.previewHistory.length === 0;
}

// The right-edge tab shows while a Browser page exists but the drawer is
// hidden; on a phone only on the terminal screen.
function applyBrowserHandle() {
  const visible = Boolean(state.previewUrl) && !state.previewVisible && (!isMobileViewport() || state.mobileScreen === "chat");
  elements.browserHandleBtn.hidden = !visible;
  if (!visible) {
    return;
  }
  const label = browserHandleLabel();
  elements.browserHandleLabel.textContent = label;
  elements.browserHandleBtn.title = label;
  elements.browserHandleBtn.setAttribute("aria-label", `Open Browser: ${label}`);
}

function browserHandleLabel() {
  const report = state.reports.find((item) => item.url === state.previewUrl && (!state.previewTargetId || item.targetId === state.previewTargetId));
  return reportLabel(report || { url: state.previewUrl });
}

// Tap or a leftward swipe opens the Browser; the tab follows the finger first.
let browserHandleGesture = null;

function resetBrowserHandleGesture() {
  browserHandleGesture = null;
  elements.browserHandleBtn.classList.remove("dragging");
  elements.browserHandleBtn.style.transform = "";
}

function attachBrowserHandle() {
  const button = elements.browserHandleBtn;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    browserHandleGesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    button.classList.add("dragging");
    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      // No capture: the swipe still works while the pointer stays on the tab.
    }
  });
  button.addEventListener("pointermove", (event) => {
    if (!browserHandleGesture || event.pointerId !== browserHandleGesture.id) {
      return;
    }
    const dx = clamp(event.clientX - browserHandleGesture.startX, -56, 0);
    if (dx < -8) {
      browserHandleGesture.moved = true;
    }
    button.style.transform = `translate(${dx}px, -50%)`;
  });
  button.addEventListener("pointerup", (event) => {
    if (!browserHandleGesture || event.pointerId !== browserHandleGesture.id) {
      return;
    }
    const dx = event.clientX - browserHandleGesture.startX;
    const dy = Math.abs(event.clientY - browserHandleGesture.startY);
    const tap = !browserHandleGesture.moved && dy < 16;
    resetBrowserHandleGesture();
    if (tap || dx <= -24) {
      reopenPreview().catch((error) => setStatus(error.message, "danger"));
    }
  });
  button.addEventListener("pointercancel", resetBrowserHandleGesture);
  // Keyboard activation arrives as a click without pointer events.
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      reopenPreview().catch((error) => setStatus(error.message, "danger"));
    }
  });
}

function setPreviewStatus(message, mode) {
  elements.previewAddress.textContent = message;
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.mode = mode || "neutral";
}

function createPreviewResourceUrl(url, targetId) {
  return BROWSER_UTILS.createPreviewResourceUrl(url, targetId, state.previewAccessToken);
}

function normalizeBrowserUrl(rawUrl) {
  return BROWSER_UTILS.normalizeBrowserUrl(rawUrl);
}

function getPreviewHistoryState() {
  return PREVIEW_HISTORY.createState(state.previewHistory, state.previewHistoryIndex, state.previewUrl);
}

function applyPreviewHistoryState(nextState) {
  if (!nextState) {
    return false;
  }

  state.previewHistory = nextState.items;
  state.previewHistoryIndex = nextState.index;
  state.previewUrl = nextState.url;
  return true;
}

function rememberPreviewUrl(url, mode = "push") {
  applyPreviewHistoryState(PREVIEW_HISTORY.remember(getPreviewHistoryState(), url, mode));
}

function replaceLoadedPreviewUrl(url) {
  applyPreviewHistoryState(PREVIEW_HISTORY.replaceLoaded(getPreviewHistoryState(), url));
}

// The target the Browser reads through: the report's own target when one was
// opened from the list, otherwise the connected target.
function getPreviewTarget() {
  return state.targets.find((target) => target.id === state.previewTargetId) || getSelectedTarget();
}

async function refreshPreviewAccessToken() {
  const target = getPreviewTarget();
  if (!target || !state.previewUrl) {
    state.previewAccessToken = "";
    state.previewAccessExpiresAt = "";
    return false;
  }
  state.previewTargetId = target.id;

  const params = new URLSearchParams({
    targetId: target.id,
    url: state.previewUrl
  });
  const data = await apiFetch(`/api/url-access-token?${params.toString()}`);
  state.previewAccessToken = data.accessToken || "";
  state.previewAccessExpiresAt = data.expiresAt || "";
  return Boolean(state.previewAccessToken);
}

function syncPreviewFrame() {
  const target = getPreviewTarget();
  if (!target || !state.previewUrl) {
    return false;
  }

  const nextSrc = createPreviewResourceUrl(state.previewUrl, target.id);
  elements.previewTitle.textContent = target.name ? `${target.name} Browser` : "Browser";
  elements.previewAddress.textContent = state.previewUrl;
  if (elements.urlPreviewFrame.dataset.src !== nextSrc) {
    elements.urlPreviewFrame.dataset.src = nextSrc;
    // location.replace keeps the frame out of the browser's history, so a
    // swipe back on the phone pops a deck screen instead of a frame page.
    try {
      elements.urlPreviewFrame.contentWindow.location.replace(nextSrc);
    } catch (error) {
      elements.urlPreviewFrame.src = nextSrc;
    }
  }
  return true;
}

function closePreview() {
  state.previewVisible = false;
  if (isMobileViewport() && state.mobileScreen === "browser") {
    handleMobileBack();
    return;
  }
  applyUiState();
  refreshPaneAfterMobileReturn();
}

// Save the page in the address bar as the target serves it: the server skips
// the proxy rewriting and answers with an attachment disposition, so the
// viewer's browser downloads the original file.
async function downloadPreview() {
  const target = getPreviewTarget();
  if (!target || !state.previewUrl) {
    setPreviewStatus("No Browser page to download yet.", "neutral");
    return;
  }
  await refreshPreviewAccessToken();
  const params = new URLSearchParams({
    targetId: target.id,
    url: state.previewUrl,
    access: state.previewAccessToken,
    download: "1"
  });
  const link = document.createElement("a");
  link.href = `/api/url-resource?${params.toString()}`;
  link.download = "";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setPreviewStatus(`Downloading ${state.previewUrl}`, "neutral");
}

function toggleBrowserPin() {
  state.previewPinned = !state.previewPinned;
  if (state.previewPinned && state.previewUrl) {
    state.previewVisible = true;
  }
  applyUiState();
}

async function reopenPreview() {
  if (!state.previewUrl) {
    setPreviewStatus("No Browser URL yet.", "neutral");
    return;
  }

  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function goBackPreview() {
  const nextHistory = PREVIEW_HISTORY.goBack(getPreviewHistoryState());
  if (!nextHistory) {
    closePreview();
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function goForwardPreview() {
  const nextHistory = PREVIEW_HISTORY.goForward(getPreviewHistoryState());
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function jumpPreviewHistory(index) {
  const nextHistory = PREVIEW_HISTORY.jump(getPreviewHistoryState(), index);
  if (!nextHistory) {
    return;
  }

  applyPreviewHistoryState(nextHistory);
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  if (isMobileViewport() && state.mobileScreen === "chat") {
    setMobileScreen("browser");
    return;
  }
  applyUiState();
}

async function loadUrlPreview(rawUrl, options = {}) {
  const target = options.targetId
    ? state.targets.find((item) => item.id === options.targetId) || null
    : getSelectedTarget();

  if (!target) {
    setPreviewStatus("Choose a connection target first.", "warning");
    return;
  }

  const url = normalizeBrowserUrl(rawUrl);

  state.previewTargetId = target.id;
  rememberPreviewUrl(url, options.history || "push");
  state.previewVisible = true;
  await refreshPreviewAccessToken();
  syncPreviewFrame();
  renderReports();
  // On a phone the Browser is its own screen, reached from the terminal or
  // from the Reports list.
  if (isMobileViewport() && state.mobileScreen !== "browser") {
    setMobileScreen("browser");
    setPreviewStatus(`Opening ${url} through ${target.name}...`, "neutral");
    return;
  }
  applyUiState();
  setPreviewStatus(`Opening ${url} through ${target.name}...`, "neutral");
}

function maybeCloseUnpinnedBrowser(event) {
  if (!state.previewVisible || state.previewPinned) {
    return;
  }

  const path = event.composedPath ? event.composedPath() : [];
  if (
    path.includes(elements.previewDrawer) ||
    path.includes(elements.showBrowserViewBtn) ||
    (path.includes(elements.secondarySidebar) && !path.includes(elements.historySidebarView))
  ) {
    // The Browser list and the right sidebar's tabs belong to the Browser; a
    // tap in the History list means the transcript is wanted.
    return;
  }

  state.previewVisible = false;
  if (isMobileViewport() && state.mobileScreen === "browser") {
    handleMobileBack();
    return;
  }
  applyUiState();
  refreshPaneAfterMobileReturn();
}

function handleBrowserMessage(event) {
  if (event.source !== elements.urlPreviewFrame.contentWindow) {
    return;
  }

  const message = event.data || {};
  if (message.source !== "kitty-remote-deck-browser") {
    return;
  }

  if (message.targetId && message.targetId !== state.previewTargetId) {
    return;
  }

  if (message.type === "browser:navigate") {
    loadUrlPreview(message.url, { targetId: state.previewTargetId }).catch((error) => setPreviewStatus(error.message, "danger"));
    return;
  }

  if (message.type === "browser:loaded") {
    try {
      const url = normalizeBrowserUrl(message.url);
      replaceLoadedPreviewUrl(url);
      setPreviewStatus(`Loaded ${url}`, "neutral");
      applyUiState();
      recordReport(url, message.title).catch(() => {});
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
    return;
  }

  if (message.type === "browser:title" && message.title) {
    try {
      recordReport(normalizeBrowserUrl(message.url), message.title).catch(() => {});
    } catch (error) {
      // Not a listable URL.
    }
  }
}

// Reports: the Browser's own list, kept on the server like layouts.
const reportTitles = new Map();

async function loadReports() {
  try {
    const data = await apiFetch("/api/reports");
    state.reports = Array.isArray(data.reports) ? data.reports : [];
  } catch (error) {
    state.reports = [];
    elements.reportSummary.textContent = `Reports unavailable: ${error.message}`;
  }
  renderReports();
}

async function recordReport(url, title = "") {
  const targetId = state.previewTargetId || state.selectedTargetId;
  if (!targetId || !url) {
    return;
  }
  const key = `${targetId} ${url}`;
  const cleanTitle = String(title || "").trim();
  if (cleanTitle && reportTitles.get(key) === cleanTitle) {
    return;
  }
  if (cleanTitle) {
    reportTitles.set(key, cleanTitle);
  }
  await apiFetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, url, title: cleanTitle })
  });
  await loadReports();
}

function describeReport(report) {
  const target = state.targets.find((item) => item.id === report.targetId);
  return `${target ? target.name : report.targetId} · ${report.url}`;
}

function reportLabel(report) {
  if (report.title) {
    return report.title;
  }
  try {
    const parsed = new URL(report.url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) + (parsed.pathname.endsWith("/") ? "/" : "") : parsed.host || report.url;
  } catch (error) {
    return report.url;
  }
}

function renderReports() {
  if (!elements.reportList) {
    return;
  }
  if (!state.reports.length) {
    elements.reportList.innerHTML = `<p class="empty-note">Nothing opened yet. Click a link in the terminal or enter a path above.</p>`;
    return;
  }
  elements.reportList.innerHTML = state.reports
    .map((report) => {
      const active = report.url === state.previewUrl && report.targetId === state.previewTargetId ? "active" : "";
      return `
        <div class="layout-row report-row ${active}" data-report-id="${escapeHtml(report.id)}">
          <button class="layout-row-main" type="button" data-report-action="open" title="${escapeHtml(report.url)}">
            <strong>${escapeHtml(reportLabel(report))}</strong>
            <small>${escapeHtml(describeReport(report))}</small>
          </button>
          <div class="layout-row-actions">
            <button class="icon-button ${report.pinned ? "active" : ""}" type="button" data-report-action="pin" aria-label="${report.pinned ? "Unpin" : "Pin"}" title="${report.pinned ? "Unpin" : "Pin to the top"}">${report.pinned ? "★" : "☆"}</button>
            <button class="icon-button" type="button" data-report-action="delete" aria-label="Remove from the list" title="Remove from the list">×</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function openReport(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }
  await loadUrlPreview(report.url, { history: "reset", targetId: report.targetId });
}

async function toggleReportPin(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) {
    return;
  }
  await apiFetch("/api/reports/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reportId, pinned: !report.pinned })
  });
  await loadReports();
}

async function deleteReport(reportId) {
  await apiFetch("/api/reports/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reportId })
  });
  await loadReports();
}

function bindBrowserEvents() {
  elements.mobileBrowserListBtn.addEventListener("click", () => {
    state.secondaryTab = "browser";
    setMobileScreen("reports");
  });

  elements.mobileReportsBtn.addEventListener("click", () => {
    state.secondaryTab = "browser";
    setMobileScreen("reports");
  });

  elements.mobileBackFromBrowserListBtn.addEventListener("click", () => {
    handleMobileBack(state.flatWindows.length ? "sessions" : "connect");
  });

  elements.reloadReportsBtn.addEventListener("click", async () => {
    await loadReports();
    setStatus("Reports reloaded.", "neutral");
  });

  elements.reportOpenForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = elements.reportUrlInput.value.trim();
    if (!value) {
      elements.reportUrlInput.focus();
      return;
    }
    try {
      await loadUrlPreview(value, { history: "reset" });
      elements.reportUrlInput.value = "";
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.reportList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-report-action]");
    const row = event.target.closest("[data-report-id]");
    if (!button || !row) {
      return;
    }
    const reportId = row.dataset.reportId;
    try {
      if (button.dataset.reportAction === "open") {
        await openReport(reportId);
      } else if (button.dataset.reportAction === "pin") {
        await toggleReportPin(reportId);
      } else if (button.dataset.reportAction === "delete") {
        await deleteReport(reportId);
      }
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.closePreviewBtn.addEventListener("click", closePreview);

  elements.mobileBrowserBackBtn.addEventListener("click", closePreview);

  elements.pinBrowserBtn.addEventListener("click", toggleBrowserPin);

  elements.downloadPreviewBtn.addEventListener("click", () => {
    downloadPreview().catch((error) => setPreviewStatus(error.message, "danger"));
  });

  attachBrowserHandle();

  elements.browserBackBtn.addEventListener("click", () => {
    goBackPreview().catch((error) => setPreviewStatus(error.message, "danger"));
  });

  elements.browserForwardBtn.addEventListener("click", () => {
    goForwardPreview().catch((error) => setPreviewStatus(error.message, "danger"));
  });

  elements.browserHistorySelect.addEventListener("change", () => {
    jumpPreviewHistory(elements.browserHistorySelect.value).catch((error) => setPreviewStatus(error.message, "danger"));
  });

  elements.browserAddressForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadUrlPreview(elements.browserAddressInput.value);
      elements.browserAddressInput.blur();
    } catch (error) {
      setPreviewStatus(error.message, "danger");
    }
  });

  elements.urlPreviewFrame.addEventListener("load", () => {
    if (state.previewVisible && state.previewUrl) {
      elements.previewAddress.textContent = `Loaded ${state.previewUrl}`;
    }
  });

  document.addEventListener("pointerdown", maybeCloseUnpinnedBrowser, true);

  document.addEventListener("focusin", maybeCloseUnpinnedBrowser, true);

  window.addEventListener("message", handleBrowserMessage);
}
