import type NodeHttp from "node:http";
import type NodeHttps from "node:https";
import type NodeHttp2 from "node:http2";
import type * as NodeNet from "node:net";

import { EventDispatcher } from "@hornjs/evt";
import c from "./_color.ts";
import {
  canonicalizePath,
  compilePath,
  extractKeys,
  extractParams,
  normalizePathname,
} from "./_shared.ts";

export type MaybePromise<T> = T | Promise<T>;

/**
 * HTTP methods supported by the route table shorthand.
 */
export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/**
 * Wildcard key for handlers that accept any HTTP method not matched explicitly.
 */
export type ServerWildcardMethod = "*";

/**
 * Core request handler function.
 *
 * Receives an `InvocationContext` containing the request and invocation state.
 * Runtime adapters, middleware, and higher-level helpers all eventually resolve down to a
 * `ServerHandlerFunction`.
 */
export type ServerHandlerFunction = (context: InvocationContext) => MaybePromise<Response>;

/**
 * Object form of a handler.
 *
 * This makes it possible to attach middleware at the leaf of a middleware
 * chain, which is useful for composing route handlers or feature modules.
 */
export type ServerHandlerObject = {
  /**
   * Additional middleware to apply immediately before `handle`.
   */
  middleware?: ServerMiddleware[];

  /**
   * Final request handler invoked after middleware has run.
   */
  handle: ServerHandlerFunction;
};

/**
 * A request handler in either function or object form.
 *
 * This lets higher-level APIs accept a bare handler function for simple cases
 * or a handler object when route-local middleware needs to be attached.
 */
export type ServerHandler = ServerHandlerFunction | ServerHandlerObject;

/**
 * Per-method handlers for a single route path.
 *
 * This is the route-table branch used when the same pathname needs distinct
 * handlers for different HTTP methods.
 */
export type ServerMethodHandlers = Partial<Record<HTTPMethod | ServerWildcardMethod, ServerHandler>>;

/**
 * Error handler for failures raised during request handling.
 *
 * This is used by `wrapFetch()` to turn thrown exceptions or rejected promises
 * into a fallback `Response`.
 */
export type ErrorHandler = (error: unknown) => MaybePromise<Response>;

/**
 * Request middleware.
 *
 * `next` keeps the same handler signature so middleware can replace the request
 * object before passing control downstream.
 */
export type ServerMiddlewareFunction = (context: InvocationContext, next: ServerHandlerFunction) => MaybePromise<Response>;

/**
 * A named middleware reference resolved at execution time.
 *
 * Use this when middleware registration and middleware lookup need to be
 * decoupled, for example when an application maintains its own middleware
 * registry.
 *
 * Consumers can extend `ServerMiddlewareNameMap` with module augmentation to
 * surface application-specific named middleware entries in the type system.
 *
 * @example
 * ```ts
 * declare module "sevok" {
 *   interface ServerMiddlewareNameMap {
 *     auth: true;
 *     cache: true;
 *   }
 * }
 * ```
 */
export type ServerMiddlewareName = keyof ServerMiddlewareNameMap | (string & {});

/**
 * Augmentation hook for adding application-specific named middleware entries.
 *
 * Consumers can extend this interface with module augmentation so known
 * middleware names appear in `ServerMiddlewareName`.
 */
export interface ServerMiddlewareNameMap { }

/**
 * A middleware entry accepted by server and handler middleware arrays.
 *
 * Entries can be either executable middleware functions or named references
 * resolved through `ServerMiddlewareResolver`.
 */
export type ServerMiddleware =
 | ServerMiddlewareFunction
 | ServerMiddlewareName;

/**
 * Resolve a named middleware entry into an executable middleware function.
 *
 * Returning `undefined` indicates that the name could not be resolved. The
 * middleware runner intentionally treats unresolved names as skipped entries and
 * continues the chain. Consumers that require fail-fast behavior should throw
 * from their resolver instead of returning `undefined`.
 */
export type ServerMiddlewareResolver = (name: ServerMiddlewareName) => ServerMiddlewareFunction | undefined;

/**
 * Route-table shorthand keyed by pathname.
 *
 * Each path can resolve to a single handler, a handler object with per-route
 * middleware, or a method map when the same path needs different handlers for
 * different HTTP verbs.
 */
export type ServerRoutes<TPath extends string = string> = {
  [Path in TPath]:
    | ServerHandler
    | ServerMethodHandlers;
};

/**
 * A type-safe key for storing and retrieving values from
 * {@link InvocationContext}.
 *
 * Keys are objects instead of strings so packages can create collision-free
 * context channels without coordinating global names.
 */
export interface InvocationContextKey<TValue> {
  /**
   * The default value for this key if no value has been set.
   */
  defaultValue?: TValue;
}

/**
 * Resolve the runtime value type associated with a context key.
 *
 * Keys created with `createContextKey()` resolve to their declared value type,
 * while constructor keys resolve to the instance type they construct.
 */
export type InvocationContextValue<TKey> =
  TKey extends InvocationContextKey<infer Value>
    ? Value
    : TKey extends abstract new (...args: any[]) => infer Instance
      ? Instance
      : never;

/**
 * Create an invocation context key with an optional default value.
 *
 * When a default value is provided, `InvocationContext#get()` can always
 * return a value for that key even if nothing has been explicitly written yet.
 *
 * @param defaultValue The default value for the context key
 * @returns The new context key
 */
export function createContextKey<TValue>(defaultValue?: TValue): InvocationContextKey<TValue> {
  return { defaultValue };
}

/**
 * Function to register background work that should complete before the server
 * shuts down. Mirrors the service-worker `waitUntil()` semantics.
 *
 * @param promise The background work to track
 */
export type WaitUntilFunction = (promise: Promise<unknown> | PromiseLike<unknown>) => MaybePromise<void>;

/**
 * Initialization options for creating an `InvocationContext`.
 */
export type InvocationContextInit = {
  /** The HTTP request being handled. */
  request: Request;

  /** Runtime capabilities for file system, compression, etc. */
  capabilities: RuntimeCapabilities;

  /** Optional function to register background work for shutdown tracking. */
  waitUntil?: WaitUntilFunction;

  /** Route parameters extracted from the matched route pattern. */
  params?: Readonly<Record<string, string>>;
}

/**
 * A context object that contains information about the current invocation.
 * Each handler and middleware receives its own context instance, which may be
 * derived from a parent context via `with()`.
 *
 * Context values are immutable - use `with()` to create a modified copy.
 */
export class InvocationContext {
  /**
   * The original request that was dispatched to the router.
   *
   * Note: The request body may already have been consumed by middleware
   * (available as `context.get(FormData)`). Use `context.with({ request })`
   * if you need to pass a modified request downstream.
   */
  readonly request: Request;

  /**
   * Cached parsed URL for middleware and handlers that need repeated URL access.
   */
  url: URL | undefined;

  /**
   * Runtime specific invocation context.
   */
  readonly capabilities: RuntimeCapabilities;

  /**
   * The current route parameters for this request.
   *
   * This reflects the active matched route and returns an empty object before
   * routing has resolved a match.
   */
  readonly params: Readonly<Record<string, string>>;

  /**
   * Tell the runtime about an ongoing operation that shouldn't close until the
   * promise resolves.
   *
   * This mirrors service-worker-style `waitUntil()` semantics and is wired into
   * `Server.close()`.
   */
  readonly waitUntil: WaitUntilFunction | undefined;

  #contextMap: Map<object, unknown>;

  constructor(init: InvocationContextInit) {
    this.request = init.request;
    this.capabilities = init.capabilities;
    this.params = init.params ?? emptyRouteParams;
    this.waitUntil = init.waitUntil;
    this.#contextMap = new Map();
  }

  /**
   * Create a derived context with optional overrides.
   * Copies all context values to the new instance.
   */
  with(overrides: Partial<InvocationContextInit>): InvocationContext {
    const child = new InvocationContext({
      request: overrides.request ?? this.request,
      capabilities: overrides.capabilities ?? this.capabilities,
      params: overrides.params ?? this.params,
      waitUntil: overrides.waitUntil ?? this.waitUntil,
    });
    // Copy context values from parent
    for (const [key, value] of this.#contextMap) {
      child.#contextMap.set(key, value);
    }
    return child;
  }

  /**
   * Get a value from invocation context.
   *
   * @param TKey The key to read
   * @returns The value for the given key
   */
  get<TKey extends object>(key: TKey): InvocationContextValue<TKey> {
    if (this.#contextMap.has(key)) {
      return this.#contextMap.get(key) as InvocationContextValue<TKey>;
    }

    const contextKey = key as InvocationContextKey<InvocationContextValue<TKey>>;
    if (contextKey.defaultValue === undefined) {
      throw new Error(`Missing default value in context for key ${key}`);
    }

    return contextKey.defaultValue;
  }

  /**
   * Check whether a value exists in invocation context.
   *
   * @param TKey The key to check
   * @returns `true` if a value has been set for the key
   */
  has<TKey extends object>(key: TKey): boolean {
    return this.#contextMap.has(key);
  }

  /**
   * Set a value in invocation context.
   *
   * @param key The key to write
   * @param value The value to write
   */
  set<TKey extends object>(key: TKey, value: InvocationContextValue<TKey>): void {
    this.#contextMap.set(key, value);
  }
}

/**
 * Reject when the request abort signal fires before the promise settles.
 *
 * This keeps long-running async work aligned with fetch semantics: once the
 * request has been aborted, downstream work should stop surfacing successful
 * results for it.
 */
export function raceRequestAbort<T>(promise: Promise<T>, request: Request): Promise<T> {
  let signal = request.signal;

  if (signal.aborted) {
    throw signal.reason;
  }

  return new Promise<T>((resolve, reject) => {
    let onAbort = () => reject(signal.reason);

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Normalize handlers so middleware runners can treat function and object forms
 * uniformly.
 *
 * A bare handler becomes `{ handle }`, while object handlers are returned
 * unchanged.
 */
export function toServerHandlerObject(
  handler: ServerHandler,
): ServerHandlerObject {
  if (typeof handler === "function") {
    return { handle: handler }
  }
  return handler;
}

/**
 * Type guard to check if a value conforms to the `ServerHandlerObject` shape.
 *
 * This is used to distinguish between a bare `ServerHandlerFunction` and an
 * object wrapper that may also carry per-route middleware.
 */
export function isServerHandlerObject(value: unknown): value is ServerHandlerObject {
  return value != null
    && !Array.isArray(value)
    && typeof value === "object"
    && "handle" in value
    && typeof value.handle === "function";
}

/**
 * Input for running a middleware chain against a terminal handler.
 *
 * `resolve` is only needed when the middleware array may contain named
 * middleware entries instead of executable middleware functions.
 */
export type RunMiddlewareOptions = {
  context: InvocationContext;
  middleware: ServerMiddleware[];
  terminal: ServerHandler;
  resolve?: ServerMiddlewareResolver;
};

/**
 * Execute middleware in sequence and then hand off to the terminal handler.
 *
 * Middleware may:
 * - return a `Response` to short-circuit downstream execution
 * - call `next()` and return its result
 * - call `next()` without returning it, in which case the downstream response
 *   is still used
 *
 * If the terminal handler is a `ServerHandlerObject`, its own `middleware`
 * array is executed after the outer middleware chain completes.
 */
export function runMiddleware({
  context,
  middleware,
  terminal,
  resolve,
}: RunMiddlewareOptions): Promise<Response> {
  let index = -1;

  const dispatch = async (context: InvocationContext, i: number): Promise<Response> => {
    if (i <= index) {
      throw new Error("next() called multiple times");
    }

    index = i;

    if (context.request.signal.aborted) {
      throw context.request.signal.reason;
    }

    const entry = middleware[i];
    if (entry == null) {
      const { middleware, handle } = toServerHandlerObject(terminal);
      if (middleware?.length) {
        return runMiddleware({
          context,
          middleware,
          terminal: handle,
          resolve,
        });
      }
      return await raceRequestAbort(
        Promise.resolve(handle(context)),
        context.request,
      );
    }

    let nextPromise: Promise<Response> | undefined;
    let next: ServerHandlerFunction = (nextContext) => {
      nextPromise = dispatch(nextContext, i + 1);
      return nextPromise;
    };

    const fn = typeof entry === "function" ? entry : resolve?.(entry);
    if (!fn) {
      // Unresolved named middleware is intentionally skipped so resolver
      // implementations can decide whether to ignore or throw.
      return next(context);
    }

    let response = await raceRequestAbort(
      Promise.resolve(fn(context, next)),
      context.request,
    );

    // If a response was returned, short-circuit the chain
    if (response instanceof Response) {
      return response;
    }

    // If the middleware called next(), use the downstream response
    if (nextPromise != null) {
      return nextPromise;
    }

    // If it did not call next(), invoke downstream automatically
    return next(context);
  };

  return dispatch(context, 0);
}

type RouteInput =
  | Request
  | URL
  | string
  | {
    url: string | URL;
    method?: HTTPMethod;
  };

type RouteValue =
  | ServerHandler
  | ServerMethodHandlers;

type CompiledRoute = {
  path: string;
  route: RouteValue;
  regexp: RegExp;
  keys: string[];
};

/**
 * Compiled route table grouped by precedence buckets.
 *
 * Matching order follows Bun-style routing precedence:
 * exact -> param -> wildcard -> catch-all.
 */
type RouteTree = {
  exact: Map<string, RouteValue>;
  param: CompiledRoute[];
  wildcard: CompiledRoute[];
  catchAll?: CompiledRoute;
};

/**
 * A pathname match before HTTP method filtering has been applied.
 */
type RouteCandidate = {
  path: string;
  route: RouteValue;
  params: Record<string, string>;
};

/**
 * A fully resolved route match including the selected handler for the request
 * method.
 */
export type UnstableRouteMatch = RouteCandidate & {
  handler: ServerHandler;
  method?: HTTPMethod;
};

/**
 * Route lookup result containing all pathname candidates and the subset that
 * also match the request method.
 */
export type UnstableRouteMatchResult = {
  all: RouteCandidate[];
  matched: UnstableRouteMatch[];
};

function resolveRouteHandler(
  route: RouteValue,
  method?: HTTPMethod,
): ServerHandler | undefined {
  if (typeof route === "function" || isServerHandlerObject(route)) {
    return route;
  }

  if (method && route[method]) {
    return route[method];
  }

  if (method === "HEAD" && route.GET) {
    return route.GET;
  }

  if (route["*"]) {
    return route["*"];
  }

  return undefined;
}

function resolveRouteMethods(route: RouteValue): HTTPMethod[] {
  if (typeof route === "function" || isServerHandlerObject(route)) {
    return [];
  }

  const methods = Object.keys(route).filter((method) => method !== "*") as HTTPMethod[];
  if (methods.includes("GET") && !methods.includes("HEAD")) {
    methods.push("HEAD");
  }
  return methods;
}

function resolveRouteInput(input: RouteInput): { pathname: string; method?: HTTPMethod } {
  if (typeof input === "string") {
    try {
      return { pathname: new URL(input).pathname };
    } catch {
      return { pathname: input };
    }
  }

  if (input instanceof URL) {
    return { pathname: input.pathname };
  }

  if (input instanceof Request) {
    return {
      pathname: new URL(input.url).pathname,
      method: input.method as HTTPMethod,
    };
  }

  return {
    pathname: typeof input.url === "string"
      ? new URL(input.url).pathname
      : input.url.pathname,
    method: input.method,
  };
}

/**
 * Compile a declarative `ServerRoutes` table into precedence buckets for fast
 * request matching.
 *
 * The build step also rejects conflicting route shapes such as duplicate exact
 * routes or parameter routes that collapse to the same canonical pattern.
 */
export function unstable_buildRouteTree(routes: ServerRoutes): RouteTree {
  const tree: RouteTree = {
    exact: new Map(),
    param: [],
    wildcard: [],
  };
  const seen = new Map<string, string>();

  for (const [path, route] of Object.entries(routes)) {
    const normalized = normalizePathname(path);
    const canonical = canonicalizePath(normalized);
    const previous = seen.get(canonical);

    if (previous) {
      throw new Error(`Conflicting routes: "${previous}" and "${path}" both resolve to "${canonical}".`);
    }

    seen.set(canonical, path);

    const compiled: CompiledRoute = {
      path: normalized,
      route,
      regexp: compilePath(normalized),
      keys: extractKeys(normalized),
    };

    if (normalized === "/*") {
      tree.catchAll = compiled;
      continue;
    }

    if (normalized.includes("*")) {
      tree.wildcard.push(compiled);
      continue;
    }

    if (normalized.includes(":")) {
      tree.param.push(compiled);
      continue;
    }

    tree.exact.set(normalized, route);
  }

  return tree;
}

/**
 * Match a request-like input against a compiled route tree.
 *
 * `all` contains every pathname candidate in precedence order, while
 * `matched` further filters that list by HTTP method and resolves the concrete
 * handler that would run.
 */
export function unstable_match(
  tree: RouteTree,
  input: RouteInput,
): UnstableRouteMatchResult {
  const all: RouteCandidate[] = [];
  const { pathname, method } = resolveRouteInput(input);
  const normalized = normalizePathname(pathname);
  const exact = tree.exact.get(normalized);

  if (exact) {
    all.push({
      path: normalized,
      route: exact,
      params: {},
    });
  }

  for (const compiled of tree.param) {
    const result = compiled.regexp.exec(normalized);
    if (!result) {
      continue;
    }

    all.push({
      path: compiled.path,
      route: compiled.route,
      params: extractParams(compiled.keys, result),
    });
  }

  for (const compiled of tree.wildcard) {
    if (!compiled.regexp.test(normalized)) {
      continue;
    }

    all.push({
      path: compiled.path,
      route: compiled.route,
      params: {},
    });
  }

  if (tree.catchAll && tree.catchAll.regexp.test(normalized)) {
    all.push({
      path: tree.catchAll.path,
      route: tree.catchAll.route,
      params: {},
    });
  }

  const matched = all.flatMap<UnstableRouteMatch>((candidate) => {
    const handler = resolveRouteHandler(candidate.route, method);
    if (!handler) {
      return [];
    }

    return [{ ...candidate, handler, method }];
  });

  return { all, matched };
}

export type UnstableConvertRoutesToHandlerOptions = {
  input: RouteTree;
  fallback?: ServerHandlerFunction;
  runRouteMiddleware?: (options: Omit<RunMiddlewareOptions, "resolve">) => Promise<Response>;
};

/**
 * Turn a precompiled route tree into a `ServerHandlerFunction`.
 *
 * Pathname matches are resolved using Bun-style precedence. When a pathname
 * matches but the method does not, the returned handler responds with `405`
 * and an `Allow` header. If no route matches, `fallback` is used when
 * provided; otherwise a `404` response is returned.
 */
export function unstable_convertRoutesToHandler({
  input,
  fallback,
  runRouteMiddleware,
}: UnstableConvertRoutesToHandlerOptions): ServerHandlerFunction {
  return async (context) => {
    const result = unstable_match(input, context.request);
    const route = result.matched[0];

    if (route) {
      context = context.with({ params: route.params });

      if (typeof route.handler === "function") {
        return route.handler(context);
      }

      if (!route.handler.middleware?.length) {
        return route.handler.handle(context);
      }

      if (!runRouteMiddleware) {
        throw new Error("Route handler middleware requires `runRouteMiddleware`.");
      }

      return runRouteMiddleware({
        context,
        middleware: route.handler.middleware,
        terminal: route.handler.handle,
      });
    }

    if (result.all.length > 0) {
      const allow = new Set<HTTPMethod>();
      for (const candidate of result.all) {
        for (const method of resolveRouteMethods(candidate.route)) {
          allow.add(method);
        }
      }

      const headers = allow.size > 0 ? { Allow: [...allow].join(", ") } : undefined;
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    if (fallback) {
      return fallback(context);
    }

    return new Response("Not Found", { status: 404 });
  };
}

/**
 * Configuration for request routing and handling.
 *
 * Defines how incoming requests are matched, processed, and handled through
 * routes, middleware, and error handlers. These options can be updated at
 * runtime via `Server.updateRouting()`.
 */
export type RoutingOptions = {
  /**
   * Declarative route table matched before the fallback `fetch` handler.
   *
   * If this table does not define `/*`, `fetch` must be provided to handle
   * unmatched requests.
   */
  routes?: ServerRoutes;

  /**
   * Fallback request handler.
   *
   * When `routes` is provided, this handles requests that do not match the
   * route table. When `routes` is omitted, this acts as the primary request
   * handler.
   */
  fetch?: ServerHandlerFunction;

  /**
   * Handle errors raised while processing requests.
   *
   * @note This handler will set built-in Bun and Deno error handler.
   */
  error?: ErrorHandler;

  /**
   * Server middleware handlers to run before the main fetch handler.
   *
   * Middleware is executed in the order provided.
   */
  middleware?: ServerMiddleware[];

  /**
   * Resolve named middleware entries at request execution time.
   *
   * When omitted, named middleware entries are skipped. Throw from the resolver
   * if unresolved names should fail the request instead.
   */
  middlewareResolver?: ServerMiddlewareResolver;
}

/**
 * Build the request handler pipeline from routing configuration.
 *
 * Combines routes, middleware, error handling, and the fallback fetch handler
 * into a single composed function that processes incoming requests. This is the
 * core request processing kernel used by `Server`.
 */
export function wrapFetch(options: RoutingOptions): ServerHandlerFunction {
  const fetchHandler = options.fetch;
  const routes = options.routes;
  const middleware = options.middleware?.slice() ?? [];
  const callMiddleware = (runOptions: Omit<RunMiddlewareOptions, "resolve">) => runMiddleware({
    ...runOptions,
    resolve: options.middlewareResolver,
  });

  let handler: ServerHandlerFunction;
  if (!routes) {
    if (!fetchHandler) {
      throw new Error("Server requires either `routes` or `fetch`.");
    }
    handler = fetchHandler;
  } else {
    if (!routes["/*"]) {
      if (!fetchHandler) {
        throw new Error("Route tables without `/*` require a fallback `fetch` handler.");
      }
    }
    handler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree(routes),
      fallback: fetchHandler,
      runRouteMiddleware: callMiddleware,
    });
  }

  const errorHandler = options.error;
  if (errorHandler) {
    middleware.unshift((ctx, next) => {
      try {
        const res = next(ctx);
        return res instanceof Promise ? res.catch((error) => errorHandler(error)) : res;
      } catch (error) {
        return errorHandler(error);
      }
    });
  }

  return middleware.length === 0
    ? handler
    : (context) => callMiddleware({
      context,
      middleware,
      terminal: handler,
    });
}

/**
 * Internal helper used to track background tasks registered through
 * `waitUntil()`.
 */
export interface WaitUntil {
  waitUntil(promise: Promise<any> | PromiseLike<any>): void;
  wait(): Promise<any>;
}

/**
 * Create a `waitUntil()` registry that keeps track of pending background work.
 *
 * Rejected tasks are logged and removed from the registry so shutdown can
 * continue cleanly.
 */
export function createWaitUntil(): WaitUntil {
  const promises = new Set<Promise<any> | PromiseLike<any>>();

  return {
    waitUntil: (promise: Promise<any> | PromiseLike<any>): void => {
      if (typeof promise?.then !== "function") return;
      let tracked: Promise<unknown>;
      tracked = Promise.resolve(promise)
        .catch(console.error)
        .finally(() => promises.delete(tracked));
      promises.add(tracked);
    },
    wait: (): Promise<any> => {
      return Promise.all(promises);
    },
  };
}

const emptyRouteParams = Object.freeze({}) as Record<string, string>;

/**
 * Host capabilities required by middleware and helpers that need filesystem or
 * compression support.
 */
export interface RuntimeCapabilities {
  /**
   * Resolve a path relative to `root`.
   *
   * Returns `null` when the resolved path would escape the root directory.
   */
  resolve(root: string, ...components: string[]): Promise<string | null>;

  /**
   * Open a path for static file serving.
   *
   * Returns `null` when the path does not exist.
   */
  open(path: string): Promise<
    | { readonly isFile: false }
    | {
      readonly isFile: true;
      readonly size: number;
      stream: (start?: number, end?: number) => ReadableStream;
    }
    | null
  >;

  /**
   * Create a gzip compression transform.
   */
  createGzip(): MaybePromise<TransformStream>;

  /**
   * Create a Brotli compression transform.
   */
  createBrotliCompress(): MaybePromise<TransformStream>;
}

/**
 * Lifecycle hooks required to host a `Server` in a specific runtime.
 *
 * `setup()` prepares runtime-specific state, `serve()` starts listening,
 * and `close()` shuts the runtime down.
 */
export interface RuntimeAdapter {
  /**
   * Runtime-specific helpers exposed to middleware and request handlers.
   */
  readonly capabilities: RuntimeCapabilities;

  /**
   * Whether the adapter/runtime should be treated as supporting graceful
   * process shutdown integration.
   */
  readonly graceful?: boolean;

  onerror?: ErrorHandler;

  /**
   * Prepare runtime-specific state before the server starts listening.
   */
  setup: (server: Server) => void;

  /**
   * Start serving requests and resolve once the adapter knows the public URL.
   */
  serve: (server: Server) => Promise<{ url: string | undefined } | undefined>;

  /**
   * Stop accepting new work and optionally terminate active connections.
   */
  close: (closeActiveConnections: boolean) => Promise<void>;
}

/**
 * Bun's native server options, excluding the fetch handler owned by `Server`.
 */
export type BunServerOptions = Omit<Bun.Serve.Options<any>, "fetch" | "routes" | "unix">;

/**
 * Deno's native serve options.
 */
export type DenoServerOptions = Deno.ServeOptions;

/**
 * Node.js server options.
 */
export type NodeServerOptions = (
  | NodeHttp.ServerOptions
  | NodeHttps.ServerOptions
  | NodeHttp2.ServerOptions
) &
  NodeNet.ListenOptions &
{
  http2?: boolean;
  onError?: ErrorHandler;
};

/**
 * Resolve the runtime adapter for the current process.
 *
 * The adapter is chosen lazily so the package can stay portable across Bun,
 * Deno, and Node without importing runtime-specific code up front.
 */
export async function loadServerAdapter(): Promise<RuntimeAdapter> {
  if (process.versions.bun) {
    const { BunRuntimeAdapter } = await import("sevok/bun");
    return new BunRuntimeAdapter();
  } else if (process.versions.deno) {
    const { DenoRuntimeAdapter } = await import("sevok/deno");
    return new DenoRuntimeAdapter();
  } else {
    const { NodeRuntimeAdapter } = await import("sevok/node");
    return new NodeRuntimeAdapter();
  }
}

/**
 * Deferred runtime adapter options used while the real adapter module loads.
 */
interface PlaceholderRuntimeAdapterCallback {
  (error: any, adapter: null): void;
  (error: null, adapter: RuntimeAdapter): void;
};

/**
 * Temporary adapter that rejects server operations until the real runtime
 * adapter has been resolved asynchronously.
 */
class PlaceholderRuntimeAdapter implements RuntimeAdapter {
  #callback: PlaceholderRuntimeAdapterCallback;

  constructor(callback: PlaceholderRuntimeAdapterCallback) {
    this.#callback = callback;
  }

  get capabilities(): RuntimeCapabilities {
    throw new Error("Server runtime adapter is still initializing.");
  }

  setup(): void {
    loadServerAdapter().then(
      (adapter) => this.#callback(null, adapter),
      (error) => this.#callback(error, null),
    );
  }

  async serve(): Promise<undefined> {
    throw new Error("Server runtime adapter is still initializing.");
  }

  async close(): Promise<void> { }
}

/**
 * Emitted after the server starts accepting requests.
 */
export class ServerServeEvent extends Event {
  constructor() {
    super("serve");
  }
}

/**
 * Emitted after the server has fully closed.
 */
export class ServerCloseEvent extends Event {
  constructor() {
    super("close");
  }
}

/**
 * Emitted when server startup or runtime handling raises an error.
 */
export class ServerErrorEvent extends Event {
  readonly error: any;

  constructor(error?: any) {
    super("error");
    this.error = error;
  }
}

/**
 * Event fired when the server's routing configuration is updated.
 *
 * This event is dispatched after `updateRouting()` successfully replaces the
 * request handler pipeline with new routes, middleware, or error handlers.
 */
export class ServerUpdateEvent extends Event {
  /**
   * Describes what triggered the update.
   */
  readonly reason: string;

  constructor(reason: string = 'routing') {
    super("update");
    this.reason = reason;
  }
}

/**
 * TLS server options.
 *
 * These are normalized by individual runtime adapters before being handed to
 * Bun, Deno, or Node.
 */
export type TLSOptions = {
  /**
   * File path or inlined TLS certificate in PEM format (required).
   */
  cert?: string;

  /**
   * File path or inlined TLS private key in PEM format (required).
   */
  key?: string;

  /**
   * Passphrase for the private key (optional).
   */
  passphrase?: string;
};

/**
 * Core server configuration shared by all runtime adapters.
 *
 * These options describe request handling behavior, listener defaults, and
 * process-level features such as graceful shutdown.
 */
export interface ServerOptions {
  /**
   * If set to `true`, server will not start listening automatically.
   */
  manual?: boolean;

  /**
   * The port server should be listening to.
   *
   * Default is read from `PORT` environment variable or will be `3000`.
   *
   * **Tip:** You can set the port to `0` to use a random port.
   */
  port?: string | number;

  /**
   * The hostname (IP or resolvable host) server listener should bound to.
   *
   * When not provided, server with listen to all network interfaces by default.
   *
   * **Important:** If you are running a server that is not expected to be exposed to the network, use `hostname: "localhost"`.
   */
  hostname?: string;

  /**
   * Enabling this option allows multiple processes to bind to the same port, which is useful for load balancing.
   *
   * **Note:** Despite Node.js built-in behavior that has `exclusive` flag (opposite of `reusePort`) enabled by default, sevok uses non-exclusive mode for consistency.
   */
  reusePort?: boolean;

  /**
   * The protocol to use for the server.
   *
   * Possible values are `http` and `https`.
   *
   * If `protocol` is not set, Server will use `http` as the default protocol or `https` if both `tls.cert` and `tls.key` options are provided.
   */
  protocol?: "http" | "https";

  /**
   * TLS server options.
   */
  tls?: TLSOptions;

  /**
   * If set to `true`, server will not print the listening address.
   */
  silent?: boolean;

  /**
   * Graceful shutdown on SIGINT and SIGTERM signals.
   *
   * Supported for Node.js, Deno and Bun runtimes.
   *
   * @default true (disabled in test and ci environments)
   */
  gracefulShutdown?: boolean | { gracefulTimeout?: number; forceTimeout?: number };

  /**
   * Deno-specific adapter options.
   */
  deno?: DenoServerOptions;

  /**
   * Bun-specific adapter options.
   */
  bun?: BunServerOptions;

  /**
   * Node.js-specific adapter options.
   */
  node?: NodeServerOptions;
}

/**
 * Constructor input for creating a `Server`.
 *
 * Extends the base server options with the runtime adapter and optional
 * plugins that can mutate server behavior before the adapter is set up.
 */
export interface ServerInit extends RoutingOptions, ServerOptions {
  /**
   * Runtime adapter responsible for integrating with the host environment.
   */
  adapter?: RuntimeAdapter;
}

/**
 * Convenience factory for creating a `Server` without `new`.
 */
export function serve(init: ServerInit): Server {
  return new Server(init);
}

/**
 * Augmentation hook for adding application-specific `Server` events.
 *
 * Consumers can extend this interface with module augmentation so custom event
 * names become part of `ServerEventMap`.
 *
 * @example
 * ```ts
 * declare module "sevok" {
 *   interface ServerEventMapCustom {
 *     reload: CustomEvent<{ full: boolean }>;
 *   }
 * }
 * ```
 */
export interface ServerEventMapCustom { }

/**
 * Complete typed event map for `Server`.
 *
 * Combines built-in lifecycle events with any consumer-defined events added
 * through `ServerEventMapCustom` augmentation.
 */
export interface ServerEventMap extends ServerEventMapCustom {
  /** Fired after the runtime adapter reports that the server is serving. */
  serve: ServerServeEvent;
  /** Fired after shutdown has completed and background work has settled. */
  close: ServerCloseEvent;
  /** Fired when adapter initialization fails with a non-abort error. */
  error: ServerErrorEvent;
  /** Fired when the server's routing configuration is updated. */
  update?: ServerUpdateEvent;
}

/**
 * Runtime-agnostic fetch server.
 *
 * `Server` owns middleware composition, per-invocation context setup, background
 * task tracking, and runtime lifecycle coordination. Concrete adapters handle
 * the host-specific details of listening for requests.
 */
export class Server extends EventDispatcher<ServerEventMap> {
  /**
   * Server options.
   */
  readonly options: ServerOptions;

  /**
   * Register a background task that the server should await before closing.
   *
   * Same as `request.waitUntil` but available at the server level for use
   * outside of request handlers.
   */
  readonly waitUntil?: (promise: Promise<unknown>) => void;

  #wait: WaitUntil | undefined;
  #kernel: ServerHandlerFunction;
  #adapter: RuntimeAdapter;
  #url?: string;
  #version: number;

  #adapterPromise?: Promise<void> | undefined;
  #rejectAdapter?: ((reason?: any) => void) | undefined;

  #readyPromise?: Promise<void>;
  #rejectReady?: (reason?: unknown) => void;
  #closePromise?: Promise<void>;

  /**
   * Create a server, apply plugins, prepare the runtime adapter, and optionally
   * start listening immediately.
   */
  constructor({
    routes,
    fetch,
    error,
    middleware,
    middlewareResolver,
    adapter,
    ...options
  }: ServerInit) {
    super();

    if (!fetch && (!routes || !routes["/*"])) {
      throw new Error("Server requires either `fetch` or a `routes` table with `/*`.");
    }

    this.options = options;

    this.#version = 0;
    this.#wait = createWaitUntil();
    this.waitUntil = this.#wait.waitUntil;

    this.#kernel = () => {
      throw new Error(
        "Server request handler is not ready until the runtime adapter finishes initializing.",
      );
    };

    const initializeAdapter = (adapter: RuntimeAdapter, resolve?: () => void) => {
      if (adapter.graceful) {
        gracefulShutdownPlugin(this);
      }

      const kernel = wrapFetch({
        routes,
        fetch,
        error,
        middleware,
        middlewareResolver,
      });

      adapter.onerror = error;
      adapter.setup(this);

      this.#adapter = adapter;
      this.#kernel = kernel;

      if (!options.manual) {
        this.#startServing();
      }

      resolve?.();
    };

    if (adapter) {
      this.#adapter = adapter;
      initializeAdapter(adapter);
      return;
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    this.#adapterPromise = promise;
    this.#rejectAdapter = reject;

    void promise
      .catch(() => { })
      .finally(() => {
        this.#adapterPromise = undefined;
        this.#rejectAdapter = undefined;
      });

    this.#adapter = new PlaceholderRuntimeAdapter((error, adapter) => {
      if (adapter != null) {
        initializeAdapter(adapter, resolve);
      } else {
        reject(error);
        if (!(error instanceof Error) || error.name !== "AbortError") {
          this.dispatchEvent(new ServerErrorEvent(error));
        }
      }
    });

    this.#adapter.setup(this);
  }

  /**
   * Listener URL reported by the runtime adapter after `serve()` succeeds.
   */
  get url(): string | undefined {
    return this.#url;
  }

  /**
   * Update the server's routing configuration at runtime.
   *
   * Replaces the current request handler pipeline with new routes, middleware,
   * error handlers, and fetch handler. This operation is atomic and safe to call
   * while the server is actively handling requests.
   *
   * If multiple `updateRouting()` calls are made concurrently, only the most
   * recent one will take effect. Earlier calls that are still waiting for adapter
   * initialization will be cancelled automatically.
   *
   * @param options - New routing configuration to apply
   * @throws {Error} If neither `fetch` nor a `routes` table with `/*` is provided
   *
   * @example
   * ```ts
   * await server.updateRouting({
   *   routes: {
   *     '/api/*': apiHandler,
   *     '/*': fallbackHandler
   *   },
   *   middleware: [loggingMiddleware, authMiddleware]
   * });
   * ```
   */
  async updateRouting(options: RoutingOptions): Promise<void> {
    if (!options.fetch && (!options.routes || !options.routes["/*"])) {
      throw new Error("Server requires either `fetch` or a `routes` table with `/*`.");
    }

    const version = ++this.#version;

    if (this.#adapterPromise) {
      await this.#adapterPromise;
    }

    if (version !== this.#version) {
      return;
    }

    this.#adapter.onerror = options.error;
    this.#kernel = wrapFetch(options);

    this.dispatchEvent(new ServerUpdateEvent('routing'));
  }

  /**
   * Create a `InvocationContext` view over an arbitrary `Request`.
   *
   * This preserves the upstream request object and pairs it with sevok
   * invocation state such as runtime capabilities, `waitUntil`, and `params`.
   */
  createContext(request: Request, params?: Readonly<Record<string, string>>): InvocationContext {
    return new InvocationContext({
      request,
      capabilities: this.#adapter.capabilities,
      waitUntil: this.#wait?.waitUntil,
      params,
    });
  }

  /**
   * Invoke the composed request pipeline directly.
   *
   * If runtime adapter initialization is still in flight, this waits for the
   * adapter setup to finish before dispatching the request.
   */
  handle(context: InvocationContext): MaybePromise<Response> {
    if (this.#adapterPromise) {
      return this.#adapterPromise.then(() => this.#kernel(context));
    }
    return this.#kernel(context);
  }

  /**
   * Adapt an arbitrary `Request` into an `InvocationContext` and invoke the handler pipeline.
   */
  async fetch(request: Request): Promise<Response> {
    if (this.#adapterPromise) {
      await this.#adapterPromise;
    }

    return await this.handle(this.createContext(request));
  }

  #startServing(): void {
    if (this.#readyPromise) {
      return;
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    this.#readyPromise = promise;
    this.#rejectReady = reject;
    this.#url = undefined;

    this.#adapter.serve(this).then((info) => {
      this.#url = info?.url;
      this.dispatchEvent(new ServerServeEvent());
      resolve();
    }, reject);
  }

  /**
   * Start the runtime adapter if it has not been started already.
   *
   * The returned promise resolves once the adapter reports the final listener
   * URL. Repeated calls reuse the same in-flight startup.
   */
  async serve(): Promise<void> {
    if (this.#readyPromise) {
      return;
    }

    if (this.#adapterPromise) {
      await this.#adapterPromise;
    }

    this.#startServing();
  }

  /**
   * Wait until the server has completed startup and then return the instance.
   *
   * This is mainly a convenience for fluent startup code.
   */
  async ready(): Promise<Server> {
    if (this.#adapterPromise) {
      await this.#adapterPromise;
    }

    if (!this.#readyPromise) {
      throw new Error("Server has not been started. Call serve() first.");
    }

    return Promise.resolve(this.#readyPromise).then(() => this);
  }

  /**
   * Close the runtime adapter and wait for outstanding `waitUntil()` tasks.
   *
   * If startup was still in progress, `ready()` is rejected with an
   * `AbortError`.
   */
  async close(closeActiveConnections = false): Promise<void> {
    if (this.#closePromise) {
      return this.#closePromise;
    }

    const finalizeClose = async () => {
      try {
        if (this.#rejectAdapter) {
          const error = new Error("Server closed before adapter initialization completed.");
          error.name = "AbortError";
          this.#rejectAdapter(error);
        }

        await Promise.all([this.#adapter.close(closeActiveConnections), this.#wait?.wait()]);
      } finally {
        if (this.#rejectReady) {
          const error = new Error("Server closed before becoming ready.");
          error.name = "AbortError";
          this.#rejectReady(error);
          this.#rejectReady = undefined;
        }
        this.dispatchEvent(new ServerCloseEvent());
      }
    };

    this.#closePromise = finalizeClose().finally(() => {
      this.#readyPromise = undefined;
      this.#closePromise = undefined;
    });

    return this.#closePromise;
  }
}

/**
 * Register process signal handlers that close the server gracefully.
 *
 * The first `SIGINT` / `SIGTERM` starts a graceful shutdown countdown. A second
 * `SIGINT` forces active connections to close immediately.
 */
function gracefulShutdownPlugin(server: Server) {
  const config = server.options?.gracefulShutdown;
  if (
    !globalThis.process?.on ||
    config === false ||
    (config === undefined && (process.env.CI || process.env.TEST))
  ) {
    return;
  }

  const gracefulTimeout =
    config === true || !config?.gracefulTimeout
      ? Number.parseInt(process.env.SERVER_SHUTDOWN_TIMEOUT || "") || 5
      : config.gracefulTimeout;

  let isClosing = false;
  let isClosed = false;

  // Silence shutdown progress when the server itself is configured as silent.
  const write = server.options.silent
    ? () => { }
    : process.stderr.write.bind(process.stderr);

  /**
   * Forcefully close active connections once graceful shutdown times out or the
   * user presses Ctrl+C again.
   */
  const forceClose = async () => {
    if (isClosed) return;
    write(c.red("\x1b[2K\rForcibly closing connections...\n"));
    isClosed = true;
    await server.close(true);
  };

  /**
   * Attempt to close the server cleanly while printing countdown updates.
   */
  const shutdown = async () => {
    if (isClosing || isClosed) {
      return;
    }

    // Force close with second Ctrl+C
    // CLIs might trigger multiple SIGINTs, so we delay the listener registration
    setTimeout(() => {
      globalThis.process.once("SIGINT", forceClose);
    }, 100);

    isClosing = true;
    const closePromise = server.close();

    // Countdown with updates each second
    for (let remaining = gracefulTimeout; remaining > 0; remaining--) {
      write(
        c.gray(
          `\rStopping server gracefully (${remaining}s)... Press ${c.bold("Ctrl+C")} again to force close.`,
        ),
      );
      const closed = await Promise.race([
        closePromise.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), 1000)),
      ]);
      if (closed) {
        write("\x1b[2K\r" + c.green("Server closed successfully.\n"));
        isClosed = true;
        return;
      }
    }

    // Graceful period expired: force close
    write("\x1b[2K\rGraceful shutdown timed out.\n");
    await forceClose();
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    globalThis.process.on(sig, shutdown);
  }

  server.addEventListener('close', () => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      globalThis.process.off(sig, shutdown);
    }
  }, { once: true });
}
