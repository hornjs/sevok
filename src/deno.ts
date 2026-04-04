import { printListening, resolveTLSOptions, runtimeCapabilities } from "./_node_like.ts";
import { fmtURL, resolvePortAndHost } from "./_shared.ts";
import { Server, type RuntimeAdapter, type RuntimeCapabilities } from "./core.ts";

/**
 * Runtime adapter that backs `Server` with `Deno.serve()`.
 */
export class DenoRuntimeAdapter implements RuntimeAdapter {
  #server: Deno.HttpServer | undefined;
  #listeningPromise?: Promise<void>;
  #listeningInfo?: Deno.NetAddr;
  #serveOptions:
    | Deno.ServeTcpOptions
    | (Deno.ServeTcpOptions & Deno.TlsCertifiedKeyPem)
    | undefined;

  readonly graceful = true;

  get capabilities(): RuntimeCapabilities {
    return runtimeCapabilities;
  }

  /**
   * Translate generic server options into Deno's `serve` options.
   */
  setup(server: Server): void {
    const { options } = server;
    const tls = resolveTLSOptions(options);

    this.#serveOptions = {
      ...resolvePortAndHost(options),
      reusePort: options.reusePort,
      onError: options.error,
      ...tls,
      ...options.deno,
    };
  }

  /**
   * Start Deno's HTTP server and resolve only after the runtime reports the
   * bound address via `onListen`.
   */
  async serve(server: Server): Promise<{ url: string | undefined }> {
    if (this.#server) {
      return Promise.resolve(this.#listeningPromise).then(() => ({ url: this.url }));
    }

    const onListenPromise = Promise.withResolvers<void>();
    this.#listeningPromise = onListenPromise.promise;
    this.#server = Deno.serve(
      {
        ...this.#serveOptions,
        onListen: (info) => {
          this.#listeningInfo = info;
          if (this.#serveOptions?.onListen) {
            this.#serveOptions.onListen(info);
          }
          printListening(server.options, this.url);
          onListenPromise.resolve();
        },
      },
      (request) => server.fetch(request),
    );

    return Promise.resolve(this.#listeningPromise).then(() => ({ url: this.url }));
  }

  /**
   * Derive the public URL from the last `onListen` callback.
   */
  get url(): string | undefined {
    return this.#listeningInfo
      ? fmtURL(
          this.#listeningInfo.hostname,
          this.#listeningInfo.port,
          !!(this.#serveOptions as { cert: string }).cert,
        )
      : undefined;
  }

  /**
   * Gracefully shut down the Deno server, if one is active.
   */
  async close(): Promise<void> {
    return Promise.resolve(this.#server?.shutdown()).then(() => {
      this.#server = undefined;
    });
  }
}
