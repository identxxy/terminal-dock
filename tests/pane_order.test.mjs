import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { orderPanes, sanitizeOrders } = require("../public/modules/pane-order.js");

const panes = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];

test("saved order ranks known panes and keeps the rest in terminal order", () => {
  assert.deepEqual(orderPanes(panes, [3, 1]).map((pane) => pane.id), [3, 1, 0, 2]);
  assert.deepEqual(orderPanes(panes, ["2"]).map((pane) => pane.id), [2, 0, 1, 3]);
  assert.deepEqual(orderPanes(panes, [9, 8]).map((pane) => pane.id), [0, 1, 2, 3]);
});

test("no saved order returns a copy in terminal order", () => {
  const result = orderPanes(panes, undefined);
  assert.deepEqual(result, panes);
  assert.notEqual(result, panes);
});

test("stored orders are sanitized to numeric ids", () => {
  assert.deepEqual(sanitizeOrders({ "t|": [1, "2", "x"], bad: "no", empty: [] }), { "t|": [1, 2] });
  assert.deepEqual(sanitizeOrders(undefined), {});
});
