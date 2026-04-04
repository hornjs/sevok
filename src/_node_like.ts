import { readFileSync } from "node:fs";
import type { RuntimeCapabilities, ServerOptions, TLSOptions } from "./core.ts";

/**
 * Normalize TLS options for runtimes that accept PEM strings.
 *
 * Certificate and key values may be supplied inline or as filesystem paths.
 */
export function resolveTLSOptions(opts: ServerOptions): TLSOptions | undefined {
  if (!opts.tls || opts.protocol === "http") {
    return;
  }

  const cert = resolveCertOrKey(opts.tls.cert);
  const key = resolveCertOrKey(opts.tls.key);

  if (!cert && !key) {
    if (opts.protocol === "https") {
      throw new TypeError("TLS `cert` and `key` must be provided for `https` protocol.");
    }
    return;
  }

  if (!cert || !key) {
    throw new TypeError("TLS `cert` and `key` must be provided together.");
  }

  return {
    cert,
    key,
    passphrase: opts.tls.passphrase,
  };
}

/**
 * Accept either inline PEM content or a path to a PEM file on disk.
 */
function resolveCertOrKey(value?: unknown): undefined | string {
  if (!value) {
    return;
  }
  if (typeof value !== "string") {
    throw new TypeError("TLS certificate and key must be strings in PEM format or file paths.");
  }
  if (value.startsWith("-----BEGIN ")) {
    return value;
  }
  return readFileSync(value, "utf8");
}

/**
 * Print the listener address unless output is silenced.
 *
 * When the runtime binds to all interfaces, the displayed URL is rewritten to
 * `localhost` so the message remains copy-pastable for local development.
 */
export function printListening(opts: ServerOptions, url: string | undefined): void {
  if (!url || (opts.silent ?? globalThis.process?.env?.TEST)) {
    return;
  }

  let additionalInfo = "";
  try {
    const _url = new URL(url);
    const allInterfaces = _url.hostname === "[::]" || _url.hostname === "0.0.0.0";
    if (allInterfaces) {
      _url.hostname = "localhost";
      url = _url.href;
      additionalInfo = " (all interfaces)";
    }
  } catch {
    // URL is not parsable (e.g., unix socket), use as-is
  }

  let listeningOn = `➜ Listening on:`;

  if (globalThis.process.stdout?.isTTY) {
    listeningOn = `\u001B[32m${listeningOn}\u001B[0m`; // ANSI green
    url = `\u001B[36m${url}\u001B[0m`; // ANSI cyan
    additionalInfo = `\u001B[2m${additionalInfo}\u001B[0m`; // ANSI dim
  }

  console.log(`${listeningOn} ${url}${additionalInfo}`);
}

/**
 * Runtime helpers shared by Bun and Node-style adapters.
 */
export const runtimeCapabilities: RuntimeCapabilities = {
  resolve: resolveNodeLikePath,
  open: openNodeLikePath,
  createGzip: createNodeLikeGzip,
  createBrotliCompress: createNodeLikeBrotliCompress,
};

/**
 * Resolve a candidate path and reject traversal outside the configured root.
 */
async function resolveNodeLikePath(root: string, ...components: string[]): Promise<string | null> {
  const { resolve, sep } = await import("node:path");
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...components);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`)
    ? resolvedPath
    : null;
}

/**
 * Open a file lazily and expose it as a Web `ReadableStream`.
 */
async function openNodeLikePath(path: string) {
  const { stat } = await import("node:fs/promises");
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat) {
    return null;
  }

  const { createReadStream } = await import("node:fs");
  const { Readable } = await import("node:stream");

  return {
    isFile: fileStat.isFile(),
    size: fileStat.size,
    // The public API uses an exclusive `end`, while Node streams use inclusive.
    stream(start?: number, end?: number) {
      return Readable.toWeb(
        createReadStream(path, {
          start,
          end: typeof end === "number" ? end - 1 : undefined,
        }),
      ) as ReadableStream;
    },
  };
}

/**
 * Adapt Node's gzip transform to the Web Streams API used by this package.
 */
async function createNodeLikeGzip(): Promise<TransformStream> {
  const { createGzip } = await import("node:zlib");
  const { Duplex } = await import("node:stream");
  return Duplex.toWeb(createGzip()) as TransformStream;
}

/**
 * Adapt Node's Brotli transform to the Web Streams API used by this package.
 */
async function createNodeLikeBrotliCompress(): Promise<TransformStream> {
  const { createBrotliCompress } = await import("node:zlib");
  const { Duplex } = await import("node:stream");
  return Duplex.toWeb(createBrotliCompress()) as TransformStream;
}
