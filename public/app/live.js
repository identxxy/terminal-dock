// Live updates: /api/events stream for tmux panes, adaptive polling fallback.

// ---- Live updates -----------------------------------------------------------
// One EventSource carries every tmux pane this page shows (primary view and
// split views). The server watches each pane's session through a tmux
// control-mode client and sends `screen` when the pane's window changes; the
// page then re-fetches through the same /api/screen path polling uses.
let liveSource = null;

let liveSubsKey = "";

let liveWindows = new Set();

let liveSyncTimer = null;

let liveReconnectTimer = null;

let liveReconnectDelay = 3000;

let liveRefreshRunning = false;

let liveRefreshPending = false;

let liveRefreshTimer = null;

let lastLiveRefreshAt = 0;

function paneLiveKey(targetId, socket, windowId) {
  return `${targetId || ""}|${socket || ""}|${windowId}`;
}

function isPrimaryLive() {
  return hasSelectedWindow() && liveWindows.has(paneLiveKey(state.selectedTargetId, state.selectedSocket, Number(state.selectedWindowId)));
}

function desiredLiveSubscriptions() {
  const subs = new Map();
  const add = (targetId, socket, windowId) => {
    const target = state.targets.find((item) => item.id === targetId);
    if (!target || target.backend !== "tmux" || windowId === null || windowId === undefined) {
      return;
    }
    subs.set(paneLiveKey(targetId, socket, Number(windowId)), { targetId, socket: socket || "", windowId: Number(windowId) });
  };
  if (state.selectedTargetId && hasSelectedWindow()) {
    add(state.selectedTargetId, state.selectedSocket, state.selectedWindowId);
  }
  secondaryViewers.forEach((viewer) => add(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId));
  return [...subs.values()];
}

function syncLiveSubscriptions() {
  clearTimeout(liveSyncTimer);
  liveSyncTimer = setTimeout(() => {
    liveSyncTimer = null;
    if (!state.authenticated || document.hidden || typeof EventSource === "undefined") {
      closeLiveSource();
      return;
    }
    const subs = desiredLiveSubscriptions();
    const key = JSON.stringify(subs);
    if (!subs.length) {
      closeLiveSource();
      return;
    }
    if (liveSource && key === liveSubsKey) {
      return;
    }
    openLiveSource(subs, key);
  }, LIVE_RESUBSCRIBE_DEBOUNCE_MS);
}

function openLiveSource(subs, key) {
  closeLiveSource({ keepDelay: true });
  liveSubsKey = key;
  const source = new EventSource(`/api/events?subs=${encodeURIComponent(JSON.stringify(subs))}`);
  liveSource = source;
  source.addEventListener("open", () => {
    liveReconnectDelay = 3000;
  });
  // The server names the subscriptions it could attach a watcher to.
  source.addEventListener("subscribed", (event) => {
    const data = parseLiveEvent(event);
    const live = Array.isArray(data.live) ? data.live : [];
    setLiveWindows(new Set(live.map((item) => paneLiveKey(item.targetId, item.socket, Number(item.windowId)))));
  });
  source.addEventListener("screen", (event) => handleLiveScreenEvent(parseLiveEvent(event)));
  source.addEventListener("tree", () => {
    loadSessions({ refreshPane: false }).catch(() => {});
  });
  source.addEventListener("reset", () => {
    scheduleLiveReconnect();
  });
  source.addEventListener("error", () => {
    // EventSource retries network drops itself; a closed stream (HTTP error,
    // server restart) needs our own backoff.
    setLiveWindows(new Set());
    if (source.readyState === EventSource.CLOSED) {
      scheduleLiveReconnect();
    }
  });
}

function parseLiveEvent(event) {
  try {
    return JSON.parse(event.data);
  } catch (error) {
    return {};
  }
}

function setLiveWindows(next) {
  const changed = next.size !== liveWindows.size || [...next].some((item) => !liveWindows.has(item));
  liveWindows = next;
  if (!changed) {
    return;
  }
  updateStatusBar();
  if (pollTimer && state.autoRefresh) {
    schedulePoll(getPollDelayMs());
  }
}

function scheduleLiveReconnect() {
  closeLiveSource({ keepDelay: true });
  clearTimeout(liveReconnectTimer);
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    liveSubsKey = "";
    syncLiveSubscriptions();
  }, liveReconnectDelay);
  liveReconnectDelay = Math.min(liveReconnectDelay * 2, LIVE_RECONNECT_MAX_MS);
}

function closeLiveSource(options = {}) {
  if (liveSource) {
    liveSource.close();
    liveSource = null;
  }
  liveSubsKey = "";
  if (!options.keepDelay) {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
    liveReconnectDelay = 3000;
  }
  setLiveWindows(new Set());
}

function handleLiveScreenEvent(data) {
  const key = paneLiveKey(data.targetId, data.socket, Number(data.windowId));
  if (hasSelectedWindow() && key === paneLiveKey(state.selectedTargetId, state.selectedSocket, Number(state.selectedWindowId))) {
    requestLiveRefresh();
  }
  secondaryViewers.forEach((viewer) => {
    if (paneLiveKey(viewer.actor.targetId, viewer.actor.socket, viewer.actor.windowId) === key) {
      viewer.trigger();
    }
  });
}

// Coalesce bursts: one refresh in flight, at most one queued, and a minimum
// gap per extent so "All" never re-downloads history on every output chunk.
function requestLiveRefresh() {
  if (liveRefreshRunning) {
    liveRefreshPending = true;
    return;
  }
  const gap = LIVE_MIN_GAP_MS[activeExtent()] || LIVE_MIN_GAP_MS.screen;
  const wait = Math.max(0, lastLiveRefreshAt + gap - Date.now());
  if (liveRefreshTimer) {
    return;
  }
  liveRefreshTimer = setTimeout(runLiveRefresh, wait);
}

async function runLiveRefresh() {
  liveRefreshTimer = null;
  if (!state.selectedTargetId || !hasSelectedWindow() || document.hidden) {
    return;
  }
  if (activeExtent() === "all" && !state.allTextFollowTail) {
    return;
  }
  liveRefreshRunning = true;
  lastLiveRefreshAt = Date.now();
  try {
    await refreshScreen({ force: true });
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    liveRefreshRunning = false;
  }
  if (liveRefreshPending) {
    liveRefreshPending = false;
    requestLiveRefresh();
  }
}

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function getPollDelayMs() {
  if (isPrimaryLive()) {
    return LIVE_POLL_MS;
  }
  const quietFor = Date.now() - lastScreenActivityAt;
  if (quietFor < POLL_ACTIVE_WINDOW_MS) {
    return POLL_ACTIVE_MS;
  }
  if (quietFor < POLL_WARM_WINDOW_MS) {
    return POLL_WARM_MS;
  }
  return POLL_IDLE_MS;
}

function schedulePoll(delayMs) {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  const generation = pollGeneration;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (generation !== pollGeneration) {
      return;
    }

    if (state.selectedTargetId && !document.hidden) {
      pollInFlight = true;
      try {
        await runAutoRefreshTick();
      } catch (error) {
        setStatus(error.message, "danger");
        setTargetHealth("Connection issue", "danger");
      } finally {
        pollInFlight = false;
      }
    }

    // Hidden pages stop here; the visibilitychange handler resumes polling.
    if (generation === pollGeneration && !document.hidden) {
      schedulePoll(getPollDelayMs());
    }
  }, delayMs);
}

function restartPolling() {
  stopPolling();

  if (!state.autoRefresh || !state.authenticated) {
    return;
  }

  lastTreeRefreshAt = Date.now();
  lastAllTextRefreshAt = Date.now();
  schedulePoll(getPollDelayMs());
}

// Called when the pane output changes or input is sent: speeds polling back up.
function noteScreenActivity() {
  lastScreenActivityAt = Date.now();
  if (pollTimer && state.autoRefresh && !isPrimaryLive()) {
    schedulePoll(POLL_ACTIVE_MS);
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    closeLiveSource();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    return;
  }
  syncLiveSubscriptions();
  scheduleAutoFit();

  // An in-flight tick reschedules itself once it finishes.
  if (state.autoRefresh && state.authenticated && !pollTimer && !pollInFlight) {
    schedulePoll(0);
  }
}

async function runAutoRefreshTick() {
  const now = Date.now();
  const refreshTree = now - lastTreeRefreshAt >= SESSION_TREE_REFRESH_MS || !state.flatWindows.length;
  if (refreshTree) {
    lastTreeRefreshAt = now;
  }

  if (!hasSelectedWindow()) {
    await loadSessions({ forceRefresh: true });
    return;
  }

  if (activeExtent() === "all") {
    if (!state.allTextFollowTail) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      setStatus("Browsing history · All auto refresh paused.", "neutral");
      return;
    }

    if (now - lastAllTextRefreshAt < ALL_TEXT_AUTO_REFRESH_MS) {
      if (refreshTree) {
        await loadSessions({ refreshPane: false });
      }
      return;
    }
    lastAllTextRefreshAt = now;
  }

  if (refreshTree) {
    await loadSessions({ forceRefresh: true });
  } else {
    await refreshScreen({ force: true });
  }
}

function bindLiveEvents() {
  document.addEventListener("visibilitychange", handleVisibilityChange);
}
