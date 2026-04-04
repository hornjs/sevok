import nodeHTTP, { IncomingMessage, ServerResponse } from "node:http";
import nodeHTTPS from "node:https";
import nodeHTTP2 from "node:http2";

import type NodeHttp from "node:http";
import type NodeHttps from "node:https";
import type NodeHttp2 from "node:http2";
import type {
  NodeServerOptions,
  Server,
  RuntimeAdapter,
  RuntimeCapabilities,
} from "./core.ts";

import { printListening, resolveTLSOptions, runtimeCapabilities } from "./_node_like.ts";
import { fmtURL, resolvePortAndHost } from "./_shared.ts";

/**
 * Runtime adapter that backs `Server` with Node's HTTP, HTTPS, or HTTP/2
 * servers depending on the effective TLS configuration.
 */
export class NodeRuntimeAdapter implements RuntimeAdapter {
  #server: NodeHttp.Server | NodeHttp2.Http2Server | undefined;
  #serveOptions: NodeServerOptions | undefined;
  #isSecure?: boolean;
  #listeningPromise?: Promise<{ url: string | undefined }>;

  readonly graceful = true;

  get capabilities(): RuntimeCapabilities {
    return runtimeCapabilities;
  }

  /**
   * Create the underlying Node server instance but do not start listening yet.
   */
  setup(server: Server): void {
    const { options } = server;
    const { hostname, port } = resolvePortAndHost(options);
    const tls = resolveTLSOptions(options);
    const isSecure = !!tls?.cert && options.protocol !== "http";
    const isHttp2 = options.node?.http2 ?? isSecure;

    this.#isSecure = isSecure;
    this.#serveOptions = {
      port,
      host: hostname,
      exclusive: !server.options.reusePort,
      ...(tls ? { cert: tls.cert, key: tls.key, passphrase: tls.passphrase } : {}),
      ...options.node,
    };

    const handler = async (request: IncomingMessage, response: ServerResponse) => {
      await handleNodeRequest(server, request, response);
    };

    if (isHttp2) {
      if (isSecure) {
        this.#server = nodeHTTP2.createSecureServer(
          { allowHTTP1: true, ...this.#serveOptions },
          handler as any,
        );
      } else {
        throw new Error("node.http2 option requires tls certificate!");
      }
    } else if (isSecure) {
      this.#server = nodeHTTPS.createServer(this.#serveOptions as NodeHttps.ServerOptions, handler);
    } else {
      this.#server = nodeHTTP.createServer(this.#serveOptions as NodeHttp.ServerOptions, handler);
    }
  }

  /**
   * Start the Node server once and reuse the same ready promise afterwards.
   */
  async serve(server: Server): Promise<{ url: string | undefined }> {
    if (this.#listeningPromise) {
      return Promise.resolve(this.#listeningPromise).then(() => ({ url: this.url }));
    }

    this.#listeningPromise = new Promise<{ url: string | undefined }>((resolve) => {
      this.#server!.listen(this.#serveOptions, () => {
        printListening(server.options, this.url);
        resolve({ url: this.url });
      });
    });

    return this.#listeningPromise;
  }

  /**
   * Return either a socket path or a formatted origin for TCP listeners.
   */
  get url() {
    const addr = this.#server?.address();
    if (!addr) {
      return;
    }

    return typeof addr === "string"
      ? addr /* socket */
      : fmtURL(addr.address, addr.port, this.#isSecure);
  }

  /**
   * Stop accepting new work and optionally close active HTTP connections.
   */
  close(closeActiveConnections: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = this.#server;
      if (server && closeActiveConnections && "closeAllConnections" in server) {
        server.closeAllConnections();
      }
      if (!server || !server.listening) {
        return resolve();
      }
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
}

/**
 * Convert a Node request/response pair into fetch primitives and forward
 * framework-level errors through the configured error handler.
 */
async function handleNodeRequest(
  server: Server,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const nextRequest = await toRequest(request);
    const nextResponse = await server.fetch(nextRequest);
    await writeResponse(response, nextResponse);
  } catch (error) {
    const handled = server.options.error
      ? await server.options.error(error)
      : new Response("Internal Server Error", { status: 500 });
    await writeResponse(response, handled);
  }
}

/**
 * Convert Node's `IncomingMessage` into a standard `Request`.
 */
async function toRequest(request: IncomingMessage): Promise<Request> {
  const protocol = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
    ? "https"
    : "http";
  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `${protocol}://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const { Readable } = await import("node:stream");
    init.body = Readable.toWeb(request) as RequestInit["body"];
    init.duplex = "half";
  }

  return new Request(url.toString(), init);
}

/**
 * Write a fetch `Response` back to Node's `ServerResponse`.
 */
async function writeResponse(response: ServerResponse, nextResponse: Response): Promise<void> {
  response.statusCode = nextResponse.status;
  response.statusMessage = nextResponse.statusText;

  nextResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!nextResponse.body) {
    response.end();
    return;
  }

  response.end(Buffer.from(await nextResponse.arrayBuffer()));
}
