import { Server } from "https://esm.sh/sevok";
import { StreamRuntimeAdapter } from "https://esm.sh/sevok/stream?external=sevok";

const pendingEntries = [];
let resolveNextEntry;

function enqueue(entry) {
  if (typeof resolveNextEntry === "function") {
    const resolve = resolveNextEntry;
    resolveNextEntry = undefined;
    resolve(entry);
    return;
  }

  pendingEntries.push(entry);
}

async function* stream() {
  while (true) {
    if (pendingEntries.length > 0) {
      yield pendingEntries.shift();
      continue;
    }

    yield await new Promise((resolve) => {
      resolveNextEntry = resolve;
    });
  }
}

new Server({
  adapter: new StreamRuntimeAdapter({
    stream: stream(),
    url: self.location.href,
  }),
  routes: {
    "/hello": () =>
      new Response("<h1>Hello from Sevok Service Worker</h1>", {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
        },
      }),
    "/*": (request) => fetch(request),
  },
});

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  enqueue({
    request: event.request,
    completeWith(promise) {
      event.respondWith(promise);
    },
    waitUntil(promise) {
      if (promise) {
        event.waitUntil(promise);
      }
    },
  });
});
