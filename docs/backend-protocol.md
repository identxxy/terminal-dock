# Backend protocol

Generated from `server/backend_contract.js` by `node scripts/backend-protocol.mjs`; do not edit by hand.

A backend is an action table in `server/remote_helper.py`, registered in `BACKENDS` and selected by `payload.backend`. The server runs the helper as one process per action (`python3 - <action> <base64 payload>`, locally or over ssh) and reads one JSON object from stdout:

```json
{ "ok": true, "data": { ...result } }
{ "ok": false, "error": "message" }
```

Every payload carries the target fields below in addition to the action's own fields. `socket` names the terminal server socket; an empty value means "the default or the most recent one".

| field | type | |
| --- | --- | --- |
| `backend` | string | required |
| `kittyBinary` | string | optional |
| `tmuxBinary` | string | optional |
| `socketPattern` | string | optional |
| `defaultSocket` | string | optional |

A backend must implement: `test`, `list_sessions`, `get_screen`, `scroll_window`, `send_text`, `send_key`, `focus_window`, `create_panel`, `close_panel`. The shared actions (`fetch_url`, `fetch_url_resource`) are implemented once for every backend. `describe_window`, `resize_window` and `toggle_zoom` are optional; the server only calls them for backends that advertise them. The `mock` backend is the reference implementation and what `tests/backend_contract.test.mjs` runs.

## Actions

### `test`

Connect/Test: discover sockets and count sessions without selecting a pane. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |

Result:

| field | type | |
| --- | --- | --- |
| `host` | string | required |
| `user` | string | required |
| `socketPattern` | string | required |
| `sockets` | string[] | required |
| `selectedSocket` | string | required |
| `sessionCount` | int | required |
| `windowCount` | int | required |
| `checkedAt` | string | required |
| `backend` | string | optional |
| `labels` | [labels](#shape-labels) | optional |

### `list_sessions`

The session tree for one socket. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |

Result:

| field | type | |
| --- | --- | --- |
| `backend` | string | required |
| `sockets` | string[] | required |
| `selectedSocket` | string | required |
| `tree` | [osWindow](#shape-oswindow)[] | required |
| `discoveredAt` | string | required |
| `labels` | [labels](#shape-labels) | optional |

### `get_screen`

Pane text. `extent` is `screen` (the live viewport, `scrollOffset` lines back) or `all` (viewport plus scrollback). tmux Screen extent also returns the whole window as `window` + `panes`. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |
| `extent` | string | required |
| `scrollOffset` | int | optional |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `text` | string | required |
| `format` | string | required |
| `scrollOffset` | int | optional |
| `window` | [windowGeometry](#shape-windowgeometry) | optional |
| `panes` | [layoutPane](#shape-layoutpane)[] | optional |

### `scroll_window`

Scroll the pane's viewport by `lines` (negative = into history) or to the end, then return the viewport text. tmux keeps the offset in `scrollOffset`; `alternateScreen` says the app scrolled itself. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |
| `lines` | int | required |
| `toEnd` | bool | required |
| `scrollOffset` | int | optional |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `lines` | int | required |
| `text` | string | required |
| `format` | string | required |
| `scrollOffset` | int | optional |
| `alternateScreen` | bool | optional |

### `send_text`

Type `text` into the pane verbatim (bracketed paste when the app supports it), then Enter if `appendNewline`. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |
| `text` | string | required |
| `appendNewline` | bool | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `sentLength` | int | required |

### `send_key`

Press `keys` as a chord (kitty key names: enter, escape, ctrl+c, ...), or `key` `repeat` times. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |
| `key` | string | required |
| `keys` | string[] | required |
| `repeat` | int | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `key` | string | required |
| `keys` | string[] | required |
| `repeat` | int | required |

### `focus_window`

Make the pane the active one in its window/tab. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |

### `create_panel`

Create a `window` (top level, started at home), a `tab` next to `sourceWindowId`, or a `split` of it inside `tabId`; returns the new pane id. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `kind` | string | required |
| `sourceWindowId` | int | optional |
| `tabId` | int | optional |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `kind` | string | required |
| `windowId` | int | required |
| `sourceWindowId` | int | optional |
| `tabId` | int | optional |

### `close_panel`

Close a `session` (tmux only), `tab` or `pane` by id. Backends: every backend.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `kind` | string | required |
| `id` | int | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `kind` | string | required |
| `id` | int | required |

### `describe_window`

Where a pane lives, so the server can attach a control-mode watcher to its session for live events. Backends: tmux, mock.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `sessionId` | string | required |
| `sessionName` | string | required |
| `tmuxWindowId` | string | required |
| `paneId` | string | required |
| `tmuxBinary` | string | required |

### `resize_window`

Resize the pane's window to the browser's cell grid. Attached sessions are skipped unless `force`, which pins window-size to manual. Backends: tmux, mock.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |
| `columns` | int | required |
| `rows` | int | required |
| `force` | bool | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `attached` | bool | required |
| `columns` | int | required |
| `rows` | int | required |
| `requestedColumns` | int | required |
| `requestedRows` | int | required |
| `skipped` | bool | optional |
| `reason` | string | optional |
| `zoomed` | bool | optional |
| `paneCount` | int | optional |
| `manualSize` | bool | optional |

### `toggle_zoom`

prefix-z: zoom the pane or unzoom its window. Backends: tmux, mock.

Payload:

| field | type | |
| --- | --- | --- |
| `socket` | string | optional |
| `windowId` | int | required |

Result:

| field | type | |
| --- | --- | --- |
| `socket` | string | required |
| `windowId` | int | required |
| `zoomed` | bool | required |

### `fetch_url`

Fetch a file://, http:// or https:// URL from the target host for the Browser (whole body, size-capped). Backends: shared (any host, no terminal needed).

Payload:

| field | type | |
| --- | --- | --- |
| `url` | string | required |

Result:

A [fetched](#shape-fetched).

### `fetch_url_resource`

Same with an HTTP `range` header honoured, for media playback. Backends: shared (any host, no terminal needed).

Payload:

| field | type | |
| --- | --- | --- |
| `url` | string | required |
| `range` | string | optional |

Result:

A [fetched](#shape-fetched).

## Shapes

### Shape: labels

UI names for the three tree levels and the create buttons.

| field | type | |
| --- | --- | --- |
| `osWindow` | string | required |
| `tab` | string | required |
| `window` | string | required |
| `createWindow` | string | required |
| `createTab` | string | required |
| `createSplit` | string | required |

### Shape: osWindow

Top level of the tree (kitty OS window, tmux session).

| field | type | |
| --- | --- | --- |
| `id` | int | required |
| `title` | string | optional |
| `is_focused` | bool | required |
| `tabs` | [tab](#shape-tab)[] | required |

### Shape: tab

Middle level (kitty tab, tmux window).

| field | type | |
| --- | --- | --- |
| `id` | int | required |
| `title` | string | optional |
| `is_focused` | bool | required |
| `layout` | string | optional |
| `windows` | [window](#shape-window)[] | required |

### Shape: window

Selectable pane. `id` is what every pane action's `windowId` names; tmux ids start at 0.

| field | type | |
| --- | --- | --- |
| `id` | int | required |
| `title` | string | optional |
| `cwd` | string | optional |
| `is_active` | bool | required |
| `is_focused` | bool | required |
| `is_attached` | bool | optional |
| `alternate_on` | bool | optional |
| `zoomed` | bool | optional |
| `at_prompt` | bool | optional |
| `columns` | int | optional |
| `lines` | int | optional |
| `window_columns` | int | optional |
| `window_lines` | int | optional |
| `pane_count` | int | optional |
| `cmdline` | string[] | optional |
| `foreground_processes` | object[] | optional |

### Shape: windowGeometry

Size of the tmux window that holds the selected pane (Screen extent only).

| field | type | |
| --- | --- | --- |
| `columns` | int | required |
| `rows` | int | required |
| `zoomed` | bool | required |

### Shape: layoutPane

One pane drawn in place inside the window (Screen extent only).

| field | type | |
| --- | --- | --- |
| `id` | int | required |
| `left` | int | required |
| `top` | int | required |
| `columns` | int | required |
| `rows` | int | required |
| `active` | bool | required |
| `alternate_on` | bool | required |
| `title` | string | required |
| `text` | string | required |

### Shape: fetched

A fetched URL. `body`/`encoding` are present for text-like content types; the server rewrites HTML and CSS.

| field | type | |
| --- | --- | --- |
| `url` | string | required |
| `finalUrl` | string | required |
| `contentType` | string | required |
| `bodyBase64` | string | required |
| `byteLength` | int | required |
| `truncated` | bool | required |
| `fetchedAt` | string | optional |
| `body` | string | optional |
| `encoding` | string | optional |
| `statusCode` | int | optional |
| `acceptRanges` | string | optional |
| `contentRange` | string | optional |
