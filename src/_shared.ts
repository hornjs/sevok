/**
 * Normalize a pathname to a leading-slash, no-trailing-slash form.
 */
export function normalizePathname(pathname: string): string {
  if (pathname.length === 0 || pathname === "/") {
    return "/";
  }

  let normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  normalized = normalized.replace(/\/+/g, "/");

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Split a normalized pathname into path segments.
 */
export function splitPathname(pathname: string): string[] {
  const normalized = normalizePathname(pathname);
  return normalized === "/" ? [] : normalized.slice(1).split("/");
}

/**
 * Escape a string for safe inclusion in a regular expression.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a route pathname into a matching regular expression.
 */
export function compilePath<TPath extends string = string>(path: TPath): RegExp {
  const segments = splitPathname(path);
  if (segments.length === 0) {
    return /^\/$/;
  }

  const source = segments
    .map((segment) => {
      if (segment === "*") {
        return "(?:/.*)?";
      }

      if (segment.startsWith(":")) {
        return "/([^/]+)";
      }

      return `/${escapeRegExp(segment)}`;
    })
    .join("");

  return new RegExp(`^${source}$`);
}

/**
 * Extract route parameter names from a path pattern.
 */
export function extractKeys(path: string): string[] {
  return splitPathname(path)
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));
}

/**
 * Collapse dynamic route segments into a canonical conflict-detection pattern.
 */
export function canonicalizePath(path: string): string {
  const segments = splitPathname(path).map((segment) => {
    if (segment === "*") {
      return "*";
    }

    if (segment.startsWith(":")) {
      return ":";
    }

    return segment;
  });

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Extract named params from a regular-expression route match.
 */
export function extractParams(keys: string[], match: RegExpExecArray): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [index, key] of keys.entries()) {
    const value = match[index + 1];
    if (value != null) {
      params[key] = decodeURIComponent(value);
    }
  }
  return params;
}

/**
 * Resolve the effective listening port and hostname from explicit options or
 * the conventional `PORT` and `HOST` environment variables.
 */
export function resolvePortAndHost(opts: { port?: string | number; hostname?: string }): {
  port: number;
  hostname: string | undefined;
} {
  const _port = opts.port ?? globalThis.process?.env.PORT ?? 3000;
  const port = typeof _port === "number" ? _port : Number.parseInt(_port, 10);
  if (port < 0 || port > 65_535) {
    throw new RangeError(`Port must be between 0 and 65535 (got "${port}").`);
  }

  const hostname = opts.hostname ?? globalThis.process?.env.HOST;
  return { port, hostname };
}

/**
 * Format a listener address as a fetch-compatible origin.
 *
 * Returns `undefined` when either host or port is missing, which keeps callers
 * from printing misleading partial URLs before the runtime has finished
 * listening.
 */
export function fmtURL(
  host: string | undefined,
  port: number | undefined,
  secure: boolean | undefined,
): string | undefined {
  if (!host || !port) {
    return undefined;
  }
  if (host.includes(":")) {
    host = `[${host}]`;
  }
  return `http${secure ? "s" : ""}://${host}:${port}/`;
}
