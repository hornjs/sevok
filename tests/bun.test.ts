import { afterEach, describe, expect, it, vi } from "vitest";
import { Server } from "../src/core";
import { BunRuntimeAdapter } from "../src/bun";

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

describe("BunRuntimeAdapter", () => {
  const originalBun = (globalThis as any).Bun;
  const originalTest = process.env.TEST;

  afterEach(() => {
    if (originalBun === undefined) {
      delete (globalThis as any).Bun;
    } else {
      (globalThis as any).Bun = originalBun;
    }

    if (originalTest === undefined) {
      delete process.env.TEST;
    } else {
      process.env.TEST = originalTest;
    }

    vi.restoreAllMocks();
  });

  it("builds serve options from server config and delegates fetch", async () => {
    process.env.TEST = "1";
    const served = {
      address: { address: "0.0.0.0", family: "IPv4", port: 4321 },
      protocol: "https",
      url: new URL("https://wrong-host:4321/"),
      stop: vi.fn(),
    };
    const serve = vi.fn(() => served);
    (globalThis as any).Bun = { serve };

    const adapter = new BunRuntimeAdapter();
    const server = createServer({
      options: {
        port: 4321,
        hostname: "0.0.0.0",
        reusePort: true,
        protocol: "https",
        error: vi.fn(),
        tls: {
          cert: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
          key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
          passphrase: "secret",
        },
        bun: {
          idleTimeout: 10,
          tls: { serverName: "example.com" } as any,
        },
      },
    });

    adapter.setup(server);
    const result = await adapter.serve(server);

    expect(result).toEqual({ url: "https://wrong-host:4321/" });
    expect(serve).toHaveBeenCalledOnce();
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "0.0.0.0",
        port: 4321,
        reusePort: true,
        idleTimeout: 10,
        tls: expect.objectContaining({
          cert: server.options.tls.cert,
          key: server.options.tls.key,
          passphrase: "secret",
          serverName: "example.com",
        }),
        fetch: expect.any(Function),
      }),
    );

    const firstCall = serve.mock.calls[0];
    expect(firstCall).toBeDefined();
    const serveOptions = (firstCall as any[])[0] as {
      fetch: (request: Request) => Promise<Response>;
    };
    const fetch = serveOptions.fetch;
    const request = new Request("https://example.com/");
    await expect(fetch(request)).resolves.toBeInstanceOf(Response);
    expect(server.fetch).toHaveBeenCalledWith(request);
  });

  it("prefers server.url when address is unavailable and only serves once", async () => {
    process.env.TEST = "1";
    const served = {
      url: new URL("http://127.0.0.1:8080/"),
      stop: vi.fn(),
    };
    const serve = vi.fn(() => served);
    (globalThis as any).Bun = { serve };

    const adapter = new BunRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    expect(await adapter.serve(server)).toEqual({ url: "http://127.0.0.1:8080/" });
    expect(await adapter.serve(server)).toEqual({ url: "http://127.0.0.1:8080/" });
    expect(serve).toHaveBeenCalledTimes(1);
  });

  it("stops the active bun server and can serve again after close", async () => {
    process.env.TEST = "1";
    const first = {
      url: new URL("http://127.0.0.1:3000/"),
      stop: vi.fn(),
    };
    const second = {
      url: new URL("http://127.0.0.1:3001/"),
      stop: vi.fn(),
    };
    const serve = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    (globalThis as any).Bun = { serve };

    const adapter = new BunRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    await adapter.serve(server);
    await adapter.close(true);

    expect(first.stop).toHaveBeenCalledWith(true);

    await adapter.serve(server);
    expect(serve).toHaveBeenCalledTimes(2);
  });

  it("works with Server and exposes the adapter url through server.ready", async () => {
    process.env.TEST = "1";
    const served = {
      url: new URL("http://127.0.0.1:9090/"),
      stop: vi.fn(),
    };
    (globalThis as any).Bun = { serve: vi.fn(() => served) };

    const server = new Server({
      adapter: new BunRuntimeAdapter(),
      middleware: [],
      manual: true,
      fetch: async (ctx) => new Response(`bun:${new URL(ctx.request.url).pathname}`),
    });

    await server.serve();
    await expect(server.ready()).resolves.toBe(server);
    expect(server.url).toBe("http://127.0.0.1:9090/");
    await expect(
      server.fetch(new Request("http://example.com/ok")).then((response) => response.text()),
    ).resolves.toBe("bun:/ok");

    await server.close();
    expect(served.stop).toHaveBeenCalledWith(false);
  });
});
