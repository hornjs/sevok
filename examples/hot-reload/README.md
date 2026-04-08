# Hot Reload Example

This example demonstrates how to use `Server.updateRouting()` to hot-reload routes without restarting the server.

## Usage

```bash
# Start the server
node --experimental-strip-types server.ts

# In another terminal, make changes to routes.ts
# The server will automatically reload the routes
```

## How it works

1. The server watches `routes.ts` for file changes
2. When a change is detected, it dynamically imports the new routes
3. `server.updateRouting()` replaces the request handler with the new routes
4. The server continues handling requests without downtime

## Try it

1. Start the server
2. Visit http://localhost:3000/
3. Edit `routes.ts` and add a new route:
   ```ts
   "/hello": () => new Response("Hello from hot reload!"),
   ```
4. Save the file
5. Visit http://localhost:3000/hello - the new route works immediately!

## Notes

- This example uses Node.js `fs.watch()` for simplicity
- In production, consider using a more robust file watcher like `chokidar`
- Route reloading uses a cache-busting ESM import query
- For Bun/Deno, adjust the dynamic import strategy accordingly
