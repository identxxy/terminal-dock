// Bottom composer: text/keys/images sent to the selected pane, editor menus.

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function getImageMimeType(file) {
  return String(file?.type || "").split(";")[0].trim().toLowerCase();
}

function isVideoMimeType(mimeType) {
  return SUPPORTED_VIDEO_TYPES.has(mimeType);
}

function validateImageFile(file) {
  if (!file) {
    throw new Error("No image or video selected.");
  }

  const mimeType = getImageMimeType(file);
  const isVideo = isVideoMimeType(mimeType);
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType) && !isVideo) {
    throw new Error("Only PNG, JPEG, WebP, GIF, HEIC, HEIF images or MP4, MOV, WebM, MKV, M4V videos are supported.");
  }

  const limit = isVideo ? MAX_VIDEO_ATTACHMENT_BYTES : MAX_IMAGE_ATTACHMENT_BYTES;
  if (file.size > limit) {
    throw new Error(`${isVideo ? "Video" : "Image"} is too large. The current limit is ${Math.floor(limit / 1024 / 1024)} MiB.`);
  }
}

function renderImageAttachment() {
  const attachments = state.imageAttachments;
  const hasAttachments = attachments.length > 0;
  elements.bottomPanel.classList.toggle("has-image-attachment", hasAttachments);
  elements.sendForm.classList.toggle("has-image-attachment", hasAttachments);
  elements.imageAttachment.hidden = !hasAttachments;
  elements.imageAttachment.replaceChildren(...attachments.map((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "image-attachment";

    const thumb = document.createElement(attachment.isVideo ? "video" : "img");
    if (attachment.isVideo) {
      thumb.muted = true;
      thumb.playsInline = true;
      thumb.preload = "metadata";
    } else {
      thumb.alt = "";
    }
    thumb.src = attachment.previewUrl;

    const meta = document.createElement("div");
    meta.className = "image-attachment-meta";
    const name = document.createElement("strong");
    name.textContent = attachment.name;
    const info = document.createElement("span");
    info.textContent = `${attachment.type} · ${formatBytes(attachment.size)}`;
    meta.append(name, info);

    const remove = document.createElement("button");
    remove.className = "icon-button image-remove-button";
    remove.type = "button";
    remove.dataset.attachmentIndex = String(index);
    remove.disabled = state.composerSending;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "×";

    chip.append(thumb, meta, remove);
    return chip;
  }));
}

function renderSpecialKeyMenu() {
  elements.specialKeyMenuPopover.innerHTML = "";

  COMPOSER_UTILS.SPECIAL_KEY_GROUPS.forEach((group) => {
    const groupNode = document.createElement("section");
    groupNode.className = "special-key-group";

    const label = document.createElement("p");
    label.className = "special-key-group-label";
    label.textContent = group.label;
    groupNode.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "special-key-grid";

    group.keys.forEach((item) => {
      const button = document.createElement("button");
      button.className = "special-key-item";
      button.type = "button";
      button.role = "menuitem";
      button.dataset.specialKeyId = item.id;
      const keyLabel = document.createElement("span");
      keyLabel.className = "special-key-label";
      keyLabel.textContent = item.label;
      button.appendChild(keyLabel);
      if (item.hint) {
        const hint = document.createElement("small");
        hint.className = "special-key-hint";
        hint.textContent = item.hint;
        button.appendChild(hint);
      }
      const sent = item.keys ? item.keys.join(" ") : `${item.key}${item.repeat > 1 ? ` ×${item.repeat}` : ""}`;
      button.title = item.hint ? `${item.hint} (${sent})` : sent;
      grid.appendChild(button);
    });

    groupNode.appendChild(grid);
    elements.specialKeyMenuPopover.appendChild(groupNode);
  });
}

function closeEditorMenu() {
  elements.editorMenuPopover.hidden = true;
  elements.editorMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleEditorMenu() {
  const shouldOpen = elements.editorMenuPopover.hidden;
  elements.editorMenuPopover.hidden = !shouldOpen;
  elements.editorMenuBtn.setAttribute("aria-expanded", String(shouldOpen));
}

function closeSpecialKeyMenu() {
  elements.specialKeyMenuPopover.hidden = true;
  elements.specialKeyMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleSpecialKeyMenu(forceOpen = null) {
  if (state.composerSending) {
    return;
  }

  const shouldOpen = forceOpen === null ? elements.specialKeyMenuPopover.hidden : Boolean(forceOpen);
  elements.specialKeyMenuPopover.hidden = !shouldOpen;
  elements.specialKeyMenuBtn.setAttribute("aria-expanded", String(shouldOpen));
}

// Chat-style composer: one row that grows with its content up to the panel height.
function autosizeComposer() {
  const input = elements.sendTextInput;
  if (!input) {
    return;
  }
  const maxHeight = state.bottomPanelHeight || PANEL_HEIGHT_RANGE.default;
  const minHeight = state.bottomPanelPinned ? maxHeight : 0;
  input.style.height = "auto";
  const contentHeight = input.scrollHeight;
  input.style.height = `${Math.max(minHeight, Math.min(contentHeight, maxHeight))}px`;
  input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
}

function setComposerBusy(isBusy) {
  state.composerSending = Boolean(isBusy);
  elements.sendForm.classList.toggle("composer-busy", state.composerSending);
  elements.sendForm.setAttribute("aria-busy", String(state.composerSending));
  elements.sendTextBtn.disabled = state.composerSending;
  elements.sendRawTextBtn.disabled = state.composerSending;
  elements.specialKeyMenuBtn.disabled = state.composerSending;
  elements.attachImageBtn.disabled = state.composerSending;
  elements.imageAttachment.querySelectorAll(".image-remove-button").forEach((button) => {
    button.disabled = state.composerSending;
  });
  elements.imageInput.disabled = state.composerSending;
  elements.sendTextInput.readOnly = state.composerSending;
  elements.sendTextBtn.classList.toggle("is-sending", state.composerSending);
  elements.sendTextBtn.setAttribute("aria-label", state.composerSending ? "Sending" : "Send");
  if (state.composerSending) {
    closeSpecialKeyMenu();
  }
}

async function attachImageFiles(files) {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Add files after it finishes.", "neutral");
    return;
  }

  files.forEach(validateImageFile);
  if (state.imageAttachments.length + files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`At most ${MAX_ATTACHMENT_COUNT} attachments per send.`);
  }

  // Files stay as File objects: the upload queue streams them in chunks.
  for (const file of files) {
    const type = getImageMimeType(file);
    const isVideo = isVideoMimeType(type);
    state.imageAttachments.push({
      file,
      name: file.name || (isVideo ? "video" : "image"),
      type,
      size: file.size,
      isVideo,
      previewUrl: URL.createObjectURL(file)
    });
  }
  renderImageAttachment();
  setStatus(files.length === 1 ? `${files[0].name || "File"} attached.` : `${files.length} files attached.`, "success");
}

function removeImageAttachment(index) {
  const [removed] = state.imageAttachments.splice(index, 1);
  if (removed?.previewUrl) {
    URL.revokeObjectURL(removed.previewUrl);
  }
  renderImageAttachment();
}

function clearImageAttachment() {
  state.imageAttachments.forEach((attachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  });
  state.imageAttachments = [];
  elements.imageInput.value = "";
  renderImageAttachment();
}

function getImageFilesFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  return files.filter((file) => /^(image|video)\//.test(getImageMimeType(file)));
}

function openImagePicker() {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Add the file after it finishes.", "neutral");
    return;
  }
  elements.imageInput.click();
}

async function sendText(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  if (text.length === 0) {
    setStatus("Type something before sending.", "warning");
    return false;
  }

  const pane = captureSelectedPane();
  scheduleAutoFit();
  await apiFetch("/api/send-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: pane.targetId,
      socket: pane.socket,
      windowId: pane.windowId,
      text,
      appendNewline: Boolean(options.appendNewline)
    })
  });

  setStatus(
    options.appendNewline
      ? `Text sent to pane #${pane.windowId} and submitted.`
      : `Text sent to pane #${pane.windowId}.`,
    "success"
  );
  recordInputHistory(pane, text);
  elements.sendTextInput.value = "";
  autosizeComposer();
  noteScreenActivity();
  if (isPaneStillSelected(pane)) {
    await refreshScreen({ scrollToBottom: true });
  }
  return true;
}

// Attachments, and any text sent while the pane still has messages uploading,
// go through that pane's upload queue (upload-queue.js) so they arrive in order.
function queueComposerMessage(options = {}) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return false;
  }

  const text = elements.sendTextInput.value;
  const attachments = state.imageAttachments.slice();
  if (!attachments.length && !text) {
    setStatus("Type something before sending.", "warning");
    return false;
  }

  const pane = captureSelectedPane();
  enqueueUploadMessage(pane, { text, appendNewline: options.appendNewline, attachments });
  setStatus(attachments.length ? `Uploading ${attachments.length === 1 ? attachments[0].name : `${attachments.length} files`} to pane #${pane.windowId}...` : `Queued behind uploads to pane #${pane.windowId}.`, "neutral");
  if (text) {
    recordInputHistory(pane, text);
  }
  elements.sendTextInput.value = "";
  autosizeComposer();
  clearImageAttachment();
  return true;
}

async function sendComposerPayload(options = {}) {
  if (state.imageAttachments.length || hasPendingUploads(captureSelectedPane())) {
    return queueComposerMessage(options);
  }
  return runComposerAction(() => sendText(options));
}

async function runComposerAction(action) {
  if (state.composerSending) {
    setStatus("Previous input is still sending. Please wait.", "neutral");
    return false;
  }

  setComposerBusy(true);
  try {
    return await action();
  } finally {
    setComposerBusy(false);
  }
}

async function sendComposerKey(key, repeat = 1) {
  return runComposerAction(() => sendKey(key, repeat));
}

// `key` is one key name, or an array for a chord such as ["ctrl+x", "ctrl+s"].
async function sendKey(key, repeat = 1) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return;
  }

  const keys = Array.isArray(key) ? key : null;
  const pane = captureSelectedPane();
  scheduleAutoFit();
  await apiFetch("/api/send-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: pane.targetId,
      socket: pane.socket,
      windowId: pane.windowId,
      key: keys ? keys[0] : key,
      keys: keys || undefined,
      repeat
    })
  });

  const sent = keys ? keys.join(" ") : `${key}${repeat > 1 ? ` ×${repeat}` : ""}`;
  setStatus(`Sent key ${sent} to pane #${pane.windowId}.`, "success");
  noteScreenActivity();
  if (isPaneStillSelected(pane)) {
    await refreshScreen({ scrollToBottom: true });
  }
}

async function sendComposerShortcut() {
  const action = COMPOSER_UTILS.getEnterAction(elements.sendTextInput.value, {
    hasImage: state.imageAttachments.length > 0
  });

  if (action.type === "send-composer") {
    return sendComposerPayload({ appendNewline: action.appendNewline });
  }

  if (action.type === "send-text") {
    return sendComposerPayload({ appendNewline: action.appendNewline });
  }

  if (action.type === "send-key") {
    return sendComposerKey(action.key);
  }

  return false;
}

// ---- Live keys ---------------------------------------------------------------
// With the toggle on, every keydown in the composer goes to the pane at once
// instead of into the textbox, like typing in the terminal: vim, pagers, menus.
// Keys queue in order and leave in batches of up to 8 per request; text the
// browser inserts anyway (IME, soft keyboards, paste) is sent as text in turn.
let liveKeyQueue = [];

let liveKeyFlushing = false;

function setLiveKeys(enabled) {
  state.liveKeys = Boolean(enabled);
  elements.liveKeysToggle.setAttribute("aria-pressed", String(state.liveKeys));
  elements.sendForm.classList.toggle("live-keys", state.liveKeys);
  elements.sendTextInput.placeholder = state.liveKeys ? "Live keys · every keystroke goes to the pane" : COMPOSER_PLACEHOLDER;
  if (state.liveKeys) {
    closeSpecialKeyMenu();
    elements.sendTextInput.focus();
    setStatus("Live keys on: keystrokes go straight to the pane.", "neutral");
  } else {
    liveKeyQueue = [];
    setStatus("Live keys off.", "neutral");
  }
}

function queueLiveInput(item) {
  if (!state.selectedTargetId || !hasSelectedWindow()) {
    setStatus("Select a pane first.", "warning");
    return;
  }
  liveKeyQueue.push(item);
  flushLiveKeys();
}

async function flushLiveKeys() {
  if (liveKeyFlushing) {
    return;
  }
  liveKeyFlushing = true;
  const pane = captureSelectedPane();
  const post = (path, body) => apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId: pane.targetId, socket: pane.socket, windowId: pane.windowId, ...body })
  });
  try {
    while (liveKeyQueue.length && state.liveKeys && isPaneStillSelected(pane)) {
      if (liveKeyQueue[0].text !== undefined) {
        await post("/api/send-text", { text: liveKeyQueue.shift().text, appendNewline: false });
      } else {
        const keys = [];
        while (liveKeyQueue.length && keys.length < 8 && liveKeyQueue[0].key !== undefined) {
          keys.push(liveKeyQueue.shift().key);
        }
        await post("/api/send-key", { key: keys[0], keys, repeat: 1 });
      }
      noteScreenActivity();
    }
  } catch (error) {
    liveKeyQueue = [];
    setStatus(error.message, "danger");
  } finally {
    liveKeyFlushing = false;
  }
  if (isPaneStillSelected(pane)) {
    refreshScreen({ scrollToBottom: true }).catch(() => {});
  }
}

// Text that reached the textbox despite live keys (IME commit, soft keyboard,
// paste) goes to the pane as text and leaves the textbox empty.
function drainLiveText() {
  const text = elements.sendTextInput.value;
  if (!text) {
    return;
  }
  elements.sendTextInput.value = "";
  autosizeComposer();
  queueLiveInput({ text });
}

function bindComposerEvents() {
  elements.liveKeysToggle.addEventListener("click", () => setLiveKeys(!state.liveKeys));

  elements.sendTextInput.addEventListener("compositionend", () => {
    if (state.liveKeys) {
      drainLiveText();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!elements.specialKeyMenu.contains(event.target)) {
      closeSpecialKeyMenu();
    }
    if (!elements.editorMenu.contains(event.target)) {
      closeEditorMenu();
    }
  });

  elements.editorMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleEditorMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.editorMenuPopover.hidden) {
      closeEditorMenu();
    }
    if (event.key === "Escape" && !elements.specialKeyMenuPopover.hidden) {
      closeSpecialKeyMenu();
      elements.specialKeyMenuBtn.focus();
    }
  });

  elements.specialKeyMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSpecialKeyMenu();
  });

  elements.specialKeyMenuPopover.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-special-key-id]");
    if (!button || state.composerSending) {
      return;
    }

    const item = COMPOSER_UTILS.getSpecialKeyById(button.dataset.specialKeyId);
    if (!item) {
      return;
    }

    try {
      closeSpecialKeyMenu();
      await sendComposerKey(item.keys || item.key, item.repeat || 1);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await sendComposerShortcut();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendRawTextBtn.addEventListener("click", async () => {
    try {
      await sendComposerPayload({ appendNewline: false });
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.attachImageBtn.addEventListener("click", openImagePicker);

  elements.imageInput.addEventListener("change", async () => {
    const files = Array.from(elements.imageInput.files || []);
    elements.imageInput.value = "";
    try {
      await attachImageFiles(files);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.imageAttachment.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attachment-index]");
    if (!button || state.composerSending) {
      return;
    }
    removeImageAttachment(Number(button.dataset.attachmentIndex));
    setStatus("Pending attachment removed.", "neutral");
  });

  elements.sendTextInput.addEventListener("input", (event) => {
    if (state.liveKeys && !event.isComposing) {
      drainLiveText();
      return;
    }
    autosizeComposer();
  });

  elements.sendTextInput.addEventListener("paste", async (event) => {
    const files = getImageFilesFromDataTransfer(event.clipboardData);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    try {
      await attachImageFiles(files);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendForm.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
      event.preventDefault();
      elements.sendForm.classList.add("dragging-image");
    }
  });

  elements.sendForm.addEventListener("dragleave", () => {
    elements.sendForm.classList.remove("dragging-image");
  });

  elements.sendForm.addEventListener("drop", async (event) => {
    const files = getImageFilesFromDataTransfer(event.dataTransfer);
    elements.sendForm.classList.remove("dragging-image");
    if (!files.length) {
      return;
    }

    event.preventDefault();
    try {
      await attachImageFiles(files);
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });

  elements.sendTextInput.addEventListener("keydown", async (event) => {
    if (state.liveKeys) {
      const liveKey = COMPOSER_UTILS.getLiveKeyOnKeydown(event);
      if (liveKey) {
        event.preventDefault();
        queueLiveInput({ key: liveKey });
      }
      return;
    }

    const passthroughKey = COMPOSER_UTILS.getPassthroughKeyOnKeydown(event, elements.sendTextInput.value);
    if (passthroughKey) {
      event.preventDefault();
      try {
        await sendKey(passthroughKey);
      } catch (error) {
        setStatus(error.message, "danger");
      }
      return;
    }

    if (COMPOSER_UTILS.shouldSendWithoutEnterOnKeydown(event)) {
      event.preventDefault();
      try {
        await sendComposerPayload({ appendNewline: false });
      } catch (error) {
        setStatus(error.message, "danger");
      }
      return;
    }

    if (!COMPOSER_UTILS.shouldSubmitOnKeydown(event)) {
      return;
    }

    event.preventDefault();

    try {
      await sendComposerShortcut();
    } catch (error) {
      setStatus(error.message, "danger");
    }
  });
}
