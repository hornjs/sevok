#!/usr/bin/env node
import { main } from "../dist/cli.mjs";

globalThis.__SEVO_BIN__ = import.meta.url;

await main({
  args: process.argv.slice(2),
  usage: {
    command: "sevo",
    docs: "https://sevo-agz.pages.dev",
    issues: "https://github.com/hornjs/sevo/issues",
  },
});
