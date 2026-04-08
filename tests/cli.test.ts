import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const serveSpy = vi.fn(() => ({
  ready: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));

vi.mock("../src/core.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core.ts")>();

  return {
    ...actual,
    loadRuntimeAdapter: vi.fn(async () => ({
      capabilities: {},
      setup: vi.fn(),
      serve: vi.fn(async () => ({ url: "http://localhost:3000/" })),
      close: vi.fn(async () => {}),
    })),
    serve: serveSpy,
  };
});

vi.mock("sevok/static", () => ({
  serveStatic: vi.fn(() => undefined),
}));

vi.mock("sevok/log", () => ({
  log: vi.fn(() => undefined),
}));

describe("cliServe", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    serveSpy.mockClear();
    vi.restoreAllMocks();

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("inherits server options from a default-exported handler object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sevok-cli-test-"));
    tempDirs.push(dir);

    await writeFile(
      join(dir, "server.mjs"),
      `const handler = () => new Response("ok");
handler.port = "4321";
handler.hostname = "127.0.0.1";
export default handler;
export const fetch = handler;
`,
    );

    const { cliServe } = await import("../src/cli.ts");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await cliServe({ entry: "server.mjs", dir });
    } finally {
      log.mockRestore();
    }

    expect(serveSpy).toHaveBeenCalledOnce();
    expect(serveSpy).toHaveBeenCalledWith(expect.objectContaining({
      port: "4321",
      hostname: "127.0.0.1",
      fetch: expect.any(Function),
    }));
  });
});
