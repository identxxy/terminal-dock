import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { inputNeedle, locateInputs } = require("../public/modules/input-history.js");

test("input needle is the first non-empty line, collapsed and capped", () => {
  assert.equal(inputNeedle("\n\n  fix   the\ttest\nsecond line"), "fix the test");
  assert.equal(inputNeedle("x".repeat(80)).length, 40);
  assert.equal(inputNeedle("   \n  "), "");
});

test("inputs are located in order, repeated prompts included", () => {
  const lines = [
    "$ claude",
    "> fix the failing test in tests/api.test.mjs please",
    "Working on it…",
    "> 继续",
    "Done.",
    "> 继续",
    "More.",
    ""
  ];
  const entries = [
    { text: "fix the failing test in tests/api.test.mjs please" },
    { text: "继续" },
    { text: "继续" },
    { text: "never sent to this pane" }
  ];
  assert.deepEqual(locateInputs(lines, entries), [1, 3, 5, -1]);
});

test("a prompt wrapped by a narrow terminal still matches on its first row", () => {
  const needle = "please refactor the renderer so paragraphs survive";
  const lines = ["> please refactor the rend", "erer so paragraphs survive", "ok"];
  assert.deepEqual(locateInputs(lines, [{ text: needle }]), [0]);
});

test("an older entry that scrolled off does not block later ones", () => {
  const lines = ["> second", "> third"];
  assert.deepEqual(locateInputs(lines, [{ text: "first" }, { text: "second" }, { text: "third" }]), [-1, 0, 1]);
});

test("the sent-at line stands in when the echo is not found", () => {
  const lines = ["a", "b", "c", "d", "e"];
  assert.deepEqual(locateInputs(lines, [{ text: "zzz", line: 3 }, { text: "yyy", line: 2 }, { text: "xxx", line: 9 }]), [3, -1, -1]);
  assert.deepEqual(locateInputs(lines, [{ text: "c", line: 0 }]), [2], "text wins over the line");
});
