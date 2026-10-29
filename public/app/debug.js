// ?debug=1 diagnostics: on-page overlay and POST /api/client-log snapshots.

function getDebugParam() {
  return new URLSearchParams(window.location.search).get("debug");
}

function describeElement(element) {
  if (!element) {
    return null;
  }

  return {
    tag: element.tagName,
    id: element.id || "",
    className: typeof element.className === "string" ? element.className : "",
    hidden: Boolean(element.hidden),
    windowId: element.dataset?.windowId || "",
    view: element.dataset?.view || ""
  };
}

function describeBox(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    element: describeElement(element),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom)
    },
    display: style.display,
    visibility: style.visibility,
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    overflow: style.overflow,
    overflowY: style.overflowY,
    touchAction: style.touchAction,
    scrollTop: Math.round(element.scrollTop || 0),
    scrollHeight: Math.round(element.scrollHeight || 0),
    clientHeight: Math.round(element.clientHeight || 0)
  };
}

function getEventPoint(event) {
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  if (touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }

  return null;
}

function createDebugSnapshot(eventName, event) {
  const point = getEventPoint(event);
  const center = {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };
  const hitPoint = point || center;
  const hitElement = document.elementFromPoint(hitPoint.x, hitPoint.y);

  return {
    source: "krd-client-debug",
    build: CLIENT_BUILD,
    event: eventName,
    eventType: event?.type || "",
    point: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null,
    href: window.location.href,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      mobileQuery: isMobileViewport()
    },
    state: {
      authenticated: state.authenticated,
      mobileScreen: state.mobileScreen,
      activeSidebarView: state.activeSidebarView,
      sidebarVisible: state.sidebarVisible,
      previewVisible: state.previewVisible,
      previewPinned: state.previewPinned,
      selectedTargetId: state.selectedTargetId,
      selectedSocket: state.selectedSocket,
      selectedWindowId: state.selectedWindowId,
      flatWindowCount: state.flatWindows.length,
      sessionTreeCount: state.sessionTree.length,
      refreshing: state.refreshing,
      screenExtent: state.screenExtent
    },
    classes: elements.appShell?.className || "",
    activeElement: describeElement(document.activeElement),
    hit: describeElement(hitElement),
    hitPath: hitElement
      ? Array.from(hitElement.closest?.("button, [data-window-id], section, aside, main, div") ? [hitElement.closest("button, [data-window-id], section, aside, main, div")] : [])
          .map(describeElement)
      : [],
    boxes: {
      html: describeBox(document.documentElement),
      body: describeBox(document.body),
      appShell: describeBox(elements.appShell),
      authGate: describeBox(elements.authGate),
      workbench: describeBox(document.querySelector(".workbench")),
      primarySidebar: describeBox(elements.primarySidebar),
      sshSidebarView: describeBox(elements.sshSidebarView),
      sessionsSidebarView: describeBox(elements.sessionsSidebarView),
      sessionTree: describeBox(elements.sessionTree),
      editorRegion: describeBox(document.querySelector(".editor-region")),
      previewDrawer: describeBox(elements.previewDrawer),
      browserHandle: describeBox(elements.browserHandleBtn)
    }
  };
}

function updateClientDebugOverlay(snapshot) {
  let overlay = document.querySelector("#clientDebugOverlay");
  if (!overlay) {
    overlay = document.createElement("pre");
    overlay.id = "clientDebugOverlay";
    overlay.style.position = "fixed";
    overlay.style.left = "8px";
    overlay.style.right = "8px";
    overlay.style.bottom = "8px";
    overlay.style.zIndex = "10000";
    overlay.style.maxHeight = "34dvh";
    overlay.style.margin = "0";
    overlay.style.padding = "8px";
    overlay.style.overflow = "hidden";
    overlay.style.border = "1px solid rgba(255,255,255,0.28)";
    overlay.style.borderRadius = "6px";
    overlay.style.background = "rgba(0,0,0,0.78)";
    overlay.style.color = "#fff";
    overlay.style.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    overlay.style.pointerEvents = "none";
    document.body.appendChild(overlay);
  }

  overlay.textContent = [
    `KRD ${snapshot.build} ${snapshot.event}`,
    `screen=${snapshot.state.mobileScreen} view=${snapshot.state.activeSidebarView} mobile=${snapshot.viewport.mobileQuery}`,
    `hit=${snapshot.hit?.tag || "-"}#${snapshot.hit?.id || ""}.${snapshot.hit?.className || ""}`,
    `sessions scroll=${snapshot.boxes.sessionsSidebarView?.scrollTop}/${snapshot.boxes.sessionsSidebarView?.scrollHeight}`,
    `tree scroll=${snapshot.boxes.sessionTree?.scrollTop}/${snapshot.boxes.sessionTree?.scrollHeight}`
  ].join("\n");
}

function sendClientDebug(eventName, event, options = {}) {
  if (!clientDebugEnabled) {
    return;
  }

  const now = Date.now();
  if (!options.force && now - lastClientDebugAt < 500) {
    return;
  }
  lastClientDebugAt = now;

  const snapshot = createDebugSnapshot(eventName, event);
  updateClientDebugOverlay(snapshot);

  const payload = JSON.stringify(snapshot);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/client-log", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function initializeClientDebug() {
  const debugParam = getDebugParam();

  try {
    if (debugParam === "off") {
      localStorage.removeItem(DEBUG_STORAGE_KEY);
    } else if (debugParam) {
      localStorage.setItem(DEBUG_STORAGE_KEY, "1");
    }

    clientDebugEnabled = localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch (error) {
    clientDebugEnabled = Boolean(debugParam && debugParam !== "off");
  }

  if (!clientDebugEnabled) {
    return;
  }

  ["touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "click", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => sendClientDebug(eventName, event), {
      capture: true,
      passive: true
    });
  });

  clientDebugTimer = setInterval(() => {
    sendClientDebug("heartbeat", null, { force: true });
  }, 2000);
  sendClientDebug("init", null, { force: true });
}
