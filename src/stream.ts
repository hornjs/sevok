import {
  Server,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type WaitUntilFunction,
} from "./core.ts";

/**
 * Minimal request entry shape consumed by `handleRequestEntry()`.
 *
 * This intentionally matches service-worker-like runtimes that expose a request
 * plus completion hooks rather than direct socket APIs.
 */
export interface RequestEntry {
  readonly request: Request;
  readonly waitUntil?: WaitUntilFunction;
  completeWith(promise: Promise<Response>): void;
}

/**
 * Options for consuming fetch events from an async stream.
 */
export type StreamServerOptions = {
  /**
   * Source of runtime-specific fetch events to dispatch through `Server`.
   */
  stream: AsyncIterableIterator<RequestEntry>;

  /**
   * The path to the stream worker file or address to be registered.
   */
  url?: string;
};

/**
 * Complete a runtime request entry by routing it through `Server.fetch()`.
 */
export function handleRequestEntry(server: Server, entry: RequestEntry): void {
  const { request, waitUntil } = entry;

  let context = server.createContext(request);
  if (typeof waitUntil === "function") {
    context = context.with({
      waitUntil: (p) => waitUntil(p),
    });
  }

  entry.completeWith(Promise.resolve(
    server.handle(context),
  ));
}

/**
 * Adapter for environments that expose requests as an async iterator instead of
 * a socket listener.
 */
export class StreamRuntimeAdapter implements RuntimeAdapter {
  #options: StreamServerOptions;
  #served = false;
  #closed = false;

  constructor(options: StreamServerOptions) {
    this.#options = options;
  }

  get capabilities(): RuntimeCapabilities {
    return streamCapabilities;
  }

  /**
   * No-op because the stream runtime does not need listener setup.
   */
  setup(): void {}

  /**
   * Start consuming the event stream once and dispatch each event to `Server`.
   */
  async serve(server: Server) {
    if (this.#served) {
      return { url: this.#options.url };
    }
    this.#served = true;
    queueMicrotask(async () => {
      for await (const event of this.#options.stream) {
        if (this.#closed) {
          return;
        }
        handleRequestEntry(server, event);
      }
    });
    return { url: this.#options.url };
  }

  /**
   * Stop dispatching future events from the stream.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#served = false;
  }
}

/**
 * Minimal capabilities available in stream-only environments.
 */
const streamCapabilities: RuntimeCapabilities = {
  resolve: () => Promise.resolve(null),
  open: () => Promise.resolve(null),
  createGzip: () => createCompressionStream("gzip"),
  createBrotliCompress() {
    throw new Error("Does not provide Brotli compression.");
  },
};

type CompressionFormatName = "gzip" | "deflate";

function createCompressionStream(format: CompressionFormatName): TransformStream {
  const CompressionStreamCtor = (
    globalThis as typeof globalThis & {
      CompressionStream?: new (format: CompressionFormatName) => TransformStream;
    }
  ).CompressionStream;

  if (typeof CompressionStreamCtor !== "function") {
    throw new Error("Does not provide CompressionStream.");
  }

  return new CompressionStreamCtor(format);
}
