// Memory and disk of the connected target's host, in the top bar (and the
// Sessions head on a phone, where the top bar is hidden), refreshed every
// minute so it is visible before one terminal too many fills the machine.

const HOST_STATS_INTERVAL_MS = 60 * 1000;

let hostStatsLoaded = { targetId: "", at: 0 };

function formatGiB(bytes) {
  const value = bytes / 2 ** 30;
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function usageLevel(fraction, warn, danger) {
  return fraction >= danger ? "danger" : fraction >= warn ? "warning" : "";
}

function renderHostStats(data) {
  const targets = [elements.hostStats, elements.sessionsHostStats];
  if (!data || !data.memTotal) {
    targets.forEach((element) => {
      element.hidden = true;
    });
    return;
  }
  const memUsed = (data.memTotal - data.memAvailable) / data.memTotal;
  const diskUsed = data.diskTotal ? (data.diskTotal - data.diskFree) / data.diskTotal : 0;
  const level = usageLevel(memUsed, 0.85, 0.95) === "danger" || usageLevel(diskUsed, 0.9, 0.97) === "danger"
    ? "danger"
    : usageLevel(memUsed, 0.85, 0.95) || usageLevel(diskUsed, 0.9, 0.97);
  const html = `
    <span class="host-stats-host">${escapeHtml(data.host)}</span>
    <span class="host-stats-item ${usageLevel(memUsed, 0.85, 0.95)}">mem ${formatGiB(data.memTotal - data.memAvailable)}/${formatGiB(data.memTotal)}G</span>
    <span class="host-stats-item ${usageLevel(diskUsed, 0.9, 0.97)}">disk ${Math.round(diskUsed * 100)}%</span>
  `;
  const checked = data.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const title = `${data.host}\nMemory: ${formatGiB(data.memAvailable)} GiB available of ${formatGiB(data.memTotal)} GiB\n` +
    `Disk ${data.diskPath}: ${formatGiB(data.diskFree)} GiB free of ${formatGiB(data.diskTotal)} GiB\nChecked ${checked}`;
  targets.forEach((element) => {
    element.innerHTML = html;
    element.title = title;
    element.dataset.level = level;
    element.hidden = false;
  });
}

// Called after every session refresh and once a minute; fetches only when the
// target changed or the last reading is a minute old.
async function refreshHostStats() {
  const targetId = state.selectedTargetId;
  if (!targetId) {
    renderHostStats(null);
    return;
  }
  if (hostStatsLoaded.targetId === targetId && Date.now() - hostStatsLoaded.at < HOST_STATS_INTERVAL_MS - 2000) {
    return;
  }
  hostStatsLoaded = { targetId, at: Date.now() };
  try {
    const data = await apiFetch(`/api/host-stats?${new URLSearchParams({ targetId })}`);
    if (state.selectedTargetId === targetId) {
      renderHostStats(data);
    }
  } catch (error) {
    hostStatsLoaded.at = 0;
  }
}

function bindHostStatsEvents() {
  setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshHostStats().catch(() => {});
    }
  }, HOST_STATS_INTERVAL_MS);
}
