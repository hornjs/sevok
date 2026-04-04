import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/bun.ts",
    "./src/cli.ts",
    "./src/deno.ts",
    "./src/index.ts",
    "./src/log.ts",
    "./src/node.ts",
    "./src/static.ts",
    "./src/stream.ts",
  ],
  dts: { tsgo: true },
});
