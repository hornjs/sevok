import { describe, expect, it, vi } from "vitest";
import {
  Server,
  createContextKey,
  createWaitUntil,
  InvocationContext,
  loadServerAdapter,
  raceRequestAbort,
  runMiddleware,
  toServerHandlerObject,
  wrapFetch,
} from "../src/core";
import { handleRequestEntry } from "../src/stream";

function createAdapter(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {
      resolve: async () => null,
      open: async () => null,
      createGzip: async () => new TransformStream(),
      createBrotliCompress: async () => new TransformStream(),
    },
    setup: vi.fn(),
    serve: vi.fn(async () => ({ url: "http://localhost:3000/" })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("InvocationContext", () => {
  it("reads default values and stores explicit values", () => {
    const key = createContextKey("default");
    const context = new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    });

    expect(context.get(key)).toBe("default");
    expect(context.has(key)).toBe(false);

    context.set(key, "set");

    expect(context.has(key)).toBe(true);
    expect(context.get(key)).toBe("set");
  });

  it("throws when a key without default has not been set", () => {
    const key = createContextKey<string>();

    expect(() => new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    }).get(key)).toThrow("Missing default value");
  });
});

describe("toServerHandlerObject", () => {
  it("wraps bare handlers and keeps handler objects unchanged", () => {
    const fn = vi.fn();
    const obj = { handleRequest: vi.fn(), middleware: [] };

    expect(toServerHandlerObject(fn)).toEqual({ handleRequest: fn });
    expect(toServerHandlerObject(obj)).toBe(obj);
  });
});

describe("raceRequestAbort", () => {
  it("resolves the promise when the request stays active", async () => {
    await expect(
      raceRequestAbort(Promise.resolve("ok"), new Request("http://localhost/")),
    ).resolves.toBe("ok");
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("aborted"));
    const request = new Request("http://localhost/", { signal: controller.signal });

    expect(() => raceRequestAbort(Promise.resolve("ok"), request)).toThrow("aborted");
  });
});

describe("createWaitUntil", () => {
  it("waits for registered promises", async () => {
    const deferred = Promise.withResolvers<void>();
    const waiter = createWaitUntil();
    let done = false;

    waiter.waitUntil(
      deferred.promise.then(() => {
        done = true;
      }),
    );

    deferred.resolve();
    await waiter.wait();

    expect(done).toBe(true);
  });

  it("logs and swallows rejected promises", async () => {
    const waiter = createWaitUntil();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    waiter.waitUntil(Promise.reject(new Error("boom")));
    await waiter.wait();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("removes the tracked promise entry after it settles", async () => {
    const RealSet = globalThis.Set;
    const createdSets: Array<{
      added: Promise<unknown>[];
      deleted: Promise<unknown>[];
    }> = [];

    class TrackingSet<T> extends RealSet<T> {
      added: T[] = [];
      deleted: T[] = [];

      constructor(values?: Iterable<T> | null) {
        super(values);
        createdSets.push(this as unknown as {
          added: Promise<unknown>[];
          deleted: Promise<unknown>[];
        });
      }

      override add(value: T) {
        this.added.push(value);
        return super.add(value);
      }

      override delete(value: T) {
        this.deleted.push(value);
        return super.delete(value);
      }
    }

    globalThis.Set = TrackingSet as typeof Set;

    try {
      const waiter = createWaitUntil();
      const trackedSet = createdSets.at(-1);

      waiter.waitUntil(Promise.resolve("ok"));
      await waiter.wait();

      expect(trackedSet?.added).toHaveLength(1);
      expect(trackedSet?.deleted).toHaveLength(1);
      expect(trackedSet?.deleted[0]).toBe(trackedSet?.added[0]);
    } finally {
      globalThis.Set = RealSet;
    }
  });
});

describe("runMiddleware", () => {
  it("runs middleware in order and then the terminal handler", async () => {
    const calls: string[] = [];
    const context = new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    });
    const response = await runMiddleware(
      context,
      [
        async (ctx, next) => {
          calls.push(`a:${ctx.request.url}`);
          return next(ctx);
        },
        async (ctx, next) => {
          calls.push("b");
          return next(ctx);
        },
      ],
      async () => {
        calls.push("handler");
        return new Response("ok");
      },
    );

    expect(await response.text()).toBe("ok");
    expect(calls).toEqual(["a:http://localhost/", "b", "handler"]);
  });

  it("runs terminal middleware from handler objects", async () => {
    const calls: string[] = [];
    const context = new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    });
    const response = await runMiddleware(
      context,
      [
        async (ctx, next) => {
          calls.push("outer");
          return next(ctx);
        },
      ],
      {
        middleware: [
          async (ctx, next) => {
            calls.push("inner");
            return next(ctx);
          },
        ],
        handleRequest: async () => {
          calls.push("handler");
          return new Response("ok");
        },
      },
    );

    expect(await response.text()).toBe("ok");
    expect(calls).toEqual(["outer", "inner", "handler"]);
  });

  it("throws when next is called multiple times", async () => {
    const context = new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    });

    await expect(
      runMiddleware(
        context,
        [
          async (ctx, next) => {
            await next(ctx);
            return next(ctx);
          },
        ],
        async () => new Response("ok"),
      ),
    ).rejects.toThrow("next() called multiple times");
  });

  it("rejects when the request was aborted before middleware executes", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const context = new InvocationContext({
      request: new Request("http://localhost/", { signal: controller.signal }),
      capabilities: {} as any,
      params: {},
    });

    await expect(runMiddleware(context, [], async () => new Response("ok"))).rejects.toThrow(
      "stopped",
    );
  });
});

describe("wrapFetch", () => {
  it("returns the original fetch handler when middleware is empty", () => {
    const fetch = vi.fn(async () => new Response("ok"));

    expect(wrapFetch({ options: { fetch, middleware: [] } } as any)).toBe(fetch);
  });

  it("returns a middleware runner when middleware is present", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const wrapped = wrapFetch({
      options: {
        fetch,
        middleware: [async (ctx: any, next: any) => next(ctx)],
      },
    } as any);

    const context = new InvocationContext({
      request: new Request("http://localhost/"),
      capabilities: {} as any,
      params: {},
    });
    const response = await wrapped(context);

    expect(await response.text()).toBe("ok");
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("loadServerAdapter", () => {
  it("loads the Node adapter from the package's node subpath", async () => {
    vi.doMock("sevok/node", async () => {
      return {
        NodeRuntimeAdapter: class {
          marker = "sevok";
        },
      };
    });

    try {
      const adapter = await loadServerAdapter();

      expect(adapter).toMatchObject({ marker: "sevok" });
    } finally {
      vi.doUnmock("sevok/node");
    }
  });
});

describe("Server", () => {
  it("calls setup immediately and serve automatically unless manual", () => {
    const adapter = createAdapter();
    new Server({ adapter: adapter as any, fetch: () => new Response("ok"), middleware: [] });

    expect(adapter.setup).toHaveBeenCalledOnce();
    expect(adapter.serve).toHaveBeenCalledOnce();
  });

  it("attaches context, capabilities, and waitUntil in fetch", async () => {
    const adapter = createAdapter();
    const server = new Server({
      adapter: adapter as any,
      fetch: async (ctx: any) => {
        expect(ctx).toBeInstanceOf(InvocationContext);
        expect(ctx.request).toBeInstanceOf(Request);
        expect(ctx.capabilities).toBe(adapter.capabilities);
        expect(typeof ctx.waitUntil).toBe("function");
        return new Response("ok");
      },
      middleware: [],
      manual: true,
    });

    const response = await server.fetch(new Request("http://localhost/"));

    expect(await response.text()).toBe("ok");
  });

  it("creates a context directly from the server", () => {
    const adapter = createAdapter();
    const server = new Server({
      adapter: adapter as any,
      fetch: async () => new Response("ok"),
      middleware: [],
      manual: true,
    });
    const request = new Request("http://localhost/users/42");
    const context = server.createContext(request);

    expect(context).toBeInstanceOf(InvocationContext);
    expect(context.request).toBe(request);
    expect(context.capabilities).toBe(adapter.capabilities);
    expect(typeof context.waitUntil).toBe("function");
    expect(context.params).toEqual({});
  });

  it("exposes route params in context", async () => {
    const adapter = createAdapter();
    const server = new Server({
      adapter: adapter as any,
      middleware: [],
      manual: true,
      routes: {
        "/users/:id": (ctx) => {
          expect(ctx.params).toEqual({ id: "42" });
          expect(ctx.request).toBeInstanceOf(Request);
          expect(ctx.request.headers.get("x-test")).toBe("1");

          return new Response("ok");
        },
      },
      fetch: () => new Response("Not Found", { status: 404 }),
    });

    const response = await server.fetch(
      new Request("http://localhost/users/42", {
        headers: { "x-test": "1" },
      }),
    );

    expect(await response.text()).toBe("ok");
  });

  it("handles request entries through completeWith", async () => {
    const adapter = createAdapter();
    const server = new Server({
      adapter: adapter as any,
      fetch: async () => new Response("ok"),
      middleware: [],
      manual: true,
    });
    const completeWith = vi.fn();

    handleRequestEntry(server, {
      request: new Request("http://localhost/"),
      completeWith,
      waitUntil: vi.fn(),
    });

    expect(completeWith).toHaveBeenCalledOnce();
    await expect(completeWith.mock.calls[0][0]).resolves.toBeInstanceOf(Response);
  });

  it("routes sync and async handler failures through the configured error handler", async () => {
    const error = vi.fn(async (cause: unknown) => new Response(String((cause as Error).message)));
    const adapter = createAdapter();
    const syncServer = new Server({
      adapter: adapter as any,
      fetch: () => {
        throw new Error("sync");
      },
      error,
      middleware: [],
      manual: true,
    });
    const asyncServer = new Server({
      adapter: adapter as any,
      fetch: async () => {
        throw new Error("async");
      },
      error,
      middleware: [],
      manual: true,
    });

    await expect(
      syncServer.fetch(new Request("http://localhost/")).then((response) => response.text()),
    ).resolves.toBe("sync");
    await expect(
      asyncServer.fetch(new Request("http://localhost/")).then((response) => response.text()),
    ).resolves.toBe("async");
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("serves once, exposes the url, and makes ready resolve to the server", async () => {
    const adapter = createAdapter();
    const server = new Server({
      adapter: adapter as any,
      fetch: () => new Response("ok"),
      middleware: [],
    } as any);

    await server.serve();
    expect(server.url).toBe("http://localhost:3000/");
    expect(await server.ready()).toBe(server);

    await server.serve();
    expect(adapter.serve).toHaveBeenCalledOnce();
  });

  it("throws when ready is called before serve", async () => {
    const server = new Server({
      adapter: createAdapter() as any,
      fetch: () => new Response("ok"),
      middleware: [],
      manual: true,
    });

    await expect(server.ready()).rejects.toThrow("Call serve() first");
  });

  it("throws when ready is called before serve during deferred adapter resolution", async () => {
    const deferred = Promise.withResolvers<void>();
    const adapter = createAdapter();

    vi.doMock("sevok/node", async () => {
      await deferred.promise;

      return {
        NodeRuntimeAdapter: class {
          capabilities = adapter.capabilities;
          setup = adapter.setup;
          serve = adapter.serve;
          close = adapter.close;
        },
      };
    });

    try {
      const server = new Server({
        fetch: () => new Response("ok"),
        middleware: [],
        manual: true,
      });

      const ready = server.ready();
      deferred.resolve();

      await expect(ready).rejects.toThrow("Call serve() first");
      expect(adapter.serve).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("sevok/node");
    }
  });

  it("rejects ready with AbortError when closed before serve settles", async () => {
    const deferred = Promise.withResolvers<{ url: string | undefined }>();
    const adapter = createAdapter({
      serve: vi.fn(() => deferred.promise),
    });
    const server = new Server({
      adapter: adapter as any,
      fetch: () => new Response("ok"),
      middleware: [],
      manual: true,
    });

    server.serve();
    const ready = server.ready();
    await server.close();

    await expect(ready).rejects.toMatchObject({ name: "AbortError" });
  });
});
