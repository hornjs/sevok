import { parseArgs as parseNodeArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fork } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  loadRuntimeAdapter,
  type Server,
  type ServerHandlerFunction,
  type ServerMiddleware,
  type RuntimeAdapter,
  type ServerOptions,
  type RoutingOptions,
} from "./core.ts";
import c from "./_color.ts";
import { pkgMeta } from "./_meta.ts";

export const defaultExts: string[] = [".mjs", ".js", ".mts", ".ts"];

export const defaultEntries: string[] = ["server", "server/index", "src/server", "server/server"];

/**
 * Configuration object exported from a server entry file.
 *
 * Combines routing configuration (`routes`, `fetch`, `middleware`, `error`) with
 * server options (`port`, `hostname`, `tls`, etc.) including runtime-specific
 * options (`bun`, `deno`, `node`).
 *
 * The CLI supports two export formats:
 * - Default export: `export default { fetch, routes, ... }`
 * - Named exports: `export const fetch = ...; export const routes = ...`
 */
export type UserServerEntry = ServerOptions & RoutingOptions

/**
 * Result of loading a server entry module.
 */
export type LoadedServerEntry = {
  /**
   * The web fetch handler extracted from the loaded module.
   *
   * This is resolved by `loadServerEntry()` from:
   * - `module.fetch`
   * - `module.default.fetch`
   * - or a default-exported function with fewer than two parameters
   */
  fetch?: ServerHandlerFunction;

  /**
   * The normalized loaded module.
   *
   * In practice this is usually the user entry object shape after
   * `loadServerEntry()` unwraps a plain object default export.
   *
   * This follows the `UserServerEntry` structure for value access,
   * though typed as `any` for flexibility.
   */
  module?: any;

  /**
   * The resolved `file://` URL of the loaded entry module.
   */
  url?: string;

  /**
   * Whether the specified entry file was not found.
   *
   * When `true`, no valid entry point could be located.
   */
  notFound?: boolean;

  /**
   * Runtime adapter selected for the current process.
   *
   * This value is resolved by `loadServerAdapter()` based on the active runtime
   * (Bun, Deno, or Node.js) together with any runtime-specific options exposed
   * from the user entry module.
   */
  adapter: RuntimeAdapter;
};

/**
 * Options for loading a server entry module.
 */
export type LoadOptions = {
  /**
   * Path or URL to the server entry file.
   *
   * If not provided, common entry points will be searched automatically.
   */
  entry?: string;

  /**
   * Base directory for resolving relative paths.
   *
   * @default "."
   */
  dir?: string;

  /**
   * Hook called after the module is loaded to allow for custom processing.
   *
   * You can return a modified version of the module if needed.
   */
  onLoad?: (module: unknown) => any;
};

/**
 * Resolve and import a user server entry module.
 *
 * The loader can work with an explicit `entry` path or fall back to a list of
 * conventional filenames such as `server.ts` and `src/server.ts`. After the
 * module is imported, plain object default exports are unwrapped, a fetch
 * handler is extracted, and a runtime adapter is selected for the current
 * process.
 */
export async function loadServerEntry(opts: LoadOptions): Promise<LoadedServerEntry> {
  // Guess entry if not provided
  let entry: string | undefined = opts.entry;
  if (entry) {
    entry = resolve(opts.dir || ".", entry);
    if (!existsSync(entry)) {
      return {
        notFound: true,
        adapter: await loadRuntimeAdapter(),
      };
    }
  } else {
    for (const defEntry of defaultEntries) {
      for (const defExt of defaultExts) {
        const entryPath = resolve(opts.dir || ".", `${defEntry}${defExt}`);
        if (existsSync(entryPath)) {
          entry = entryPath;
          break;
        }
      }
      if (entry) break;
    }
    if (!entry) {
      return {
        notFound: true,
        adapter: await loadRuntimeAdapter(),
      };
    }
  }

  // Convert to file:// URL for consistent imports
  const url = entry.startsWith("file://") ? entry : pathToFileURL(resolve(entry)).href;

  // Import the user file
  let mod: any;
  try {
    mod = await import(url);
    // Simplified export resolution:
    // 1. Default export object: export default { fetch: ... }                               │
    // 2. Named exports: export const fetch = ...
    if (
      mod?.default != null &&
      typeof mod.default === "object" &&
      !Array.isArray(mod.default)
    ) {
      mod = mod.default;
    }
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
      const message = String(error);
      if (/"\.(m|c)?ts"/g.test(message)) {
        throw new Error(
          `Make sure you're using Node.js v22.18+ or v24+ for TypeScript support (current version: ${process.versions.node})`,
          { cause: error },
        );
      } else if (/"\.(m|c)?tsx"/g.test(message)) {
        throw new Error(
          `You need a compatible loader for JSX support (Deno, Bun, or sevok --import jiti/register)`,
          { cause: error },
        );
      }
    }
    throw error;
  }

  mod = (await opts?.onLoad?.(mod)) || mod;

  return {
    module: mod,
    url,
    fetch: mod.fetch,
    adapter: await loadRuntimeAdapter(),
  };
}

/**
 * Command-line flags accepted by the `sevok` CLI.
 */
export type CLIOptions = {
  /** Show help message */
  help?: boolean;
  /** Show server and runtime versions */
  version?: boolean;
  /** Working directory for resolving entry file */
  dir?: string;
  /** Server entry file to use */
  entry?: string;
  /** Run in production mode (no watch, no debug) */
  prod?: boolean;
  /** Serve static files from the specified directory (default: "public") */
  static?: string;
  /** ES module to preload */
  import?: string;
  /** Host to bind to (default: all interfaces) */
  hostname?: string;
  /** (alias to hostname) */
  host?: string;
  /** Port to listen on (default: "3000") */
  port?: string;
  /** Enable TLS (HTTPS/HTTP2) */
  tls?: boolean;
  /** TLS certificate file */
  cert?: string;
  /** TLS private key file */
  key?: string;
};

/**
 * Programmatic options for invoking the CLI entrypoint.
 *
 * Extends parsed CLI flags with metadata and usage text used by wrappers like
 * the published bin entry.
 */
export type MainOptions = CLIOptions & {
  /**
   * Explicit argv payload for programmatic invocation.
   *
   * CLI entry files should pass `process.argv.slice(2)` here so `main()` can
   * stay independent from process globals.
   */
  args?: string[];
  /** Optional package metadata for `--version` and help output. */
  meta?: {
    name?: string;
    version?: string;
    description?: string;
  };
  /** Optional usage metadata shown in generated help text. */
  usage?: {
    command?: string;
    docs?: string;
    issues?: string;
  };
};

/**
 * Main CLI entrypoint.
 *
 * Handles top-level flags, resolves environment files, and decides whether the
 * current process should serve directly or fork a watched child process.
 */
export async function main(mainOpts: MainOptions) {
  const args = mainOpts.args ?? [];
  const cliOpts = parseArgs(args);

  // Handle version flag
  if (cliOpts.version) {
    process.stdout.write(versions(mainOpts).join("\n") + "\n");
    process.exit(0);
  }

  // Handle help flag
  if (cliOpts.help) {
    console.log(usage(mainOpts));
    process.exit(cliOpts.help ? 0 : 1);
  }

  // Running in a child process
  if (process.send) {
    return startServer(cliOpts);
  }

  // Log versions
  console.log(c.gray([...versions(mainOpts), cliOpts.prod ? "prod" : "dev"].join(" · ")));

  // Resolve .env files
  const envFiles = [
    ".env",
    ".env.local",
    cliOpts.prod ? ".env.production" : ".env.development",
  ].filter((f) => existsSync(f));
  if (envFiles.length > 0) {
    console.log(
      `${c.gray(`Loading environment variables from ${c.magenta(envFiles.join(", "))}`)}`,
    );
  }

  // In prod mode without --import, run directly in current process (no fork needed)
  if (cliOpts.prod && !cliOpts.import) {
    // Load env files manually since we're not forking with --env-file args
    for (const envFile of [...envFiles].reverse() /* overrides first */) {
      process.loadEnvFile?.(envFile);
    }
    await startServer(cliOpts);
    return;
  }

  const isBun = !!process.versions.bun;
  const isDeno = !!process.versions.deno;
  const isNode = !isBun && !isDeno;

  // Fork a child process with additional args
  const runtimeArgs: string[] = [];
  runtimeArgs.push(...envFiles.map((f) => `--env-file=${f}`));
  if (!cliOpts.prod) {
    runtimeArgs.push("--watch");
  }
  if (cliOpts.import && (isNode || isBun)) {
    runtimeArgs.push(`--import=${cliOpts.import}`);
  }

  await forkCLI(args, runtimeArgs);
}

/**
 * Parse command-line arguments for the `serve` command.
 */
function parseArgs(args: string[]): CLIOptions {
  const commonArgs = {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    dir: { type: "string" },
    entry: { type: "string" },
    host: { type: "string" },
    hostname: { type: "string" },
    tls: { type: "boolean" },
  } as const;

  // Serve mode
  const { values, positionals } = parseNodeArgs({
    args,
    allowPositionals: true,
    options: {
      ...commonArgs,
      url: { type: "string" },
      prod: { type: "boolean" },
      port: { type: "string", short: "p" },
      static: { type: "string", short: "s" },
      import: { type: "string" },
      cert: { type: "string" },
      key: { type: "string" },
    },
  });

  // Backward compatibility: allow entry or dir as positional argument
  const maybeEntryOrDir = positionals[0];
  if (maybeEntryOrDir) {
    if (values.entry || values.dir) {
      throw new Error(
        "Cannot specify entry or dir as positional argument when --entry or --dir is used!",
      );
    }
    const stat = statSync(maybeEntryOrDir);
    if (stat.isDirectory()) {
      values.dir = maybeEntryOrDir;
    } else {
      values.entry = maybeEntryOrDir;
    }
  }

  return values;
}

/**
 * Prepare process-level error handlers and start serving.
 */
async function startServer(cliOpts: CLIOptions) {
  setupProcessErrorHandlers();
  await cliServe(cliOpts);
}

/**
 * Spawn a child CLI process for watch mode or runtime-preload scenarios.
 *
 * The parent process supervises the child and forwards selected termination
 * paths so the child does not outlive the CLI session.
 */
async function forkCLI(args: string[], runtimeArgs: string[]) {
  const srvxBin = fileURLToPath(
    (globalThis as any).__SEVOK_BIN__ || new URL("../bin/sevok.mjs", import.meta.url),
  );
  const child = fork(srvxBin, [...args], {
    execArgv: [...process.execArgv, ...runtimeArgs].filter(Boolean),
  });
  child.on("error", (error) => {
    console.error("Error in child process:", error);
    process.exit(1);
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Child process exited with code ${code}`);
      process.exit(code);
    }
  });
  child.on("message", (msg) => {
    if (msg && (msg as { error?: string }).error === "no-entry") {
      console.error("\n" + c.red(NO_ENTRY_ERROR) + "\n");
      process.exit(3);
    }
  });

  // Ensure the child process is torn down when the supervising parent exits.
  let cleanupCalled = false;
  const cleanup = (signal: any, exitCode?: number) => {
    if (cleanupCalled) return;
    cleanupCalled = true;
    try {
      child.kill(signal || "SIGTERM");
    } catch (error) {
      console.error("Error killing child process:", error);
    }
    if (exitCode !== undefined) {
      process.exit(exitCode);
    }
  };
  process.on("exit", () => cleanup("SIGTERM"));
  process.on("SIGTERM", () => cleanup("SIGTERM", 143));
  if (args.includes("--watch")) {
    process.on("SIGINT" /* ctrl+c */, () => cleanup("SIGINT", 130));
  }
}

/**
 * Convert uncaught process-level failures into a clear non-zero exit.
 */
function setupProcessErrorHandlers() {
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    process.exit(1);
  });
}

/**
 * Build the version banner printed by the CLI.
 */
function versions(mainOpts: MainOptions): string[] {
  const versions: string[] = [];
  if (mainOpts.meta?.name) {
    versions.push(`${mainOpts.meta.name} ${mainOpts.meta.version || ""}`.trim());
  }
  versions.push(`${pkgMeta.name} ${pkgMeta.version}`);
  versions.push(runtime());
  return versions;
}

/**
 * Detect the current JavaScript runtime for display purposes.
 */
function runtime(): string {
  if (process.versions.bun) {
    return `bun ${process.versions.bun}`;
  } else if (process.versions.deno) {
    return `deno ${process.versions.deno}`;
  } else {
    return `node ${process.versions.node}`;
  }
}

/**
 * Render the CLI help output.
 */
export function usage(mainOpts: MainOptions): string {
  const name = mainOpts.meta?.name || pkgMeta.name.split("/").pop()!;
  const ver = mainOpts.meta?.version || pkgMeta.version;
  const desc = mainOpts.meta?.description || pkgMeta.description;
  const formatSection = (
    rows: { label: string; renderLabel: () => string; description: string }[],
  ): string => {
    const labelWidth = rows.reduce((width, row) => Math.max(width, row.label.length), 0);
    return rows
      .map(
        (row) =>
          `  ${row.renderLabel().padEnd(labelWidth + (row.renderLabel().length - row.label.length))}  ${row.description}`,
      )
      .join("\n");
  };

  const usageRows = [
    {
      label: `${name} <file>`,
      renderLabel: () => `${c.green(name)} ${c.yellow("<file>")}`,
      description: "Use a server entry file as a positional alias for --entry",
    },
    {
      label: `${name} <dir>`,
      renderLabel: () => `${c.green(name)} ${c.yellow("<dir>")}`,
      description: "Use a working directory as a positional alias for --dir",
    },
  ];

  const optionRows = [
    {
      label: "--entry <file>",
      renderLabel: () => `${c.green("--entry")} ${c.yellow("<file>")}`,
      description: "Server entry file to use",
    },
    {
      label: "--dir <dir>",
      renderLabel: () => `${c.green("--dir")} ${c.yellow("<dir>")}`,
      description: "Working directory for resolving entry file",
    },
    {
      label: "-h, --help",
      renderLabel: () => c.green("-h, --help"),
      description: "Show this help message",
    },
    {
      label: "-v, --version",
      renderLabel: () => c.green("-v, --version"),
      description: "Show server and runtime versions",
    },
    {
      label: "-p, --port <port>",
      renderLabel: () => `${c.green("-p, --port")} ${c.yellow("<port>")}`,
      description: `Port to listen on (default: ${c.yellow("3000")})`,
    },
    {
      label: "--host, --hostname <host>",
      renderLabel: () => `${c.green("--host, --hostname")} ${c.yellow("<host>")}`,
      description: "Host to bind to (default: all interfaces)",
    },
    {
      label: "-s, --static <dir>",
      renderLabel: () => `${c.green("-s, --static")} ${c.yellow("<dir>")}`,
      description: `Serve static files from the specified directory (default: ${c.yellow("public")})`,
    },
    {
      label: "--prod",
      renderLabel: () => c.green("--prod"),
      description: "Disable watch mode and use production env defaults",
    },
    {
      label: "--import <loader>",
      renderLabel: () => `${c.green("--import")} ${c.yellow("<loader>")}`,
      description: "ES module to preload (Node.js / Bun only)",
    },
    {
      label: "--tls",
      renderLabel: () => c.green("--tls"),
      description: "Enable TLS (HTTPS/HTTP2)",
    },
    {
      label: "--cert <file>",
      renderLabel: () => `${c.green("--cert")} ${c.yellow("<file>")}`,
      description: "TLS certificate file",
    },
    {
      label: "--key <file>",
      renderLabel: () => `${c.green("--key")} ${c.yellow("<file>")}`,
      description: "TLS private key file",
    },
  ];

  const environmentRows = [
    {
      label: "PORT",
      renderLabel: () => c.green("PORT"),
      description: "Override port",
    },
    {
      label: "HOST",
      renderLabel: () => c.green("HOST"),
      description: "Override host",
    },
    {
      label: "NODE_ENV",
      renderLabel: () => c.green("NODE_ENV"),
      description: `Defaults to ${c.yellow("development")} or ${c.yellow("production")} based on --prod.`,
    },
  ];

  return `
${c.cyan(name)}${c.gray(`${ver ? ` ${ver}` : ""} ${desc ? `- ${desc}` : ""}`)}

${c.bold("USAGE")}

${formatSection(usageRows)}

${c.bold("OPTIONS")}

${formatSection(optionRows)}

${c.bold("ENVIRONMENT")}

${formatSection(environmentRows)}

${mainOpts.usage?.docs ? `➤ ${c.url("Documentation", mainOpts.usage.docs)}` : ""}
${mainOpts.usage?.issues ? `➤ ${c.url("Report issues", mainOpts.usage.issues)}` : ""}
`.trim();
}

export const NO_ENTRY_ERROR = "No server entry or public directory found";

/**
 * Resolve the user entry module, attach default middleware, and start the
 * runtime adapter-backed server instance.
 */
export async function cliServe(cliOpts: CLIOptions): Promise<void> {
  try {
    // Set default NODE_ENV
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = cliOpts.prod ? "production" : "development";
    }

    let server: Server | undefined;

    // Load server entry file and create a new server instance
    const loaded = await loadServerEntry({
      entry: cliOpts.entry,
      dir: cliOpts.dir,
    });

    const { serve } = await import("./core.ts");
    const { serveStatic } = await import("sevok/static");
    const { log } = await import("sevok/log");

    // Resolve static assets relative to the entry file when possible so
    // colocated apps can rely on a nearby `public/` directory by default.
    const staticDir = resolve(
      cliOpts.dir || (loaded.url ? dirname(fileURLToPath(loaded.url)) : "."),
      cliOpts.static || "public",
    );
    const staticExplicitlySet = !!cliOpts.static;
    const staticExists = existsSync(staticDir);
    if (staticExplicitlySet && !staticExists) {
      console.warn(c.yellow(`Warning: Static directory not found: ${staticDir}`));
    }
    cliOpts.static = staticExists ? staticDir : "";

    if (loaded.notFound && !cliOpts.static) {
      process.send?.({ error: "no-entry" });
      throw new Error(NO_ENTRY_ERROR, { cause: cliOpts });
    }

    const serverInit = {
      ...loaded.module?.default,
      default: undefined,
      ...loaded.module,
    } as Partial<UserServerEntry>;

    printInfo(cliOpts, loaded);
    server = serve({
      ...serverInit,
      gracefulShutdown: !!cliOpts.prod,
      port: cliOpts.port ?? serverInit.port,
      hostname: cliOpts.hostname ?? cliOpts.host ?? serverInit.hostname,
      tls: cliOpts.tls ? { cert: cliOpts.cert, key: cliOpts.key } : undefined,
      error: (error: unknown) => {
        console.error(error);
        return renderError(cliOpts, error);
      },
      fetch:
        loaded.fetch ||
        (() => renderError(
          cliOpts,
          loaded.notFound ? "Server Entry Not Found" : "No Fetch Handler Exported",
          501,
        )),
      middleware: [
        log(),
        cliOpts.static ? serveStatic({ dir: cliOpts.static }) : undefined,
        ...(serverInit.middleware || []),
      ].filter(Boolean) as ServerMiddleware[],
      adapter: loaded.adapter,
    });
    await server?.ready();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

/**
 * Render an HTML error page for CLI-served requests.
 *
 * Production mode returns a minimal message while development mode includes the
 * full error details for debugging.
 */
function renderError(
  cliOpts: CLIOptions,
  error: unknown,
  status = 500,
  title = "Server Error",
): Response {
  let html = `<!DOCTYPE html><html><head><title>${title}</title></head><body>`;
  if (cliOpts.prod) {
    html += `<h1>${title}</h1><p>Something went wrong while processing your request.</p>`;
  } else {
    html += /* html */ `
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f8f9fa; color: #333; }
      h1 { color: #dc3545; }
      pre { background: #fff; padding: 10px; border-radius: 5px; overflow: auto; }
      code { font-family: monospace; }
      #error { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; }
    </style>
    <div id="error"><h1>${title}</h1><pre>${error instanceof Error ? error.stack || error.message : String(error)}</pre></div>
    `;
  }

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Print resolved entry and static directory information before the server
 * starts listening.
 */
function printInfo(cliOpts: CLIOptions, loaded: Awaited<ReturnType<typeof loadServerEntry>>) {
  let entryInfo: string;
  if (loaded.notFound) {
    entryInfo = c.gray(`(create ${c.bold(`server.ts`)})`);
  } else {
    entryInfo = loaded.fetch
      ? c.cyan("./" + relative(".", fileURLToPath(loaded.url!)))
      : c.red(`No fetch handler exported from ${loaded.url}`);
  }
  console.log(c.gray(`${c.bold(c.gray("◆"))} Server handler: ${entryInfo}`));
  let staticInfo: string;
  if (cliOpts.static) {
    const relPath = relative(".", cliOpts.static);
    staticInfo = c.cyan(relPath ? "./" + relPath + "/" : "./");
  } else {
    staticInfo = c.gray(`(create ${c.bold("public/")} dir)`);
  }
  console.log(c.gray(`${c.bold(c.gray("◇"))} Static files:   ${staticInfo}`));
  console.log("");
}
