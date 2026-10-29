import assert from "node:assert/strict";
import test from "node:test";

import { createScreenCache, describeScreenDelta, scrollOffsetKey } from "../server/screen_cache.js";

test("describeScreenDelta sends drop/keep/tail only when the page keeps most of its text", () => {
  const before = Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n");
  const appended = `${before}\nline 50`;
  const delta = describeScreenDelta(before, appended);
  assert.equal(delta.drop, 0);
  assert.equal(delta.keep, 50);
  assert.deepEqual(delta.tail, ["line 50"]);

  const scrolled = `${before.split("\n").slice(5).join("\n")}\nnew tail`;
  assert.equal(describeScreenDelta(before, scrolled).drop, 5);

  assert.equal(describeScreenDelta(before, "entirely different"), null, "a rewrite ships as a full body");
});

test("the cache keeps the most recently served texts and evicts the oldest", () => {
  const cache = createScreenCache(2);
  cache.remember("a", "h1", "A");
  cache.remember("b", "h2", "B");
  cache.remember("a", "h3", "A2");
  cache.remember("c", "h4", "C");
  assert.equal(cache.size(), 2);
  assert.equal(cache.get("b"), undefined, "b was the least recently remembered");
  assert.deepEqual(cache.get("a"), { hash: "h3", text: "A2" });
  assert.equal(scrollOffsetKey({ id: "t" }, "", 7), "t||7");
});
