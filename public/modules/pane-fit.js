// Which size the deck asks tmux for when it fits a pane to the view.
//
// Every resize makes the program in the pane redraw. Claude Code and shells
// draw on the main screen, so each redraw pushes the old frame into the
// scrollback and a shrink in rows can cut lines for good. Full-screen apps
// (alternate screen) have no scrollback to damage and want the exact size.
//
// mode: "force" (Fit pane button) and alternate-screen panes fit exactly.
// "deliberate" (pane selected, input sent, page back in front, font change):
// columns fit exactly, rows only grow. "settle" (the view changed size on its
// own: window drag, sidebar, phone keyboard, composer growth): only narrow the
// pane when the view became narrower than it, never touch rows.
(function attachPaneFit(global) {
  function planPaneFit({ windowColumns, windowRows, viewColumns, viewRows, alternate = false, mode = "deliberate" }) {
    if (!viewColumns || !viewRows) {
      return null;
    }
    let columns = viewColumns;
    let rows = viewRows;
    if (mode !== "force" && !alternate && windowColumns && windowRows) {
      if (mode === "settle") {
        columns = Math.min(windowColumns, viewColumns);
        rows = windowRows;
      } else {
        rows = Math.max(windowRows, viewRows);
      }
    }
    if (columns === windowColumns && rows === windowRows) {
      return null;
    }
    return { columns, rows };
  }

  const api = { planPaneFit };

  global.KRDPaneFit = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
