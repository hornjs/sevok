import { describe, expect, it, afterEach } from "vitest";
import { resolvePortAndHost, fmtURL } from "../src/_shared";

describe("resolvePortAndHost", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns default port 3000 when not specified", () => {
    const result = resolvePortAndHost({} as any);
    expect(result.port).toBe(3000);
    expect(result.hostname).toBeUndefined();
  });

  it("uses specified port number", () => {
    const result = resolvePortAndHost({ port: 8080 } as any);
    expect(result.port).toBe(8080);
  });

  it("parses string port number", () => {
    const result = resolvePortAndHost({ port: "9000" } as any);
    expect(result.port).toBe(9000);
  });

  it("uses PORT environment variable when port not specified", () => {
    process.env = { ...originalEnv, PORT: "4000" };
    const result = resolvePortAndHost({} as any);
    expect(result.port).toBe(4000);
  });

  it("uses specified hostname", () => {
    const result = resolvePortAndHost({ hostname: "localhost" } as any);
    expect(result.hostname).toBe("localhost");
  });

  it("uses HOST environment variable when hostname not specified", () => {
    process.env = { ...originalEnv, HOST: "0.0.0.0" };
    const result = resolvePortAndHost({} as any);
    expect(result.hostname).toBe("0.0.0.0");
  });

  it("throws for invalid port below range", () => {
    expect(() => resolvePortAndHost({ port: -1 } as any)).toThrow(RangeError);
    expect(() => resolvePortAndHost({ port: -1 } as any)).toThrow(
      /Port must be between 0 and 65535/,
    );
  });

  it("throws for invalid port above range", () => {
    expect(() => resolvePortAndHost({ port: 70000 } as any)).toThrow(RangeError);
  });

  it("accepts port 0", () => {
    const result = resolvePortAndHost({ port: 0 } as any);
    expect(result.port).toBe(0);
  });

  it("accepts port 65535", () => {
    const result = resolvePortAndHost({ port: 65535 } as any);
    expect(result.port).toBe(65535);
  });
});

describe("fmtURL", () => {
  it("returns undefined when host is missing", () => {
    expect(fmtURL(undefined, 3000, false)).toBeUndefined();
  });

  it("returns undefined when port is missing", () => {
    expect(fmtURL("localhost", undefined, false)).toBeUndefined();
  });

  it("formats http URL with hostname and port", () => {
    const result = fmtURL("localhost", 3000, false);
    expect(result).toBe("http://localhost:3000/");
  });

  it("formats https URL with hostname and port", () => {
    const result = fmtURL("localhost", 443, true);
    expect(result).toBe("https://localhost:443/");
  });

  it("wraps IPv6 address in brackets", () => {
    const result = fmtURL("::1", 3000, false);
    expect(result).toBe("http://[::1]:3000/");
  });

  it("handles full IPv6 address", () => {
    const result = fmtURL("2001:db8::1", 8080, false);
    expect(result).toBe("http://[2001:db8::1]:8080/");
  });

  it("handles numeric port", () => {
    const result = fmtURL("localhost", 8080 as any, false);
    expect(result).toBe("http://localhost:8080/");
  });
});
