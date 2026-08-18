import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Render package has production entry points", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node server.js");
  assert.equal(pkg.scripts.build, "vite build");
});

test("privacy-sensitive agreement data is never posted", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const posts = [...app.matchAll(/fetch\(([^;]+method:\s*"POST"[^;]+)/gs)].map((match) => match[0]);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /sessionId/);
  assert.doesNotMatch(posts[0], /agreement|chat|audio|recording/i);
});
