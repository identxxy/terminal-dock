// Harbor view: tokens that lend an agent pane to someone else's agent, each
// with its terminal and its requests. Grants come from scripts/harbor-admin.js;
// here the owner watches, approves or denies requests, opens the pane, revokes.
const HARBOR_POLL_VISIBLE_MS = 4000;
const HARBOR_POLL_HIDDEN_MS = 30000;
const HARBOR_STATUS_LABELS = {
  pending_owner: "needs you",
  queued: "queued",
  delivered: "working",
  replied: "replied",
  rejected: "rejected",
  failed: "failed"
};

let harborTokens = [];

let harborLoadedOnce = false;

const harborExpanded = new Set();

function harborViewShown() {
  return state.sidebarVisible && state.activeSidebarView === "harbor" && document.visibilityState === "visible";
}

async function loadHarbor() {
  try {
    const data = await apiFetch("/api/harbor");
    harborTokens = Array.isArray(data.tokens) ? data.tokens : [];
    harborLoadedOnce = true;
  } catch (error) {
    elements.harborSummary.textContent = `Harbor unavailable: ${error.message}`;
    return;
  }
  renderHarbor();
}

function harborRemaining(token) {
  const minutes = Math.round((Date.parse(token.expiresAt) - Date.now()) / 60000);
  if (token.state !== "active") {
    return token.state;
  }
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${Math.max(0, minutes)}m left`;
}

function harborRequestRow(token, request) {
  const expanded = harborExpanded.has(request.id);
  const decide = request.status === "pending_owner"
    ? `<span class="harbor-decide">
        <button class="secondary-button" type="button" data-harbor-action="approve">Approve</button>
        <button class="ghost-button" type="button" data-harbor-action="deny">Deny</button>
      </span>`
    : "";
  const tools = (request.tools || []).map((tool) =>
    `<li class="${tool.allowed ? "" : "denied"}">${escapeHtml(tool.tool)}${tool.allowed ? "" : ` — ${escapeHtml(tool.reason)}`}</li>`).join("");
  const details = expanded
    ? `<div class="harbor-request-details">
        <p class="harbor-label">Request</p><pre>${escapeHtml(request.text)}</pre>
        ${tools ? `<p class="harbor-label">Tools</p><ul class="harbor-tools">${tools}</ul>` : ""}
        ${request.reply ? `<p class="harbor-label">Reply</p><pre>${escapeHtml(request.reply)}</pre>` : ""}
        ${request.reason ? `<p class="harbor-label">Reason</p><pre>${escapeHtml(request.reason)}</pre>` : ""}
      </div>`
    : "";
  return `
    <div class="harbor-request" data-token-id="${escapeAttribute(token.id)}" data-request-id="${escapeAttribute(request.id)}" data-status="${escapeAttribute(request.status)}">
      <button class="harbor-request-main" type="button" data-harbor-action="toggle" aria-expanded="${expanded}">
        <span class="harbor-status">${escapeHtml(HARBOR_STATUS_LABELS[request.status] || request.status)}</span>
        <span class="harbor-request-text">${escapeHtml(request.text.split("\n")[0])}</span>
      </button>
      ${decide}
      ${details}
    </div>
  `;
}

function renderHarbor() {
  const active = harborTokens.filter((token) => token.state === "active");
  const pending = active.reduce((sum, token) => sum + token.requests.filter((request) => request.status === "pending_owner").length, 0);
  elements.showHarborViewBtn.classList.toggle("has-badge", pending > 0);
  elements.showHarborViewBtn.title = pending ? `Harbor: ${pending} request${pending === 1 ? "" : "s"} need you` : "Harbor";
  elements.harborSummary.textContent = harborTokens.length
    ? `${active.length} active token${active.length === 1 ? "" : "s"}${pending ? ` · ${pending} waiting for you` : ""}. Grant with scripts/harbor-admin.js.`
    : "No Harbor tokens. Lend an agent pane to someone's agent with scripts/harbor-admin.js grant.";
  elements.harborList.innerHTML = harborTokens.map((token) => {
    const used = token.requests.length;
    const requests = token.requests.slice().reverse().map((request) => harborRequestRow(token, request)).join("");
    return `
      <section class="harbor-token" data-token-id="${escapeAttribute(token.id)}" data-state="${escapeAttribute(token.state)}">
        <div class="harbor-token-head">
          <div>
            <strong>${escapeHtml(token.to)}</strong>
            <small>${escapeHtml(token.id)} · ${escapeHtml(token.level)} · ${escapeHtml(token.mode)} · ${used}/${token.maxRequests} · ${escapeHtml(harborRemaining(token))}</small>
          </div>
          ${token.state === "active" ? `<button class="icon-button" type="button" data-harbor-action="revoke" aria-label="Revoke ${escapeAttribute(token.to)}" title="Revoke this token">×</button>` : ""}
        </div>
        <button class="harbor-terminal" type="button" data-harbor-action="open" ${token.dock ? "" : "disabled"} title="${token.dock ? "Open this pane" : "No tmux target for this host in Connect"}">
          <span class="harbor-terminal-id">${escapeHtml(`${token.host}:${token.pane}`)}</span>
          <span class="harbor-terminal-title">${escapeHtml(token.paneTitle || "")}</span>
        </button>
        <p class="harbor-roots">${escapeHtml(token.roots.join(", "))}</p>
        ${token.state === "active" ? "" : `<p class="harbor-roots">History deleted on ${escapeHtml(new Date(token.deleteAt).toLocaleDateString())}</p>`}
        <div class="harbor-requests">${requests || `<p class="empty-note">No requests yet.</p>`}</div>
      </section>
    `;
  }).join("");
}

async function openHarborPane(token) {
  if (!token.dock) {
    return;
  }
  const actor = PANE_TREE.normalizeActor({ targetId: token.dock.targetId, socket: "", windowId: token.dock.windowId });
  state.paneRoot = PANE_TREE.replacePaneActor(state.paneRoot, state.activePaneId, actor);
  savePaneLayout();
  renderPaneTree();
  await bindSelectionToActor(actor);
}

async function harborAction(action, tokenId, requestId) {
  const token = harborTokens.find((item) => item.id === tokenId);
  if (!token) {
    return;
  }
  if (action === "toggle") {
    harborExpanded.has(requestId) ? harborExpanded.delete(requestId) : harborExpanded.add(requestId);
    renderHarbor();
  } else if (action === "open") {
    await openHarborPane(token);
  } else if (action === "approve" || action === "deny") {
    const reason = action === "deny" ? window.prompt("Reason for the other agent (optional):", "") : "";
    if (reason === null) {
      return;
    }
    await apiFetch("/api/harbor/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId, requestId, approve: action === "approve", reason })
    });
    await loadHarbor();
  } else if (action === "revoke") {
    if (!window.confirm(`Revoke Harbor access for ${token.to}? Their agent can no longer send requests.`)) {
      return;
    }
    await apiFetch("/api/harbor/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId })
    });
    await loadHarbor();
    setStatus(`Revoked Harbor access for ${token.to}.`, "neutral");
  }
}

function scheduleHarborPoll() {
  setTimeout(async () => {
    if (state.authenticated && (harborViewShown() || !harborLoadedOnce || document.visibilityState === "visible")) {
      await loadHarbor();
    }
    scheduleHarborPoll();
  }, harborViewShown() ? HARBOR_POLL_VISIBLE_MS : HARBOR_POLL_HIDDEN_MS);
}

function bindHarborEvents() {
  elements.showHarborViewBtn.addEventListener("click", () => {
    setSidebarView("harbor");
    if (harborViewShown()) {
      loadHarbor();
    }
  });
  elements.reloadHarborBtn.addEventListener("click", () => loadHarbor());
  elements.harborList.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-harbor-action]");
    if (!button) {
      return;
    }
    const tokenId = button.closest("[data-token-id]")?.dataset.tokenId;
    const requestId = button.closest("[data-request-id]")?.dataset.requestId;
    harborAction(button.dataset.harborAction, tokenId, requestId).catch((error) => setStatus(error.message, "danger"));
  });
  scheduleHarborPoll();
}
