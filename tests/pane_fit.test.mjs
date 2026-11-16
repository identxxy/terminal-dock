import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { planPaneFit } = require("../public/modules/pane-fit.js");

const pane = { windowColumns: 160, windowRows: 50 };

test("force and alternate-screen panes fit the view exactly", () => {
  assert.deepEqual(planPaneFit({ ...pane, viewColumns: 120, viewRows: 30, mode: "force" }), { columns: 120, rows: 30 });
  assert.deepEqual(planPaneFit({ ...pane, viewColumns: 120, viewRows: 30, alternate: true, mode: "settle" }), { columns: 120, rows: 30 });
  assert.equal(planPaneFit({ ...pane, viewColumns: 160, viewRows: 50, mode: "force" }), null);
});

test("a view that changed size on its own only narrows the pane", () => {
  assert.deepEqual(planPaneFit({ ...pane, viewColumns: 120, viewRows: 30, mode: "settle" }), { columns: 120, rows: 50 });
  assert.equal(planPaneFit({ ...pane, viewColumns: 200, viewRows: 60, mode: "settle" }), null, "wider or taller: leave it");
  assert.equal(planPaneFit({ ...pane, viewColumns: 160, viewRows: 20, mode: "settle" }), null, "keyboard or composer: rows untouched");
});

test("a deliberate fit matches the columns and only grows rows", () => {
  assert.deepEqual(planPaneFit({ ...pane, viewColumns: 200, viewRows: 30, mode: "deliberate" }), { columns: 200, rows: 50 });
  assert.deepEqual(planPaneFit({ ...pane, viewColumns: 160, viewRows: 70, mode: "deliberate" }), { columns: 160, rows: 70 });
  assert.equal(planPaneFit({ ...pane, viewColumns: 160, viewRows: 30, mode: "deliberate" }), null);
});

test("a pane with no known size takes the view's", () => {
  assert.deepEqual(planPaneFit({ windowColumns: 0, windowRows: 0, viewColumns: 90, viewRows: 40, mode: "settle" }), { columns: 90, rows: 40 });
  assert.equal(planPaneFit({ ...pane, viewColumns: 0, viewRows: 0 }), null);
});
