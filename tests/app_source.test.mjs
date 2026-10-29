import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const APP_DIR = new URL("../public/app/", import.meta.url);

async function readAppSources() {
  const names = (await readdir(APP_DIR)).filter((name) => name.endsWith(".js")).sort();
  return Promise.all(names.map(async (name) => ({ name, source: await readFile(new URL(name, APP_DIR), "utf8") })));
}

// public/app/*.js are classic scripts sharing one global scope: a second
// top-level declaration of the same name in any file silently replaces the
// first (or throws for let/const), which is how a stale copy of a function
// once overrode its rewrite. Keep every top-level name unique across files.
test("app/*.js declare each top-level name once across all files", async () => {
  const seen = new Map();
  const duplicates = [];
  for (const { name, source } of await readAppSources()) {
    for (const match of source.matchAll(/^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(match[1])) {
        duplicates.push(`${match[1]} in ${name} and ${seen.get(match[1])}`);
      }
      seen.set(match[1], name);
    }
  }
  assert.deepEqual(duplicates, []);
  assert.ok(seen.size > 200, `expected a full parse, saw ${seen.size} declarations`);
});

test("index.html loads every app file in order and every module app/*.js reads from window", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const sources = await readAppSources();
  const loadedApp = [...html.matchAll(/<script src="\/app\/([\w-]+)\.js\?v=[^"]+"><\/script>/g)].map((match) => match[1]);
  assert.deepEqual([...loadedApp].sort(), sources.map(({ name }) => name.replace(/\.js$/, "")));
  assert.equal(loadedApp[0], "core");
  assert.equal(loadedApp.at(-1), "main");

  const globals = sources.flatMap(({ source }) => [...source.matchAll(/window\.(KRD\w+)/g)].map((match) => match[1]));
  const loadedModules = [...html.matchAll(/<script src="\/modules\/([\w-]+)\.js\?v=[^"]+"><\/script>/g)].map((match) => match[1]);
  const appIndex = html.indexOf('<script src="/app/');
  for (const name of new Set(globals)) {
    const file = name.replace(/^KRD/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    assert.ok(loadedModules.includes(file), `${name} needs /modules/${file}.js in index.html`);
    assert.ok(html.indexOf(`/modules/${file}.js`) < appIndex, `/modules/${file}.js must load before app/*.js`);
  }
});
