import { describe, expect, it, vi } from "vitest";
import { Server } from "../src/core";
import { StreamRuntimeAdapter, handleRequestEntry } from "../src/stream";

function createAsyncEventStream(count = 2): AsyncIterableIterator<any> {
  let index = 0;
  return {
    async next() {
      if (index >= count) {
        return { done: true, value: undefined };
      }
      index += 1;
      return {
        done: false,
        value: {
          request: new Request(`http://localhost/${index}`),
          completeWith: vi.fn(),
          waitUntil: vi.fn(),
        },
      };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

describe("StreamRuntimeAdapter", () => {
  it("exposes stream runtime capabilities", async () => {
    const adapter = new StreamRuntimeAdapter({ stream: createAsyncEventStream(0) });

    await expect(adapter.capabilities.resolve("/root", "file")).resolves.toBeNull();
    await expect(adapter.capabilities.open("/root/file")).resolves.toBeNull();
    const CompressionStreamCtor = (
      globalThis as typeof globalThis & {
        CompressionStream?: new (format: "gzip" | "deflate") => TransformStream;
      }
    ).CompressionStream;
    if (CompressionStreamCtor) {
      expect(adapter.capabilities.createGzip()).toBeInstanceOf(CompressionStreamCtor);
    } else {
      expect(() => adapter.capabilities.createGzip()).toThrow("CompressionStream");
    }
    expect(() => adapter.capabilities.createBrotliCompress()).toThrow("Brotli");
  });

  it("returns the configured url and dispatches each event once", async () => {
    const completeWithA = vi.fn();
    const completeWithB = vi.fn();
    let index = 0;
    const { InvocationContext } = await import("../src/core");
    const server = {
      fetch: vi.fn(async () => new Response("ok")),
      options: { middleware: [] },
      createContext: (request: Request) => new InvocationContext({
        request,
        capabilities: {} as any,
        params: {},
      }),
      handle: vi.fn(async () => new Response("ok")),
    } as any;
    const adapter2 = new StreamRuntimeAdapter({
      stream: {
        async next() {
          index += 1;
          if (index === 1) {
            return {
              done: false,
              value: {
                request: new Request("http://localhost/1"),
                completeWith: completeWithA,
                waitUntil: vi.fn(),
              },
            };
          }
          if (index === 2) {
            return {
              done: false,
              value: {
                request: new Request("http://localhost/2"),
                completeWith: completeWithB,
                waitUntil: vi.fn(),
              },
            };
          }
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      },
      url: "/worker",
    });

    await expect(adapter2.serve(server)).resolves.toEqual({ url: "/worker" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(completeWithA).toHaveBeenCalledOnce();
    expect(completeWithB).toHaveBeenCalledOnce();
    expect(server.handle).toHaveBeenCalledTimes(2);

    await adapter2.serve(server);
    expect(completeWithA).toHaveBeenCalledOnce();
    expect(completeWithB).toHaveBeenCalledOnce();
    expect(server.handle).toHaveBeenCalledTimes(2);
  });

  it("stops dispatching after close", async () => {
    let emitted = false;
    const completeWith = vi.fn();
    const stream: AsyncIterableIterator<any> = {
      async next() {
        if (emitted) {
          return { done: true, value: undefined };
        }
        emitted = true;
        return {
          done: false,
          value: {
            request: new Request("http://localhost/late"),
            completeWith,
            waitUntil: vi.fn(),
          },
        };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const adapter = new StreamRuntimeAdapter({ stream });
    const server = {
      fetch: vi.fn(async () => new Response("ok")),
      options: { middleware: [] },
    } as any;

    await adapter.close();
    await adapter.serve(server);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(completeWith).not.toHaveBeenCalled();
  });

  it("works with Server and completes dispatched fetch events", async () => {
    const event = {
      request: new Request("http://localhost/integration"),
      completeWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    const adapter = new StreamRuntimeAdapter({
      stream: createAsyncEventStream(0),
      url: "/stream",
    });
    const server = new Server({
      adapter,
      manual: true,
      middleware: [],
      fetch: async (ctx) => new Response(`handled:${new URL(ctx.request.url).pathname}`),
    });

    await expect(server.serve()).resolves.toBeUndefined();
    expect(server.url).toBe("/stream");

    handleRequestEntry(server, event as any);

    expect(event.completeWith).toHaveBeenCalledOnce();
    await expect(event.completeWith.mock.calls[0][0]).resolves.toMatchObject({ status: 200 });
    await expect(
      event.completeWith.mock.calls[0][0].then((response: Response) => response.text()),
    ).resolves.toBe("handled:/integration");

    await server.close();
  });
});
