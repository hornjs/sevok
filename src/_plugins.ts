import type { ServerPlugin } from "./core.ts";
import c from "./_color.ts";

/**
 * Wrap the request pipeline with the user-provided error handler.
 *
 * The plugin inserts a middleware at the front of the stack so both thrown
 * exceptions and rejected downstream promises are normalized through
 * `server.options.error`.
 */
export const errorPlugin: ServerPlugin = (server) => {
  const errorHandler = server.options.error;
  if (!errorHandler) return;
  server.options.middleware.unshift((ctx, next) => {
    try {
      const res = next(ctx);
      return res instanceof Promise ? res.catch((error) => errorHandler(error)) : res;
    } catch (error) {
      return errorHandler(error);
    }
  });
};

/**
 * Register process signal handlers that close the server gracefully.
 *
 * The first `SIGINT` / `SIGTERM` starts a graceful shutdown countdown. A second
 * `SIGINT` forces active connections to close immediately.
 */
export const gracefulShutdownPlugin: ServerPlugin = (server) => {
  const config = server.options?.gracefulShutdown;
  if (
    !globalThis.process?.on ||
    config === false ||
    (config === undefined && (process.env.CI || process.env.TEST))
  ) {
    return;
  }
  const gracefulTimeout =
    config === true || !config?.gracefulTimeout
      ? Number.parseInt(process.env.SERVER_SHUTDOWN_TIMEOUT || "") || 5
      : config.gracefulTimeout;

  let isClosing = false;
  let isClosed = false;

  // Silence shutdown progress when the server itself is configured as silent.
  const write = server.options.silent ? () => {} : process.stderr.write.bind(process.stderr);

  /**
   * Forcefully close active connections once graceful shutdown times out or the
   * user presses Ctrl+C again.
   */
  const forceClose = async () => {
    if (isClosed) return;
    write(c.red("\x1b[2K\rForcibly closing connections...\n"));
    isClosed = true;
    await server.close(true);
  };

  /**
   * Attempt to close the server cleanly while printing countdown updates.
   */
  const shutdown = async () => {
    if (isClosing || isClosed) {
      return;
    }

    // Force close with second Ctrl+C
    // CLIs might trigger multiple SIGINTs, so we delay the listener registration
    setTimeout(() => {
      globalThis.process.once("SIGINT", forceClose);
    }, 100);

    isClosing = true;
    const closePromise = server.close();

    // Countdown with updates each second
    for (let remaining = gracefulTimeout; remaining > 0; remaining--) {
      write(
        c.gray(
          `\rStopping server gracefully (${remaining}s)... Press ${c.bold("Ctrl+C")} again to force close.`,
        ),
      );
      const closed = await Promise.race([
        closePromise.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), 1000)),
      ]);
      if (closed) {
        write("\x1b[2K\r" + c.green("Server closed successfully.\n"));
        isClosed = true;
        return;
      }
    }

    // Graceful period expired: force close
    write("\x1b[2K\rGraceful shutdown timed out.\n");
    await forceClose();
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    globalThis.process.on(sig, shutdown);
  }
};
