import { Server } from "sevo";
import { StreamRuntimeAdapter } from "sevo/stream";

type ExampleFetchEvent = {
  request: Request;
  completeWith(promise: Promise<Response>): void;
  waitUntil(promise: Promise<unknown> | PromiseLike<unknown>): void;
};

function createEvent(url: string): ExampleFetchEvent {
  return {
    request: new Request(url),
    completeWith(promise) {
      void promise.then(async (response) => {
        console.log(response.status, await response.text());
      });
    },
    waitUntil(promise) {
      void promise;
    },
  };
}

async function* stream(): AsyncIterableIterator<ExampleFetchEvent> {
  yield createEvent("http://localhost/stream");
}

const server = new Server({
  adapter: new StreamRuntimeAdapter({
    stream: stream(),
    url: "/worker",
  }),
  manual: true,
  middleware: [
    async (ctx, next) => {
      const headers = new Headers(ctx.request.headers);
      headers.set("x-example", "stream");
      // Create a new request with modified headers
      const newRequest = new Request(ctx.request, { headers });
      // Create a child context with the new request
      return next(ctx.with({ request: newRequest }));
    },
  ],
  fetch: async (ctx) => {
    return Response.json({
      runtime: "stream",
      pathname: new URL(ctx.request.url).pathname,
      header: ctx.request.headers.get("x-example"),
    });
  },
});

await server.serve();

// Give the async iterator a tick to dispatch the event before shutting down.
await new Promise((resolve) => setTimeout(resolve, 0));
await server.close();
