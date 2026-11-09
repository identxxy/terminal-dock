// Input history: the prompts sent to the selected pane, listed in the right
// sidebar's History tab. The list lives on the server (per target, socket and
// pane) so every device sees the same entries; each one jumps to where the
// prompt was echoed, so the output that followed it is one tap away.

let historyRailHits = [];

let historyRailCache = { key: "", text: null, entries: null, hits: [] };

let historyRailFrame = 0;

let historyLoadKey = "";

function inputHistoryKey(pane = captureSelectedPane()) {
  return `${pane.targetId}|${pane.socket || ""}|${pane.windowId}`;
}

function paneQuery(pane) {
  const query = new URLSearchParams({ targetId: pane.targetId, windowId: String(pane.windowId) });
  if (pane.socket) {
    query.set("socket", pane.socket);
  }
  return query;
}

// Fetch the selected pane's list once per selection; later sends update the
// cached copy from the server's reply.
async function loadInputHistory() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }
  const pane = captureSelectedPane();
  const key = inputHistoryKey(pane);
  if (historyLoadKey === key) {
    return;
  }
  historyLoadKey = key;
  try {
    const data = await apiFetch(`/api/input-history?${paneQuery(pane)}`);
    state.inputHistory[key] = Array.isArray(data.entries) ? data.entries : [];
  } catch (error) {
    historyLoadKey = "";
    return;
  }
  if (isPaneStillSelected(pane)) {
    renderHistoryRail();
  }
}

// Called after the composer delivered text to a pane. The transcript's line
// count at that moment is the fallback position when the echo is not found.
async function recordInputHistory(pane, text) {
  if (!INPUT_HISTORY_UTILS.inputNeedle(text)) {
    return;
  }
  const line = activeExtent() === "all" && state.screenText ? TERMINAL_LINES.splitLines(state.screenText).length : null;
  try {
    const data = await apiFetch("/api/input-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: pane.targetId, socket: pane.socket || "", windowId: pane.windowId, text, line })
    });
    state.inputHistory[inputHistoryKey(pane)] = Array.isArray(data.entries) ? data.entries : [];
  } catch (error) {
    setStatus(`Input history not saved: ${error.message}`, "warning");
    return;
  }
  if (isPaneStillSelected(pane)) {
    renderHistoryRail();
  }
}

async function clearInputHistory() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }
  const pane = captureSelectedPane();
  await apiFetch("/api/input-history/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId: pane.targetId, socket: pane.socket || "", windowId: pane.windowId })
  });
  state.inputHistory[inputHistoryKey(pane)] = [];
  renderHistoryRail();
}

function selectedInputHistory() {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return [];
  }
  return state.inputHistory[inputHistoryKey()] || [];
}

// Line index per entry, recomputed only when the pane text or the list changed.
// Only the Transcript view holds the scrollback the prompts live in; in Screen
// mode every entry counts as not located and a tap switches the view.
function locateHistoryEntries(entries) {
  const key = inputHistoryKey();
  const text = activeExtent() === "all" && !elements.screenOutput.classList.contains("window-layout") ? state.screenText : "";
  if (historyRailCache.key === key && historyRailCache.text === text && historyRailCache.entries === entries) {
    return historyRailCache.hits;
  }
  const hits = text ? INPUT_HISTORY_UTILS.locateInputs(TERMINAL_LINES.splitLines(text), entries) : entries.map(() => -1);
  historyRailCache = { key, text, entries, hits };
  return hits;
}

function formatHistoryTime(at) {
  if (!at) {
    return "";
  }
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function renderHistoryRail() {
  if (!secondaryPanelShown("history")) {
    historyRailHits = [];
    return;
  }
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    historyRailHits = [];
    elements.historyRailCount.textContent = "";
    elements.historyRailClearBtn.hidden = true;
    elements.historyRailList.innerHTML = `<p class="history-rail-empty">Select a pane to list the text sent to it.</p>`;
    return;
  }
  loadInputHistory().catch(() => {});
  const entries = selectedInputHistory();
  const hits = locateHistoryEntries(entries);
  historyRailHits = hits.map((lineIndex, index) => ({ index, lineIndex })).filter((hit) => hit.lineIndex >= 0);
  elements.historyRailCount.textContent = entries.length ? String(entries.length) : "";
  elements.historyRailClearBtn.hidden = !entries.length;

  if (!entries.length) {
    elements.historyRailList.innerHTML = `<p class="history-rail-empty">Text sent to this pane is listed here. Tap an entry to jump to its place in the transcript.</p>`;
    return;
  }

  elements.historyRailList.innerHTML = entries
    .map((entry, index) => {
      const located = hits[index] >= 0;
      const label = INPUT_HISTORY_UTILS.inputNeedle(entry.text, 120);
      const position = located ? `line ${hits[index] + 1}` : "not in the loaded transcript";
      const title = `${entry.text.slice(0, 300)}${entry.text.length > 300 ? "…" : ""}\n${formatHistoryTime(entry.at)} · ${position}`;
      return `
        <button class="history-entry ${located ? "" : "unlocated"}" type="button" data-history-index="${index}" title="${escapeAttribute(title)}">
          <span class="history-entry-text">${escapeHtml(label)}</span>
          <small>${escapeHtml(formatHistoryTime(entry.at))}${located ? ` · L${hits[index] + 1}` : ""}</small>
        </button>
      `;
    })
    .join("");
  updateHistoryRailCurrent();
  const current = elements.historyRailList.querySelector(".history-entry.current") || elements.historyRailList.lastElementChild;
  if (current && typeof current.scrollIntoView === "function") {
    current.scrollIntoView({ block: "nearest" });
  }
}

function scheduleHistoryRail() {
  if (historyRailFrame) {
    return;
  }
  historyRailFrame = requestAnimationFrame(() => {
    historyRailFrame = 0;
    renderHistoryRail();
  });
}

function historyLineTop(lineIndex) {
  const output = elements.screenOutput;
  const line = output.children[lineIndex];
  if (!line) {
    return null;
  }
  return line.getBoundingClientRect().top - output.getBoundingClientRect().top + output.scrollTop;
}

// Mark the entry whose prompt was the last one to pass the top of the view; at
// the tail of the transcript the newest located prompt is the one being read.
function updateHistoryRailCurrent() {
  if (!secondaryPanelShown("history")) {
    return;
  }
  const output = elements.screenOutput;
  let currentIndex = -1;
  if (historyRailHits.length && isScreenOutputNearBottom()) {
    currentIndex = historyRailHits[historyRailHits.length - 1].index;
  } else {
    const threshold = output.scrollTop + 24;
    for (const hit of historyRailHits) {
      const top = historyLineTop(hit.lineIndex);
      if (top !== null && top <= threshold) {
        currentIndex = hit.index;
      }
    }
  }
  elements.historyRailList.querySelectorAll(".history-entry").forEach((button) => {
    button.classList.toggle("current", Number(button.dataset.historyIndex) === currentIndex);
  });
}

async function jumpToHistoryEntry(index) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    return;
  }
  if (selectedPane()?.alternate_on) {
    setStatus("This pane runs a full-screen app; its scrollback is not available.", "warning");
    return;
  }
  if (state.screenExtent !== "all") {
    await setScreenExtent("all");
    renderHistoryRail();
  }
  const hit = historyRailHits.find((item) => item.index === index);
  if (hit && isMobileViewport() && state.mobileScreen !== "chat") {
    // The transcript is on the terminal screen; go there first so the lines
    // have a layout to scroll to. Clearing follow-tail keeps the refresh on
    // return from scrolling to the bottom.
    state.allTextFollowTail = false;
    setMobileScreen("chat");
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const top = hit ? historyLineTop(hit.lineIndex) : null;
  if (top === null) {
    setStatus("That input is not in the loaded transcript any more.", "warning");
    return;
  }
  const output = elements.screenOutput;
  output.scrollTop = Math.max(0, top - 12);
  state.allTextFollowTail = false;
  updateLatestOutputButton();
  const line = output.children[hit.lineIndex];
  line.classList.add("history-hit");
  setTimeout(() => line.classList.remove("history-hit"), 1800);
  updateHistoryRailCurrent();
}

function bindHistoryEvents() {
  elements.historyRailList.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-history-index]");
    if (!button) {
      return;
    }
    jumpToHistoryEntry(Number(button.dataset.historyIndex)).catch((error) => setStatus(error.message, "danger"));
  });
  elements.historyRailClearBtn.addEventListener("click", () => {
    clearInputHistory().catch((error) => setStatus(error.message, "danger"));
  });
  elements.historyRailBtn.addEventListener("click", () => toggleSecondaryTab("history"));
}
