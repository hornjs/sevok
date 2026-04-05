import c from "./_color.ts";
import type { ServerMiddleware } from "./core.ts";

/**
 * Logging middleware options.
 *
 * Reserved for future customization of log format and destination.
 *
 * @example
 * ```ts
 * declare module "servok/log" {
 *   interface LogOptions {
 *     requestId?: boolean;
 *   }
 * }
 * ```
 */
export interface LogOptions {}

const statusColors = {
  1: c.blue,
  2: c.green,
  3: c.yellow,
} as const;

/**
 * Create a request logger middleware.
 *
 * Each completed request prints timestamp, method, url, status code, and total
 * response time using simple terminal colors.
 */
export const log = (_options: LogOptions = {}): ServerMiddleware => {
  return async (ctx, next) => {
    const start = performance.now();
    const req = ctx.request;
    const res = await next(ctx);
    const duration = performance.now() - start;
    const statusColor = statusColors[Math.floor(res.status / 100) as unknown as keyof typeof statusColors] || c.red;
    console.log(`${c.gray(`[${new Date().toLocaleTimeString()}]`)} ${c.bold(req.method)} ${c.blue(req.url)} [${statusColor(res.status + "")}] ${c.gray(`(${duration.toFixed(2)}ms)`)}`);
    return res;
  };
};
