import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printListening, resolveTLSOptions, runtimeCapabilities } from "../src/_node_like";

describe("resolveTLSOptions", () => {
  it("returns undefined when tls is absent or protocol is http", () => {
    expect(resolveTLSOptions({} as any)).toBeUndefined();
    expect(
      resolveTLSOptions({
        protocol: "http",
        tls: { cert: "cert", key: "key" },
      } as any),
    ).toBeUndefined();
  });

  it("requires cert and key together for https", () => {
    expect(() =>
      resolveTLSOptions({
        protocol: "https",
        tls: { cert: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----" },
      } as any),
    ).toThrow("TLS `cert` and `key` must be provided together.");

    expect(() =>
      resolveTLSOptions({
        protocol: "https",
        tls: {},
      } as any),
    ).toThrow("TLS `cert` and `key` must be provided for `https` protocol.");
  });

  it("reads cert and key from file paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fetch-server-tls-"));
    const certPath = join(dir, "cert.pem");
    const keyPath = join(dir, "key.pem");

    await writeFile(certPath, "CERT");
    await writeFile(keyPath, "KEY");

    expect(
      resolveTLSOptions({
        protocol: "https",
        tls: { cert: certPath, key: keyPath, passphrase: "secret" },
      } as any),
    ).toEqual({
      cert: "CERT",
      key: "KEY",
      passphrase: "secret",
    });
  });

  it("rejects non-string cert and key values", () => {
    expect(() =>
      resolveTLSOptions({
        tls: { cert: 1, key: "key" },
      } as any),
    ).toThrow("TLS certificate and key must be strings");
  });
});

describe("printListening", () => {
  const originalTest = process.env.TEST;
  const originalTTY = process.stdout.isTTY;

  afterEach(() => {
    if (originalTest === undefined) {
      delete process.env.TEST;
    } else {
      process.env.TEST = originalTest;
    }

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalTTY,
    });

    vi.restoreAllMocks();
  });

  it("does not print when silenced, missing url, or TEST is set", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    printListening({ silent: true } as any, "http://localhost:3000/");
    printListening({} as any, undefined);
    process.env.TEST = "1";
    printListening({} as any, "http://localhost:3000/");

    expect(log).not.toHaveBeenCalled();
  });

  it("rewrites all-interface urls to localhost for display", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.TEST;

    printListening({} as any, "http://0.0.0.0:3000/");

    expect(log).toHaveBeenCalledWith("➜ Listening on: http://localhost:3000/ (all interfaces)");
  });

  it("adds ANSI colors when stdout is a tty", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.TEST;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    printListening({} as any, "http://localhost:3000/");

    expect(log).toHaveBeenCalledWith(
      "\u001B[32m➜ Listening on:\u001B[0m \u001B[36mhttp://localhost:3000/\u001B[0m\u001B[2m\u001B[0m",
    );
  });

  it("prints unparseable urls as-is", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.TEST;

    printListening({} as any, "/tmp/server.sock");

    expect(log).toHaveBeenCalledWith("➜ Listening on: /tmp/server.sock");
  });
});

describe("runtimeCapabilities", () => {
  it("resolves paths inside root and blocks traversal outside root", async () => {
    const inside = await runtimeCapabilities.resolve("/project/src", "nested", "file.ts");
    const outside = await runtimeCapabilities.resolve("/project/src", "..", "file.ts");

    expect(inside).toContain(join("project", "src", "nested", "file.ts"));
    expect(outside).toBeNull();
  });

  it("opens files and exposes byte ranges", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fetch-server-open-"));
    const filePath = join(dir, "hello.txt");
    await writeFile(filePath, "hello world");

    const file = await runtimeCapabilities.open(filePath);

    expect(file?.isFile).toBe(true);
    expect(file && "size" in file ? file.size : undefined).toBe(11);
    expect(
      await new Response(file && "stream" in file ? file.stream(6, 11) : undefined).text(),
    ).toBe("world");
  });

  it("returns null for missing files", async () => {
    await expect(runtimeCapabilities.open("/definitely/missing.txt")).resolves.toBeNull();
  });

  it("creates gzip and brotli transform streams", async () => {
    const gzip = await runtimeCapabilities.createGzip();
    const brotli = await runtimeCapabilities.createBrotliCompress();

    expect(gzip.readable).toBeInstanceOf(ReadableStream);
    expect(gzip.writable).toBeInstanceOf(WritableStream);
    expect(brotli.readable).toBeInstanceOf(ReadableStream);
    expect(brotli.writable).toBeInstanceOf(WritableStream);
  });
});
