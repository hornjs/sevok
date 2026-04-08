# sevok

Web-standard server primitives with context-based handlers, middleware, and runtime adapters for Bun, Deno, Node.js, and stream-based hosts.

[简体中文](./README.zh-CN.md) • [GitHub](https://github.com/hornjs/sevok)

## Features

- Context-based request handling built on standard `Request` and `Response`
- Declarative route tables with Bun-style precedence and `fetch` fallback
- Ordered middleware pipeline with short-circuiting and abort awareness
- Per-invocation context via `InvocationContext`
- Typed lifecycle events powered by [`@hornjs/evt`](https://github.com/hornjs/evt)
- `waitUntil()` support for background tasks during shutdown
- Runtime adapters for `Bun.serve()`, `Deno.serve()`, Node HTTP/HTTPS/HTTP2, and async event streams
- Static file middleware with HTML fallback and gzip / Brotli support

## Installation

```bash
pnpm add sevok
```

## Package Exports

```ts
import { Server, serve } from "sevok";
import { BunRuntimeAdapter } from "sevok/bun";
import { DenoRuntimeAdapter } from "sevok/deno";
import { NodeRuntimeAdapter } from "sevok/node";
import { StreamRuntimeAdapter } from "sevok/stream";
import { log } from "sevok/log";
import { serveStatic } from "sevok/static";
```

## Core Concepts

### `Server`

`Server` is the runtime-agnostic request kernel. It owns:

- middleware composition
- invocation context setup
- background task tracking with `waitUntil()`
- startup and shutdown coordination with a runtime adapter

`adapter` is optional. In Bun, Deno, and Node.js environments, `Server` can
auto-detect the current runtime and lazily load the matching built-in adapter
with dynamic imports such as `import("sevok/bun")`,
`import("sevok/deno")`, and `import("sevok/node")`.

You usually only need to pass `adapter` when you want to customize native
runtime options, force a specific adapter, or run in a non-standard host such
as an async event stream.

### Middleware

Middleware receives `(ctx, next)` and can:

- return a `Response` immediately
- call `next(ctx)` and return the downstream response
- access the request via `ctx.request`
- use `ctx.set()` / `ctx.get()` to share state

### Routes And Fallbacks

`routes` is the primary routing surface. It is matched before `fetch` using
Bun-style precedence:

- exact route
- parameter route
- wildcard route
- catch-all route

`fetch` is the fallback handler for unmatched requests. If you omit `fetch`,
your route table must include `/*`.

Each route entry can also use a method map:

```ts
{
  "/users": {
    GET: () => new Response("list"),
    POST: () => new Response("create"),
    "*": () => new Response("method fallback"),
  },
}
```

Method selection prefers the explicit request method first, then falls back
from `HEAD` to `GET`, and finally uses `*` for any method that does not have an
explicit handler. The `Allow` header for `405 Method Not Allowed` responses
still lists only the explicit methods.

### Invocation Context

Use `createContextKey()` and `ctx.set()` / `ctx.get()` to share per-invocation state safely across middleware and handlers.

### Lifecycle Events

`Server` extends the typed `EventDispatcher` from [`@hornjs/evt`](https://github.com/hornjs/evt) and emits
four lifecycle events:

- `serve`: fired after the runtime adapter reports a listening URL
- `update`: fired when routing configuration is updated via `server.update()`
- `close`: fired after shutdown completes and `waitUntil()` work has settled
- `error`: fired when asynchronous adapter initialization fails

```ts
import { Server, ServerErrorEvent, ServerServeEvent, ServerUpdateEvent } from "sevok";

server.addEventListener("serve", (event: ServerServeEvent) => {
  console.log("server ready", server.url);
});

server.addEventListener("update", (event: ServerUpdateEvent) => {
  console.log("routing updated", event.reason);
});

server.addEventListener("error", (event: ServerErrorEvent) => {
  console.error("server failed", event.error);
});
```

## Basic Example

```ts
import { Server, createContextKey } from "sevok";

const requestIdKey = createContextKey<string>("unknown");

const server = new Server({
  middleware: [
    async (ctx, next) => {
      ctx.set(requestIdKey, crypto.randomUUID());
      return next(ctx);
    },
  ],
  routes: {
    "/": async (ctx) => {
      return Response.json({
        id: ctx.get(requestIdKey),
        pathname: new URL(ctx.request.url).pathname,
      });
    },
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

await server.ready();
console.log(server.url);
```

## Runtime Adapters

### Bun

```ts
import { Server } from "sevok";
import { BunRuntimeAdapter } from "sevok/bun";

const server = new Server({
  adapter: new BunRuntimeAdapter(),
  middleware: [],
  routes: {
    "/": () => new Response("Hello from Bun"),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

await server.ready();
```

### Deno

```ts
import { Server } from "sevok";
import { DenoRuntimeAdapter } from "sevok/deno";

const server = new Server({
  adapter: new DenoRuntimeAdapter(),
  middleware: [],
  routes: {
    "/": () => new Response("Hello from Deno"),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

await server.ready();
```

### Node.js

```ts
import { Server } from "sevok";
import { NodeRuntimeAdapter } from "sevok/node";

const server = new Server({
  adapter: new NodeRuntimeAdapter(),
  middleware: [],
  routes: {
    "/": () => new Response("Hello from Node"),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

await server.ready();
```

### Stream Runtime

The stream adapter is useful when a host runtime already exposes fetch events through an async iterator.

```ts
import { Server } from "sevok";
import { StreamRuntimeAdapter } from "sevok/stream";

async function* stream() {
  while (true) {
    const event = await getNextFetchEvent();
    yield event;
  }
}

const server = new Server({
  adapter: new StreamRuntimeAdapter({
    stream: stream(),
    url: "/worker",
  }),
  middleware: [],
  routes: {
    "/": () => new Response("Hello from stream"),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

await server.serve();
```

## Static Files

Use `serveStatic()` as regular middleware.

```ts
import { Server } from "sevok";
import { NodeRuntimeAdapter } from "sevok/node";
import { serveStatic } from "sevok/static";

const server = new Server({
  adapter: new NodeRuntimeAdapter(),
  middleware: [
    serveStatic({
      dir: "./public",
      renderHTML: async ({ html, filename }) => {
        return new Response(html.replace("</body>", `<p>${filename}</p></body>`), {
          headers: { "content-type": "text/html" },
        });
      },
    }),
  ],
  fetch: () => new Response("Not Found", { status: 404 }),
});
```

Static resolution rules:

- `/` -> `index.html`
- `/about` -> `about.html`, then `about/index.html`
- explicit extensions are used as-is

If the client accepts compression, Brotli is preferred over gzip when the runtime supports it.

## TLS

For Bun, Deno, and Node, TLS material can be provided either as inline PEM strings or file paths:

```ts
const server = new Server({
  adapter: new NodeRuntimeAdapter(),
  protocol: "https",
  tls: {
    cert: "./certs/dev-cert.pem",
    key: "./certs/dev-key.pem",
  },
  middleware: [],
  fetch: () => new Response("secure"),
});
```

If `protocol` is explicitly set to `"https"`, both `cert` and `key` must be present.

## Manual Startup and Shutdown

Set `manual: true` when you want explicit lifecycle control.

```ts
const server = new Server({
  adapter: new NodeRuntimeAdapter(),
  manual: true,
  middleware: [],
  fetch: () => new Response("ok"),
});

await server.serve();
await server.ready();

server.waitUntil?.(
  Promise.resolve().then(() => {
    console.log("background work");
  }),
);

await server.close();
```

`Server.close()` waits for:

- the runtime adapter to close
- all promises registered via `waitUntil()`

You can observe the same transitions through events:

```ts
server.addEventListener("serve", () => {
  console.log("listening");
});

server.addEventListener("close", () => {
  console.log("closed");
});
```

## API Overview

Main export:

- `Server`
- `ServerServeEvent`
- `ServerCloseEvent`
- `ServerErrorEvent`
- `ServerUpdateEvent`
- `serve`
- `createContextKey`
- `InvocationContext`
- `runMiddleware`
- `wrapFetch`
- `loadRuntimeAdapter`
- `ServerErrorHandler`
- `ServerHandler`
- `ServerHandlerFunction`
- `ServerHandlerObject`
- `ServerMiddleware`
- `ServerMiddlewareFunction`
- `ServerRoutes`
- `toServerHandlerObject`
- `raceRequestAbort`
- `createWaitUntil`

Subpath exports:

- `sevok/bun` - `BunRuntimeAdapter`
- `sevok/cli` - CLI utilities
- `sevok/deno` - `DenoRuntimeAdapter`
- `sevok/log` - Logging utilities
- `sevok/node` - `NodeRuntimeAdapter`
- `sevok/static` - `serveStatic`
- `sevok/stream` - `StreamRuntimeAdapter`

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```
