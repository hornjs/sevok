import { afterEach, describe, expect, it, vi } from "vitest";
import { Server } from "../src/core";
import { DenoRuntimeAdapter } from "../src/deno";

function createServer(overrides: Record<string, unknown> = {}) {
  return {
    options: {
      fetch: vi.fn(async () => new Response("ok")),
      middleware: [],
      port: 3000,
      hostname: "127.0.0.1",
      ...(overrides.options as any),
    },
    fetch: vi.fn(async (request: Request) => new Response(request.url)),
    ...overrides,
  } as any;
}

describe("DenoRuntimeAdapter", () => {
  const originalDeno = (globalThis as any).Deno;
  const originalTest = process.env.TEST;

  afterEach(() => {
    if (originalDeno === undefined) {
      delete (globalThis as any).Deno;
    } else {
      (globalThis as any).Deno = originalDeno;
    }

    if (originalTest === undefined) {
      delete process.env.TEST;
    } else {
      process.env.TEST = originalTest;
    }

    vi.restoreAllMocks();
  });

  it("builds serve options, resolves url from onListen, and delegates fetch", async () => {
    process.env.TEST = "1";
    const shutdown = vi.fn();
    const onListen = vi.fn();
    const serve = vi.fn((options, handler) => {
      options.onListen({ hostname: "0.0.0.0", port: 4123 });
      void handler(new Request("https://example.com/"));
      return { shutdown };
    });
    (globalThis as any).Deno = { serve };

    const adapter = new DenoRuntimeAdapter();
    const server = createServer({
      options: {
        port: 4123,
        hostname: "0.0.0.0",
        reusePort: true,
        error: vi.fn(),
        tls: {
          cert: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
          key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
          passphrase: "secret",
        },
        deno: { onListen } as any,
      },
    });

    adapter.setup(server);
    const result = await adapter.serve(server);

    expect(result).toEqual({ url: "https://0.0.0.0:4123/" });
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "0.0.0.0",
        port: 4123,
        reusePort: true,
        cert: server.options.tls.cert,
        key: server.options.tls.key,
        passphrase: "secret",
        onListen: expect.any(Function),
      }),
      expect.any(Function),
    );
    expect(onListen).toHaveBeenCalledWith({ hostname: "0.0.0.0", port: 4123 });
    expect(server.fetch).toHaveBeenCalledWith(expect.any(Request));
  });

  it("reuses the same listening promise on repeated serve calls", async () => {
    process.env.TEST = "1";
    let onListen: ((info: { hostname: string; port: number }) => void) | undefined;
    const serve = vi.fn((options) => {
      onListen = options.onListen;
      return { shutdown: vi.fn() };
    });
    (globalThis as any).Deno = { serve };

    const adapter = new DenoRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    const first = adapter.serve(server);
    const second = adapter.serve(server);

    onListen?.({ hostname: "127.0.0.1", port: 3000 });

    await expect(first).resolves.toEqual({ url: "http://127.0.0.1:3000/" });
    await expect(second).resolves.toEqual({ url: "http://127.0.0.1:3000/" });
    expect(serve).toHaveBeenCalledTimes(1);
  });

  it("shuts down the deno server on close", async () => {
    process.env.TEST = "1";
    const shutdown = vi.fn();
    const serve = vi.fn((options) => {
      options.onListen({ hostname: "127.0.0.1", port: 3000 });
      return { shutdown };
    });
    (globalThis as any).Deno = { serve };

    const adapter = new DenoRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    await adapter.serve(server);
    await adapter.close();

    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("works with Server and publishes the listening url after ready", async () => {
    process.env.TEST = "1";
    const shutdown = vi.fn();
    const serve = vi.fn((options, handler) => {
      options.onListen({ hostname: "127.0.0.1", port: 8081 });
      void handler(new Request("http://example.com/ping"));
      return { shutdown };
    });
    (globalThis as any).Deno = { serve };

    const server = new Server({
      adapter: new DenoRuntimeAdapter(),
      middleware: [],
      manual: true,
      fetch: async (ctx) => new Response(`deno:${new URL(ctx.request.url).pathname}`),
    });

    await server.serve();
    await expect(server.ready()).resolves.toBe(server);
    expect(server.url).toBe("http://127.0.0.1:8081/");
    await expect(
      server.fetch(new Request("http://example.com/ok")).then((response) => response.text()),
    ).resolves.toBe("deno:/ok");

    await server.close();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
