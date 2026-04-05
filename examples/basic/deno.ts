import { Server, createContextKey } from "servok";
import { serveStatic } from "servok/static";
import { DenoRuntimeAdapter } from "servok/deno";

const requestIdKey = createContextKey<string>("unknown");

const server = new Server({
  adapter: new DenoRuntimeAdapter(),
  hostname: "127.0.0.1",
  port: 3000,
  middleware: [
    async (ctx, next) => {
      ctx.set(requestIdKey, crypto.randomUUID());
      return next(ctx);
    },
    serveStatic({ dir: "./public" }),
  ],
  fetch: async (ctx) => {
    const url = new URL(ctx.request.url);
    return Response.json({
      runtime: "deno",
      pathname: url.pathname,
      requestId: ctx.get(requestIdKey),
    });
  },
});

await server.ready();
