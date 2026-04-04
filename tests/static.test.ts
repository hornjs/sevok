import { describe, expect, it, vi } from "vitest";
import { serveStatic } from "../src/static";
import { InvocationContext, type RuntimeCapabilities } from "../src/core";

function createBodyStream(body: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

function createDrainTransform(body: string): TransformStream {
  return {
    readable: createBodyStream(body),
    writable: new WritableStream({
      write() {},
      close() {},
    }),
  } as TransformStream;
}

function createRuntime(
  overrides: Partial<RuntimeCapabilities> = {},
): RuntimeCapabilities {
  return {
    resolve: async () => null,
    open: async () => null,
    createGzip: async () => new TransformStream(),
    createBrotliCompress: async () => new TransformStream(),
    ...overrides,
  };
}

function createContext(
  url: string,
  runtime: RuntimeCapabilities,
  init?: RequestInit,
): InvocationContext {
  return new InvocationContext({
    request: new Request(url, init),
    capabilities: runtime,
    params: {},
  });
}

describe("serveStatic", () => {
  it("passes through methods that are not allowed", async () => {
    const runtime = createRuntime();
    const context = createContext("http://localhost/about", runtime, { method: "POST" });
    const next = vi.fn(async () => new Response("next"));

    const response = await serveStatic({ dir: "/public" })(context, next);

    expect(await response.text()).toBe("next");
    expect(next).toHaveBeenCalledOnce();
  });

  it("tries index.html for root and caches the parsed url on context", async () => {
    const resolve = vi.fn(async () => "/public/index.html");
    const runtime = createRuntime({
      resolve,
      open: async () => ({
        isFile: true,
        size: 5,
        stream: () => createBodyStream("home!"),
      }),
    });
    const context = createContext("http://localhost/", runtime);

    const response = await serveStatic({ dir: "/public" })(context, vi.fn());

    expect(resolve).toHaveBeenCalledWith("/public", "index.html");
    expect(context.url).toBeInstanceOf(URL);
    expect(await response.text()).toBe("home!");
  });

  it("tries html fallback then nested index fallback for extensionless paths", async () => {
    const resolve = vi.fn(async (_root: string, path: string) => {
      if (path === "docs/index.html") {
        return "/public/docs/index.html";
      }
      return null;
    });

    const runtime = createRuntime({
      resolve,
      open: async (path) =>
        path
          ? {
              isFile: true,
              size: 4,
              stream: () => createBodyStream("docs"),
            }
          : null,
    });
    const context = createContext("http://localhost/docs", runtime);

    const response = await serveStatic({ dir: "/public" })(context, vi.fn());

    expect(resolve.mock.calls.map((call) => call[1])).toEqual(["docs.html", "docs/index.html"]);
    expect(await response.text()).toBe("docs");
  });

  it("skips entries that resolve but are not files", async () => {
    const runtime = createRuntime({
      resolve: async () => "/public/assets",
      open: async () => ({ isFile: false }),
    });
    const next = vi.fn(async () => new Response("fallback", { status: 404 }));
    const context = createContext("http://localhost/assets", runtime);

    const response = await serveStatic({ dir: "/public" })(context, next);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("fallback");
  });

  it("returns rendered html instead of the raw file when renderHTML is provided", async () => {
    const renderHTML = vi.fn(async ({ html, filename }) => new Response(`${filename}:${html}`));
    const runtime = createRuntime({
      resolve: async () => "/public/about.html",
      open: async () => ({
        isFile: true,
        size: 18,
        stream: () => createBodyStream("<h1>About</h1>"),
      }),
    });
    const context = createContext("http://localhost/about", runtime);

    const response = await serveStatic({
      dir: "/public",
      renderHTML,
    })(context, vi.fn());

    expect(renderHTML).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "/public/about.html",
        html: "<h1>About</h1>",
        request: context.request,
      }),
    );
    expect(await response.text()).toBe("/public/about.html:<h1>About</h1>");
  });

  it("sets gzip headers and pipes the file through the gzip transform", async () => {
    const createGzip = vi.fn(async () => createDrainTransform("gzipped"));
    const runtime = createRuntime({
      resolve: async () => "/public/file.txt",
      open: async () => ({
        isFile: true,
        size: 11,
        stream: () => createBodyStream("hello world"),
      }),
      createGzip,
    });
    const context = createContext("http://localhost/file.txt", runtime, {
      headers: { "accept-encoding": "gzip, deflate" },
    });

    const response = await serveStatic({ dir: "/public" })(context, vi.fn());

    expect(createGzip).toHaveBeenCalledOnce();
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(await response.text()).toBe("gzipped");
  });

  it("prefers brotli over gzip when both are accepted", async () => {
    const createGzip = vi.fn(async () => createDrainTransform("gzip"));
    const createBrotliCompress = vi.fn(async () => createDrainTransform("brotli"));
    const runtime = createRuntime({
      resolve: async () => "/public/file.txt",
      open: async () => ({
        isFile: true,
        size: 5,
        stream: () => createBodyStream("hello"),
      }),
      createGzip,
      createBrotliCompress,
    });
    const context = createContext("http://localhost/file.txt", runtime, {
      headers: { "accept-encoding": "br, gzip" },
    });

    const response = await serveStatic({ dir: "/public" })(context, vi.fn());

    expect(createBrotliCompress).toHaveBeenCalledOnce();
    expect(createGzip).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Encoding")).toBe("br");
    expect(await response.text()).toBe("brotli");
  });

  it("sets common mime types and falls back to octet-stream", async () => {
    const runtime = createRuntime({
      resolve: async (_root, path) => `/public/${path}`,
      open: async () => ({
        isFile: true,
        size: 1,
        stream: () => createBodyStream("x"),
      }),
    });

    const cssResponse = await serveStatic({ dir: "/public" })(
      createContext("http://localhost/app.css", runtime),
      vi.fn(),
    );
    const unknownResponse = await serveStatic({ dir: "/public" })(
      createContext("http://localhost/file.abc", runtime),
      vi.fn(),
    );

    expect(cssResponse.headers.get("Content-Type")).toBe("text/css");
    expect(unknownResponse.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
