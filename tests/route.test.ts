import { describe, expect, it, vi } from "vitest";
import {
  unstable_convertRoutesToHandler,
  unstable_buildRouteTree,
  unstable_match,
} from "../src/core";

describe("unstable_buildRouteTree + unstable_match", () => {
  it("matches exact routes from a built tree", () => {
    const handler = vi.fn(async () => new Response("ok"));
    const tree = unstable_buildRouteTree({
      "/": vi.fn(async () => new Response("root")),
      "/users": handler,
      "/users/list": vi.fn(async () => new Response("list")),
    });

    expect(unstable_match(tree, "http://localhost/users").matched[0]?.handler).toBe(handler);
    expect(unstable_match(tree, "http://localhost/users/list").all[0]?.path).toBe("/users/list");
    expect(unstable_match(tree, "http://localhost/missing")).toEqual({ all: [], matched: [] });
  });

  it("orders candidates using Bun route precedence", () => {
    const exact = vi.fn(async () => new Response("exact"));
    const param = vi.fn(async () => new Response("param"));
    const wildcard = vi.fn(async () => new Response("wildcard"));
    const catchAll = vi.fn(async () => new Response("catch-all"));
    const tree = unstable_buildRouteTree({
      "/api/users/me": exact,
      "/api/users/:id": param,
      "/api/*": wildcard,
      "/*": catchAll,
    });

    const result = unstable_match(tree, new Request("http://localhost/api/users/me", { method: "GET" }));

    expect(result.all.map((candidate) => candidate.path)).toEqual([
      "/api/users/me",
      "/api/users/:id",
      "/api/*",
      "/*",
    ]);
    expect(result.matched.map((candidate) => candidate.handler)).toEqual([
      exact,
      param,
      wildcard,
      catchAll,
    ]);
    expect(result.all[1]?.params).toEqual({ id: "me" });
  });

  it("normalizes leading and trailing slashes", () => {
    const handler = vi.fn(async () => new Response("ok"));
    const tree = unstable_buildRouteTree({
      "/users": handler,
    });

    expect(unstable_match(tree, "users/").matched[0]?.handler).toBe(handler);
    expect(unstable_match(tree, "//users//").all[0]?.path).toBe("/users");
  });

  it("throws when normalized exact routes conflict", () => {
    expect(() =>
      unstable_buildRouteTree({
        "/users": vi.fn(async () => new Response("a")),
        "/users/": vi.fn(async () => new Response("b")),
      }),
    ).toThrow('Conflicting routes: "/users" and "/users/" both resolve to "/users".');
  });

  it("throws when parameter routes collapse to the same pattern", () => {
    expect(() =>
      unstable_buildRouteTree({
        "/users/:id": vi.fn(async () => new Response("a")),
        "/users/:name": vi.fn(async () => new Response("b")),
      }),
    ).toThrow('Conflicting routes: "/users/:id" and "/users/:name" both resolve to "/users/:".');
  });

  it("selects method-specific handlers and falls back from HEAD to GET", () => {
    const get = vi.fn(async () => new Response("get"));
    const post = vi.fn(async () => new Response("post"));
    const tree = unstable_buildRouteTree({
      "/users": {
        GET: get,
        POST: post,
      },
    });

    expect(unstable_match(tree, new Request("http://localhost/users", { method: "GET" })).matched[0]?.handler)
      .toBe(get);
    expect(
      unstable_match(tree, new Request("http://localhost/users", { method: "POST" })).matched[0]?.handler,
    ).toBe(post);
    expect(
      unstable_match(tree, new Request("http://localhost/users", { method: "HEAD" })).matched[0]?.handler,
    ).toBe(get);
    expect(unstable_match(tree, new Request("http://localhost/users", { method: "DELETE" }))).toEqual({
      all: [
        {
          path: "/users",
          route: { GET: get, POST: post },
          params: {},
        },
      ],
      matched: [],
    });
  });

  it("falls back to '*' when no explicit method handler matches", () => {
    const any = vi.fn(async () => new Response("any"));
    const get = vi.fn(async () => new Response("get"));
    const tree = unstable_buildRouteTree({
      "/users": {
        GET: get,
        "*": any,
      },
    });

    expect(
      unstable_match(tree, new Request("http://localhost/users", { method: "GET" })).matched[0]?.handler,
    ).toBe(get);
    expect(
      unstable_match(tree, new Request("http://localhost/users", { method: "DELETE" })).matched[0]?.handler,
    ).toBe(any);
    expect(
      unstable_match(tree, new Request("http://localhost/users", { method: "HEAD" })).matched[0]?.handler,
    ).toBe(get);
  });

  it("keeps path candidates when method filtering removes some matches", () => {
    const exact = vi.fn(async () => new Response("exact"));
    const paramPost = vi.fn(async () => new Response("param-post"));
    const wildcard = vi.fn(async () => new Response("wildcard"));
    const tree = unstable_buildRouteTree({
      "/api/users/me": exact,
      "/api/users/:id": { POST: paramPost },
      "/api/*": wildcard,
    });

    const result = unstable_match(tree, new Request("http://localhost/api/users/me", { method: "GET" }));

    expect(result.all.map((candidate) => candidate.path)).toEqual([
      "/api/users/me",
      "/api/users/:id",
      "/api/*",
    ]);
    expect(result.matched.map((candidate) => candidate.path)).toEqual([
      "/api/users/me",
      "/api/*",
    ]);
  });

  it("builds a server handler from routes", async () => {
    const handler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree({
        "/health": () => new Response("ok"),
      }),
    });

    const { InvocationContext } = await import("../src/core");
    const context = new InvocationContext({
      request: new Request("http://localhost/health"),
      capabilities: {} as any,
      params: {},
    });
    const response = await handler(context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("uses the fallback handler when no route matches", async () => {
    const fallback = vi.fn(async () => new Response("fallback", { status: 404 }));
    const handler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree({
        "/health": () => new Response("ok"),
      }),
      fallback,
    });

    const { InvocationContext } = await import("../src/core");
    const context = new InvocationContext({
      request: new Request("http://localhost/missing"),
      capabilities: {} as any,
      params: {},
    });
    const response = await handler(context);

    expect(fallback).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("fallback");
  });

  it("returns 405 with Allow when the path matches but the method does not", async () => {
    const handler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree({
        "/users": {
          GET: () => new Response("list"),
          POST: () => new Response("create"),
        },
      }),
    });

    const { InvocationContext } = await import("../src/core");
    const context = new InvocationContext({
      request: new Request("http://localhost/users", { method: "DELETE" }),
      capabilities: {} as any,
      params: {},
    });
    const response = await handler(context);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, POST, HEAD");
  });

  it("does not return 405 when '*' is present for the matched path", async () => {
    const handler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree({
        "/users": {
          GET: () => new Response("list"),
          "*": () => new Response("fallback"),
        },
      }),
    });

    const { InvocationContext } = await import("../src/core");
    const context = new InvocationContext({
      request: new Request("http://localhost/users", { method: "DELETE" }),
      capabilities: {} as any,
      params: {},
    });
    const response = await handler(context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fallback");
  });

  it("clears stale params when a context is rerouted through a fallback", async () => {
    const { InvocationContext } = await import("../src/core");
    const fallback = vi.fn(async (ctx: any) => new Response(JSON.stringify(ctx.params)));
    const reroutedHandler = unstable_convertRoutesToHandler({
      input: unstable_buildRouteTree({
        "/posts/:id": () => new Response("post"),
      }),
      fallback,
    });
    
    // Create context with a request that doesn't match any route
    const reroutedContext = new InvocationContext({
      request: new Request("http://localhost/other"),
      capabilities: {} as any,
      params: {},
    });
    const response = await reroutedHandler(reroutedContext);

    expect(fallback).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("{}");
  });
});
