import type {
  Server,
  RuntimeAdapter,
  RuntimeCapabilities,
} from "./core.ts";
import { printListening, resolveTLSOptions, runtimeCapabilities } from "./_node_like.ts";
import { resolvePortAndHost } from "./_shared.ts";

/**
 * Runtime adapter that backs `Server` with `Bun.serve()`.
 */
export class BunRuntimeAdapter implements RuntimeAdapter {
  #server: Bun.Server<any> | undefined;
  #serveOptions: Bun.Serve.Options<any> | undefined;

  readonly graceful = true;

  get capabilities(): RuntimeCapabilities {
    return runtimeCapabilities;
  }

  /**
   * Merge generic server options with Bun-specific listener options.
   */
  setup(server: Server): void {
    const { options } = server;
    const { hostname, port } = resolvePortAndHost(options);
    const tls = resolveTLSOptions(options);

    this.#serveOptions = {
      hostname,
      port,
      reusePort: options.reusePort,
      error: options.error,
      ...(options.bun as any),
      fetch: (request) => server.fetch(request),
      tls: {
        ...tls,
        ...options.bun?.tls,
      },
    };
  }

  /**
   * Start Bun's native server once and reuse the same instance for later calls.
   */
  serve(server: Server): Promise<{ url: string | undefined }> {
    if (!this.#server) {
      this.#server = Bun.serve(this.#serveOptions!);
    }
    printListening(server.options, this.url);
    return Promise.resolve({ url: this.url });
  }

  /**
   * Expose Bun's resolved listener URL.
   */
  get url(): string | undefined {
    return this.#server?.url.href;
  }

  /**
   * Stop the active Bun server and clear the cached instance.
   */
  async close(closeActiveConnections = false): Promise<void> {
    return Promise.resolve(this.#server?.stop(closeActiveConnections)).then(() => {
      this.#server = undefined;
    });
  }
}
