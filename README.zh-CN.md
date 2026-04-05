# servok

基于 Fetch API 的服务端基础库，提供中间件、调用上下文，以及 Bun、Deno、Node.js、流式事件宿主的运行时适配器。

[English](./README.md)

## 特性

- 以标准 `Request` / `Response` 为中心的请求处理模型
- 声明式路由表，支持 Bun 风格优先级与 `fetch` 兜底
- 有顺序、可短路、支持中止信号的中间件链
- 基于 `InvocationContext` 的调用级上下文
- 基于 [`@hornjs/evt`](https://github.com/hornjs/evt) 的类型安全生命周期事件
- 通过 `waitUntil()` 跟踪后台任务并在关闭时等待完成
- 支持 `Bun.serve()`、`Deno.serve()`、Node HTTP/HTTPS/HTTP2、异步事件流
- 提供静态文件中间件，支持 HTML fallback 与 gzip / Brotli 压缩

## 安装

```bash
pnpm add servok
```

## 导出入口

```ts
import { Server, serve } from "servok";
import { BunRuntimeAdapter } from "servok/bun";
import { DenoRuntimeAdapter } from "servok/deno";
import { NodeRuntimeAdapter } from "servok/node";
import { log } from "servok/log";
import { serveStatic } from "servok/static";
import { StreamRuntimeAdapter } from "servok/stream";
```

## 核心概念

### `Server`

`Server` 是运行时无关的请求内核，负责：

- 组合中间件
- 初始化调用上下文
- 跟踪 `waitUntil()` 注册的后台任务
- 协调 runtime adapter 的启动与关闭

`adapter` 是可选的。在 Bun、Deno、Node.js 环境下，通常可以不显式传入；
`Server` 会根据当前运行时自动检测，并通过
`import("servok/bun")`、`import("servok/deno")`、
`import("servok/node")` 这类动态导入懒加载内置 adapter。

一般只有这些场景才需要手动指定 `adapter`：

- 你需要显式定制 Bun、Deno、Node 的原生 adapter 参数
- 你想强制使用某个特定 adapter，而不是依赖自动检测
- 你运行在内置 Bun、Deno、Node 之外的宿主环境中，比如异步事件流

### 中间件

中间件签名为 `(ctx, next)`，可以：

- 直接返回一个 `Response`
- 调用 `next(ctx)` 并返回下游结果
- 通过 `ctx.request` 访问请求
- 使用 `ctx.set()` / `ctx.get()` 共享状态

### 路由与兜底处理

`routes` 是主路由表，会在 `fetch` 之前按 Bun 风格优先级进行匹配：

- 精确路由
- 参数路由
- wildcard 路由
- catch-all 路由

`fetch` 是未命中路由时的兜底处理函数。如果省略 `fetch`，那么
`routes` 必须包含 `/*`。

### 调用上下文

使用 `createContextKey()` 与 `ctx.set()` / `ctx.get()` 可以安全地在中间件和处理函数之间共享调用级状态。

### 生命周期事件

`Server` 继承自 [`@hornjs/evt`](https://github.com/hornjs/evt) 的类型化 `EventDispatcher`，目前会发出三个生命周期事件：

- `serve`：runtime adapter 报告监听地址后触发
- `close`：关闭完成且 `waitUntil()` 后台任务全部结束后触发
- `error`：异步初始化 runtime adapter 失败时触发

```ts
import { Server, ServerErrorEvent, ServerServeEvent } from "servok";

server.addEventListener("serve", (event: ServerServeEvent) => {
  console.log("server ready", server.url);
});

server.addEventListener("error", (event: ServerErrorEvent) => {
  console.error("server failed", event.error);
});
```

## 基础示例

```ts
import { Server, createContextKey } from "servok";

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

## Runtime Adapter

### Bun

```ts
import { Server } from "servok";
import { BunRuntimeAdapter } from "servok/bun";

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
import { Server } from "servok";
import { DenoRuntimeAdapter } from "servok/deno";

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
import { Server } from "servok";
import { NodeRuntimeAdapter } from "servok/node";

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

### Stream

当宿主环境已经把请求封装成异步事件流时，可以使用 `StreamRuntimeAdapter`。

```ts
import { Server } from "servok";
import { StreamRuntimeAdapter } from "servok/stream";

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

## 静态文件

`serveStatic()` 可以直接作为普通中间件使用。

```ts
import { Server } from "servok";
import { NodeRuntimeAdapter } from "servok/node";
import { serveStatic } from "servok/static";

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

静态资源解析规则：

- `/` -> `index.html`
- `/about` -> 依次尝试 `about.html`、`about/index.html`
- 已带扩展名的路径按原样解析

当客户端声明支持压缩时，如果运行时支持，会优先使用 Brotli，否则退回 gzip。

## TLS

在 Bun、Deno、Node 中，TLS 证书既可以传 PEM 内容，也可以传文件路径：

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

如果显式设置了 `protocol: "https"`，那么 `cert` 和 `key` 必须同时提供。

## 手动控制生命周期

如果你想自己控制启动与关闭，可以设置 `manual: true`。

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

`Server.close()` 会等待：

- runtime adapter 完成关闭
- 所有通过 `waitUntil()` 注册的后台任务完成

同样也可以通过事件观察这些阶段：

```ts
server.addEventListener("serve", () => {
  console.log("listening");
});

server.addEventListener("close", () => {
  console.log("closed");
});
```

## API 概览

主入口导出：

- `Server`
- `ServerServeEvent`
- `ServerCloseEvent`
- `ServerErrorEvent`
- `serve`
- `createContextKey`
- `InvocationContext`
- `runMiddleware`
- `wrapFetch`

子路径导出：

- `servok/bun`
- `servok/cli`
- `servok/deno`
- `servok/log`
- `servok/node`
- `servok/static`
- `servok/stream`

## 开发

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```
