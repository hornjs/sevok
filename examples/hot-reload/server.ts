import { Server } from "sevok";
import { watch } from "node:fs";
import { resolve } from "node:path";

// Create server with initial routes
const server = new Server({
  routes: {
    "/": () => new Response("Hello, World!"),
    "/api/users": () => Response.json({ users: ["Alice", "Bob"] }),
    "/*": () => new Response("Not Found", { status: 404 }),
  },
  middleware: [
    async (ctx, next) => {
      console.log(`${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
      return next(ctx);
    },
  ],
});

// Listen for update events
server.addEventListener("update", (event) => {
  console.log(`Server routing updated: ${event.reason}`);
});

await server.ready();
console.log(`Server running at ${server.url}`);

// Watch for file changes and hot-reload routes
const routesFile = resolve("./routes.ts");
console.log(`Watching ${routesFile} for changes...`);

watch(routesFile, async (eventType) => {
  if (eventType === "change") {
    console.log("Routes file changed, reloading...");

    try {
      // Clear module cache (Node.js specific)
      delete require.cache[require.resolve("./routes.ts")];

      // Dynamically import new routes
      const { routes } = await import(`./routes.ts?t=${Date.now()}`);

      // Update server routing
      await server.updateRouting({
        routes,
        middleware: [
          async (ctx, next) => {
            console.log(`${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
            return next(ctx);
          },
        ],
      });

      console.log("Routes reloaded successfully!");
    } catch (error) {
      console.error("Failed to reload routes:", error);
    }
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await server.close();
  process.exit(0);
});
