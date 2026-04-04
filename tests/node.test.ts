import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Server } from "../src/core";

const { httpCreateServer, httpsCreateServer, http2CreateSecureServer, printListening } = vi.hoisted(
  () => ({
    httpCreateServer: vi.fn(),
    httpsCreateServer: vi.fn(),
    http2CreateSecureServer: vi.fn(),
    printListening: vi.fn(),
  }),
);

vi.mock("node:http", () => ({
  default: { createServer: httpCreateServer },
  createServer: httpCreateServer,
  IncomingMessage: class {},
  ServerResponse: class {},
}));

vi.mock("node:https", () => ({
  default: { createServer: httpsCreateServer },
  createServer: httpsCreateServer,
}));

vi.mock("node:http2", () => ({
  default: { createSecureServer: http2CreateSecureServer },
  createSecureServer: http2CreateSecureServer,
}));

vi.mock("../src/_node_like", async () => {
  const actual = await vi.importActual<typeof import("../src/_node_like")>("../src/_node_like");
  return {
    ...actual,
    printListening,
  };
});

import { NodeRuntimeAdapter } from "../src/node";

function createNodeServer(address: string | { address: string; port: number }, listening = true) {
  return {
    listen: vi.fn((_: unknown, callback: () => void) => callback()),
    address: vi.fn(() => address),
    close: vi.fn((callback: (error?: Error) => void) => callback()),
    closeAllConnections: vi.fn(),
    listening,
  };
}

function createServer(overrides: Record<string, unknown> = {}) {
  return {
    options: {
      fetch: vi.fn(async () => new Response("ok")),
      middleware: [],
      port: 3000,
      hostname: "127.0.0.1",
      ...(overrides.options as any),
    },
    fetch: vi.fn(async (_request: Request) => new Response("ok")),
    ...overrides,
  } as any;
}

describe("NodeRuntimeAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates an http server and converts requests to fetch Request objects", async () => {
    const nodeServer = createNodeServer({ address: "127.0.0.1", port: 3000 });
    httpCreateServer.mockReturnValue(nodeServer);
    const fetch = vi.fn(
      async () =>
        new Response("done", {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "text/plain", "x-result": "ok" },
        }),
    );
    const adapter = new NodeRuntimeAdapter();
    const server = createServer({
      fetch,
    });

    adapter.setup(server);
    const serveResult = await adapter.serve(server);

    expect(serveResult).toEqual({ url: "http://127.0.0.1:3000/" });
    expect(httpCreateServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3000,
        host: "127.0.0.1",
        exclusive: true,
      }),
      expect.any(Function),
    );
    expect(printListening).toHaveBeenCalledWith(server.options, "http://127.0.0.1:3000/");

    const handler = httpCreateServer.mock.calls[0][1];
    const request = Object.assign(Readable.from([Buffer.from("payload")]), {
      method: "POST",
      url: "/hello",
      headers: {
        host: "example.com",
        "x-test": "1",
        "x-multi": ["a", "b"],
      },
      socket: { encrypted: false },
    });
    const response = {
      statusCode: 0,
      statusMessage: "",
      setHeader: vi.fn(),
      end: vi.fn(),
    };

    await handler(request, response);

    expect(server.fetch).toHaveBeenCalledOnce();
    const firstCall = fetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    const nextRequest = (firstCall as Request[])[0] as Request;
    expect(nextRequest.url).toBe("http://example.com/hello");
    expect(nextRequest.method).toBe("POST");
    expect(nextRequest.headers.get("x-test")).toBe("1");
    expect(nextRequest.headers.get("x-multi")).toBe("a, b");
    expect(await nextRequest.text()).toBe("payload");
    expect(response.statusCode).toBe(201);
    expect(response.statusMessage).toBe("Created");
    expect(response.setHeader).toHaveBeenCalledWith("content-type", "text/plain");
    expect(response.setHeader).toHaveBeenCalledWith("x-result", "ok");
    expect(response.end).toHaveBeenCalledWith(Buffer.from("done"));
  });

  it("uses https when tls is configured and falls back to a socket url string", async () => {
    const nodeServer = createNodeServer("/tmp/server.sock");
    httpsCreateServer.mockReturnValue(nodeServer);
    const adapter = new NodeRuntimeAdapter();
    const server = createServer({
      options: {
        protocol: "https",
        tls: {
          cert: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
          key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
        },
        node: { http2: false },
      },
    });

    adapter.setup(server);

    expect(await adapter.serve(server)).toEqual({ url: "/tmp/server.sock" });
    expect(httpsCreateServer).toHaveBeenCalledWith(
      expect.objectContaining({
        cert: server.options.tls.cert,
        key: server.options.tls.key,
      }),
      expect.any(Function),
    );
  });

  it("creates an http2 secure server when requested", () => {
    http2CreateSecureServer.mockReturnValue(createNodeServer({ address: "::1", port: 8443 }));
    const adapter = new NodeRuntimeAdapter();
    const server = createServer({
      options: {
        protocol: "https",
        tls: {
          cert: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
          key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
        },
        node: { http2: true },
      },
    });

    adapter.setup(server);

    expect(http2CreateSecureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        allowHTTP1: true,
        cert: server.options.tls.cert,
        key: server.options.tls.key,
        http2: true,
      }),
      expect.any(Function),
    );
  });

  it("rejects insecure http2 setup", () => {
    const adapter = new NodeRuntimeAdapter();
    const server = createServer({
      options: {
        node: { http2: true },
      },
    });

    expect(() => adapter.setup(server)).toThrow("node.http2 option requires tls certificate!");
  });

  it("uses the error handler when request conversion or fetch fails", async () => {
    const nodeServer = createNodeServer({ address: "127.0.0.1", port: 3000 });
    httpCreateServer.mockReturnValue(nodeServer);
    const error = vi.fn(async () => new Response("handled", { status: 502 }));
    const adapter = new NodeRuntimeAdapter();
    const server = createServer({
      options: { error },
      fetch: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    adapter.setup(server);
    await adapter.serve(server);

    const handler = httpCreateServer.mock.calls[0][1];
    const request = Object.assign(Readable.from([]), {
      method: "GET",
      url: "/",
      headers: { host: "example.com" },
      socket: { encrypted: false },
    });
    const response = {
      statusCode: 0,
      statusMessage: "",
      setHeader: vi.fn(),
      end: vi.fn(),
    };

    await handler(request, response);

    expect(error).toHaveBeenCalled();
    expect(response.statusCode).toBe(502);
    expect(response.end).toHaveBeenCalledWith(Buffer.from("handled"));
  });

  it("closes active connections when requested", async () => {
    const nodeServer = createNodeServer({ address: "127.0.0.1", port: 3000 });
    httpCreateServer.mockReturnValue(nodeServer);
    const adapter = new NodeRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    await adapter.serve(server);
    await adapter.close(true);

    expect(nodeServer.closeAllConnections).toHaveBeenCalledOnce();
    expect(nodeServer.close).toHaveBeenCalledOnce();
  });

  it("resolves close immediately when the server is not listening", async () => {
    const nodeServer = createNodeServer({ address: "127.0.0.1", port: 3000 }, false);
    httpCreateServer.mockReturnValue(nodeServer);
    const adapter = new NodeRuntimeAdapter();
    const server = createServer();

    adapter.setup(server);
    await expect(adapter.close(false)).resolves.toBeUndefined();
    expect(nodeServer.close).not.toHaveBeenCalled();
  });

  it("works with Server and exposes the listening url after ready", async () => {
    const nodeServer = createNodeServer({ address: "127.0.0.1", port: 5050 });
    httpCreateServer.mockReturnValue(nodeServer);

    const server = new Server({
      adapter: new NodeRuntimeAdapter(),
      manual: true,
      middleware: [],
      fetch: async (ctx) => new Response(`node:${new URL(ctx.request.url).pathname}`),
    });

    await server.serve();
    await expect(server.ready()).resolves.toBe(server);
    expect(server.url).toBe("http://127.0.0.1:5050/");
    await expect(
      server.fetch(new Request("http://example.com/ok")).then((response) => response.text()),
    ).resolves.toBe("node:/ok");

    await server.close();
    expect(nodeServer.close).toHaveBeenCalledOnce();
  });
});
