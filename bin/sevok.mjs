#!/usr/bin/env node
import { main } from "../dist/cli.mjs";

globalThis.__SEVOK_BIN__ = import.meta.url;

await main({
  args: process.argv.slice(2),
  usage: {
    command: "sevok",
    docs: "https://sevok.pages.dev",
    issues: "https://github.com/hornjs/sevok/issues",
  },
});
