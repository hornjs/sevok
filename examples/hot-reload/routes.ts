import type { ServerRoutes } from "sevok";

export const routes: ServerRoutes = {
  "/": () => new Response("Hello, World!"),
  "/api/users": () => Response.json({ users: ["Alice", "Bob"] }),
  "/api/posts": () => Response.json({ posts: ["Post 1", "Post 2"] }),
  "/*": () => new Response("Not Found", { status: 404 }),
};
