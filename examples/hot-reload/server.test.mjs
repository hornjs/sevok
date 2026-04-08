import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("hot reload example stays ESM-compatible under native Node type stripping", async () => {
  const serverFile = fileURLToPath(new URL("./server.ts", import.meta.url));
  const source = await readFile(serverFile, "utf8");

  assert.doesNotMatch(source, /\brequire\.(cache|resolve)\b/);
});
