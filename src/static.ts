import type { MaybePromise, ServerMiddlewareFunction } from "./core.ts";

/**
 * Configuration for `serveStatic()`.
 */
export interface ServeStaticOptions {
  /**
   * The directory to serve static files from.
   */
  dir: string;

  /**
   * The HTTP methods to allow for serving static files.
   */
  methods?: string[];

  /**
   * A function to modify the HTML content before serving it.
   */
  renderHTML?: (ctx: {
    request: Request;
    html: string;
    filename: string;
  }) => MaybePromise<Response>;
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types
const COMMON_MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".gif": "image/gif",
  ".ico": "image/vnd.microsoft.icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
};

/**
 * Create middleware that serves files from a runtime-provided filesystem.
 *
 * Resolution follows common static-site conventions:
 * - `/` maps to `index.html`
 * - extensionless paths try `name.html` and `name/index.html`
 * - explicit extensions are used as-is
 */
export function serveStatic(options: ServeStaticOptions): ServerMiddlewareFunction {
  const methods = new Set((options.methods || ["GET", "HEAD"]).map((m) => m.toUpperCase()));

  return async (ctx, next) => {
    const req = ctx.request;

    if (!methods.has(req.method)) {
      return next(ctx);
    }

    const url = (ctx.url ??= new URL(req.url));
    const path = url.pathname.slice(1).replace(/\/$/, "");
    let paths: string[];
    if (path === "") {
      paths = ["index.html"];
    } else if (extname(path) === "") {
      paths = [`${path}.html`, `${path}/index.html`];
    } else {
      paths = [path];
    }

    const fs = ctx.capabilities;

    for (const path of paths) {
      const filePath = await fs.resolve(options.dir, path);
      if (!filePath) {
        continue;
      }

      const file = await fs.open(filePath);
      if (file?.isFile) {
        const fileExt = extname(filePath);
        const headers = new Headers({
          "Content-Length": file.size.toString(),
          "Content-Type": COMMON_MIME_TYPES[fileExt] || "application/octet-stream",
        });
        const stream = file.stream();
        if (options.renderHTML && fileExt === ".html") {
          const html = await read(stream);
          return options.renderHTML({
            html,
            filename: filePath,
            request: req,
          });
        }
        const acceptEncoding = req.headers.get("accept-encoding") || "";
        if (acceptEncoding.includes("br")) {
          headers.set("Content-Encoding", "br");
          headers.delete("Content-Length");
          headers.set("Vary", "Accept-Encoding");
          const { readable, writable } = await fs.createBrotliCompress();
          await stream.pipeTo(writable);
          return new Response(readable, { headers });
        } else if (acceptEncoding.includes("gzip")) {
          headers.set("Content-Encoding", "gzip");
          headers.delete("Content-Length");
          headers.set("Vary", "Accept-Encoding");
          const { readable, writable } = await fs.createGzip();
          await stream.pipeTo(writable);
          return new Response(readable, { headers });
        } else {
          return new Response(stream as any, { headers });
        }
      }
    }
    return next(ctx);
  };
}

/**
 * Extract a file extension without relying on Node's path helpers so the
 * function also works in non-Node runtimes.
 */
function extname(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const lastDot = path.lastIndexOf(".");
  return lastDot > lastSlash ? path.slice(lastDot) : "";
}

/**
 * Consume a `ReadableStream` into a UTF-8 string.
 */
async function read(stream: ReadableStream): Promise<string> {
  return await new Response(stream).text();
}
