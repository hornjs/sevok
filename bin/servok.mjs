#!/usr/bin/env node
import { main } from "../dist/cli.mjs";

globalThis.__SERVOK_BIN__ = import.meta.url;

await main({
  args: process.argv.slice(2),
  usage: {
    command: "servok",
    docs: "https://servok.pages.dev",
    issues: "https://github.com/hornjs/servok/issues",
  },
});
