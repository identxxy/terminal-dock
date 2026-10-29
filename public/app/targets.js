// Connect view: target form, saved targets, connect/test.

function normalizeTransport(value) {
  return value === "ssh" ? "ssh" : "local";
}

function getTargetConnectionLabel(target) {
  const transport = normalizeTransport(target?.transport);
  const base = transport === "ssh" ? target?.sshTarget || "SSH" : "Local";
  const backend = normalizeBackend(target?.backend);
  return backend === "kitty" ? base : `${base} · ${backend}`;
}

function syncTargetBackendFormState(options = {}) {
  const backend = normalizeBackend(elements.targetBackend.value);
  const defaults = getBackendDefaults(backend);
  const others = Object.values(BACKEND_DEFAULTS).filter((item) => item !== defaults);
  elements.targetKittyBinaryField.hidden = backend !== "kitty";
  elements.targetTmuxBinaryField.hidden = backend !== "tmux";
  elements.targetBackendSectionTitle.textContent = defaults.sectionTitle;
  elements.targetBackendSectionHint.textContent = defaults.sectionHint;
  elements.targetSocketPattern.placeholder = defaults.socketPlaceholder;
  elements.targetDefaultSocket.placeholder = defaults.defaultSocketPlaceholder;
  // Switching backends swaps an untouched socket pattern for the other default.
  if (options.swapSocketPattern && others.some((item) => elements.targetSocketPattern.value.trim() === item.socketPattern)) {
    elements.targetSocketPattern.value = defaults.socketPattern;
  }
}

function syncTargetTransportFormState() {
  const transport = normalizeTransport(elements.targetTransport.value);
  const isSsh = transport === "ssh";
  const sshField = elements.targetSsh.closest("label");
  elements.targetSsh.disabled = !isSsh;
  elements.targetSsh.required = isSsh;
  elements.targetSsh.placeholder = isSsh ? "ssh-host" : "Local targets do not need an SSH host";
  if (sshField) {
    sshField.hidden = !isSsh;
  }
}

function readTargetForm() {
  const transport = normalizeTransport(elements.targetTransport.value);
  return {
    id: state.editingTargetId || undefined,
    name: elements.targetName.value.trim(),
    transport,
    backend: normalizeBackend(elements.targetBackend.value),
    sshTarget: elements.targetSsh.value.trim(),
    kittyBinary: elements.targetKittyBinary.value.trim(),
    tmuxBinary: elements.targetTmuxBinary.value.trim(),
    socketPattern: elements.targetSocketPattern.value.trim(),
    defaultSocket: elements.targetDefaultSocket.value.trim(),
    notes: elements.targetNotes.value.trim()
  };
}

function writeTargetForm(target) {
  const source = {
    ...DEFAULT_TARGET_FORM,
    ...(target || {})
  };
  elements.targetName.value = source.name || "";
  elements.targetTransport.value = normalizeTransport(source.transport);
  elements.targetBackend.value = normalizeBackend(source.backend);
  elements.targetSsh.value = source.sshTarget || "";
  elements.targetKittyBinary.value = source.kittyBinary || DEFAULT_TARGET_FORM.kittyBinary;
  elements.targetTmuxBinary.value = source.tmuxBinary || DEFAULT_TARGET_FORM.tmuxBinary;
  elements.targetSocketPattern.value = source.socketPattern || getBackendDefaults(source.backend).socketPattern;
  elements.targetDefaultSocket.value = source.defaultSocket || "";
  elements.targetNotes.value = source.notes || "";
  syncTargetBackendFormState();
  syncTargetTransportFormState();
}

function renderTargetSelect() {
  if (!state.targets.length) {
    elements.targetSelect.innerHTML = `<option value="">No saved targets</option>`;
    elements.targetSelect.disabled = true;
    return;
  }

  elements.targetSelect.disabled = false;
  elements.targetSelect.innerHTML = state.targets
    .map((target) => {
      const selected = target.id === state.selectedTargetId ? "selected" : "";
      const connectionLabel = getTargetConnectionLabel(target);
      return `
        <option value="${escapeAttribute(target.id)}" ${selected}>
          ${escapeHtml(target.name)} · ${escapeHtml(connectionLabel)}
        </option>
      `;
    })
    .join("");

  elements.targetSelect.value = state.selectedTargetId;
  updateStatusBar();
}

function renderSavedTargets() {
  if (!state.targets.length) {
    elements.savedTargets.innerHTML = `<p class="empty-note">No saved targets yet.</p>`;
    return;
  }

  elements.savedTargets.innerHTML = state.targets
    .map((target) => {
      const active = target.id === state.editingTargetId ? "active" : "";
      const selected = target.id === state.selectedTargetId ? "selected" : "";
      const connectionLabel = getTargetConnectionLabel(target);
      return `
        <button class="target-chip ${active} ${selected}" type="button" data-target-id="${target.id}">
          <span>${escapeHtml(target.name)}</span>
          <small>${escapeHtml(connectionLabel)}</small>
        </button>
      `;
    })
    .join("");

  elements.savedTargets.querySelectorAll("[data-target-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.targetId;
      state.selectedTargetId = targetId;
      state.editingTargetId = targetId;
      clearSessionSelection();
      const target = getSelectedTarget();
      writeTargetForm(target);
      renderSavedTargets();
      renderTargetSelect();
      setTargetHealth("Ready to connect", "neutral");
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      setStatus(`Switched to ${target.name}; the top selector is synced.`, "neutral");
    });
  });
}

function renderSocketOptions(sockets, selectedSocket) {
  const safeSockets = sockets?.length ? sockets : [""];
  elements.socketSelect.innerHTML = safeSockets
    .map((socket) => {
      const label = socket || "Auto-select latest socket";
      const selected = socket === selectedSocket ? "selected" : "";
      return `<option value="${escapeAttribute(socket)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  elements.socketSelect.value = selectedSocket || "";
  updateStatusBar();
}

function clearSessionSelection() {
  invalidateSessionRequests();
  state.selectedSocket = "";
  state.sessionTree = [];
  state.flatWindows = [];
  state.selectedWindowId = null;
  state.screenText = "";
  state.allTextFollowTail = true;
  state.imageAttachment = null;
  if (isMobileViewport()) {
    state.mobileScreen = "connect";
    resetMobileStack("connect");
    state.activeSidebarView = "ssh";
    state.sidebarVisible = true;
  }
  renderSocketOptions([], "");
  renderSessions();
  renderViewerMeta();
  renderImageAttachment();
  state.sessionLabels = labelsForTarget(getSelectedTarget());
  state.sessionBackend = normalizeBackend(getSelectedTarget()?.backend);
  elements.screenOutput.textContent = "Waiting for a pane...";
  updateStatusBar();
}

async function loadTargets() {
  const previousSelected = state.selectedTargetId;
  const previousEditing = state.editingTargetId;
  const data = await apiFetch("/api/targets");

  state.targets = data.targets || [];
  state.selectedTargetId = state.targets.some((target) => target.id === previousSelected)
    ? previousSelected
    : data.lastSelectedTargetId || state.targets[0]?.id || "";
  state.editingTargetId = state.targets.some((target) => target.id === previousEditing)
    ? previousEditing
    : state.selectedTargetId;

  renderTargetSelect();
  renderSavedTargets();
  writeTargetForm(getEditingTarget() || getSelectedTarget());
  updateStatusBar();
}

async function saveTarget() {
  const payload = readTargetForm();
  const data = await apiFetch("/api/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: payload })
  });

  state.selectedTargetId = data.target.id;
  state.editingTargetId = data.target.id;
  await loadTargets();
  renderTargetSelect();
  setStatus(`Target ${data.target.name} saved. You can switch to it from the top selector.`, "success");
}

async function testTargetRequest(requestBody) {
  const result = await apiFetch("/api/targets/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  setTargetHealth("Connection OK", "success");
  if (result.labels) {
    state.sessionLabels = result.labels;
  }
  renderSocketOptions(result.sockets || [], result.selectedSocket || "");
  state.selectedSocket = result.selectedSocket || "";
  setStatus(
    `${result.host} / ${result.user}: found ${result.sockets.length} sockets and ${result.windowCount} panes.`,
    "success"
  );

  return result;
}

async function testDraftTarget() {
  return testTargetRequest({
    target: readTargetForm(),
    socket: state.selectedSocket || ""
  });
}

async function connectSelectedTarget(options = {}) {
  if (!state.selectedTargetId) {
    setStatus("Save a connection target first.", "warning");
    return;
  }

  if (options.source !== "auto") {
    cancelMobileAutoConnect({ suppress: true });
  }

  sendClientDebug("connectSelectedTarget:start", null, { force: true });
  await testTargetRequest({
    targetId: state.selectedTargetId,
    socket: state.selectedSocket || ""
  });
  await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
  if (isMobileViewport()) {
    setMobileScreen("sessions");
  }
  sendClientDebug("connectSelectedTarget:done", null, { force: true });
}

function resetTargetDraft() {
  cancelMobileAutoConnect({ suppress: true });
  state.editingTargetId = "";
  writeTargetForm(DEFAULT_TARGET_FORM);
  setTargetHealth("Ready to connect", "neutral");
  setStatus("Creating a new target. Save it to make it available in the top selector.", "neutral");
}

function bindTargetsEvents() {
  elements.targetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveTarget();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.targetTransport.addEventListener("change", syncTargetTransportFormState);

  elements.targetBackend.addEventListener("change", () => syncTargetBackendFormState({ swapSocketPattern: true }));

  elements.reloadTargetsBtn.addEventListener("click", async () => {
    try {
      await loadTargets();
      setStatus("Target list refreshed.", "neutral");
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.newTargetBtn.addEventListener("click", () => {
    resetTargetDraft();
  });

  elements.mobileConnectTargetBtn.addEventListener("click", async () => {
    try {
      await connectSelectedTarget();
    } catch (error) {
      setTargetHealth("Connection failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.testTargetBtn.addEventListener("click", async () => {
    cancelMobileAutoConnect({ suppress: true });
    try {
      await testDraftTarget();
    } catch (error) {
      setTargetHealth("Test failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.connectTargetBtn.addEventListener("click", async () => {
    try {
      await connectSelectedTarget();
    } catch (error) {
      setTargetHealth("Connection failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.targetSelect.addEventListener("change", async () => {
    state.selectedTargetId = elements.targetSelect.value;
    state.editingTargetId = state.selectedTargetId;
    clearSessionSelection();
    const target = getSelectedTarget();

    writeTargetForm(target);
    renderSavedTargets();
    setTargetHealth("Switching", "neutral");

    try {
      await apiFetch("/api/targets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: state.selectedTargetId })
      });
      setStatus(`Switched to ${target.name}.`, "neutral");
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
      if (isMobileViewport()) {
        setMobileScreen("sessions");
      }
    } catch (error) {
      setTargetHealth("Switch failed", "danger");
      setStatus(error.message, "danger");
    }
  });

  elements.socketSelect.addEventListener("change", async () => {
    invalidateSessionRequests();
    state.selectedSocket = elements.socketSelect.value;
    try {
      await loadSessions({ forceRefresh: true, scrollToBottom: activeExtent() === "all" });
    } catch (error) {
      setTargetHealth("Switch failed", "danger");
      setStatus(error.message, "danger");
    }
  });
}
