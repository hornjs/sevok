import type { BannerProps } from "@nuxt/ui";

export interface SiteConfig {
  dir?: string;
  name?: string;
  description?: string;
  shortDescription?: string;
  url?: string;
  logo?: string;
  lang?: string;
  github?: string;
  socials?: Record<string, string>;
  llms?: {
    full?: {
      title?: string;
      description?: string;
    };
  };
  branch?: string;
  banner?: BannerProps;
  versions?: { label: string; to: string; active?: boolean }[];
  themeColor?: string;
  redirects?: Record<string, string>;
  automd?: unknown;
  buildCache?: boolean;
  sponsors?: { api: string };
  landing: {
    title?: string;
    description?: string;
    _heroMdTitle?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    heroDescription?: string;
    heroLinks?: Record<
      string,
      string | { label?: string; icon?: string; to?: string; size?: string; order?: number }
    >;
    heroCode: {
      content: string;
      title: string;
      lang: string;
      contentHighlighted?: string;
    };
    featuresTitle?: string;
    featuresLayout?: "default" | "hero";
    features: { title: string; description?: string; icon?: string }[];
    contributors?: boolean;
  };
}

const siteConfig: SiteConfig = {
  name: "Sevok",
  shortDescription: "Composable Server Primitives Across Runtimes",
  description: "Web-standard server primitives with context-based handlers, middleware, and runtime adapters for Bun, Deno, Node.js, and stream-based hosts.",
  github: "hornjs/sevok",
  logo: "/icon.svg",
  url: inferSiteURL(),
  socials: {},
  banner: {},
  versions: [],
  lang: "en",
  landing: {
    contributors: true,
    heroLinks: {
      primary: {
        icon: "i-heroicons-book-open",
        to: "/guide",
      },
      playOnline: {
        label: "Play Online",
        icon: "i-heroicons-play",
        to: "https://stackblitz.com/fork/github/hornjs/sevok/tree/main/examples/stackblitz?startScript=dev&title=Sevok%20StackBlitz%20Example",
      }
    },
    heroCode: {
      lang: "ts",
      title: "server.ts",
      content: `
export default {
  routes: {
    "/users/:id": (ctx) => {
      return Response.json({ userId: ctx.params.id });
    },
  },
  fetch() {
    return Response.json({ hello: "world!" });
  },
};

/*
Node.js: $ npx sevok
         $ pnpx sevok
         $ yarn dlx sevok
Deno:    $ deno run -A npm:sevok
Bun:     $ bunx --bun sevok
CLI:     $ sevok
*/`.trim()
    },
    features: [
      {
        title: "Runtime Adapters",
        description: "Use dedicated adapters for [Node.js](/guide/node), [Bun](/guide/bun), [Deno](/guide/deno), and stream-based hosts.",
        icon: "akar-icons:node-fill",
      },
      {
        title: "Web Standards",
        description: "Build around standard [Request](https://developer.mozilla.org/docs/Web/API/Request) and [Response](https://developer.mozilla.org/docs/Web/API/Response) primitives.",
        icon: "arcticons:emoji-web",
      },
      {
        title: "Development Experience",
        description: "Built-in CLI with watch mode, request logging, error handling, static file serving, and graceful shutdown support.",
        icon: "hugeicons:happy",
      }
    ]
  }
}

export const generateConfig = async () => {
  // Convert markdown to HTML for landing items
  const md4w = await import("md4w");
  await md4w.init();
  for (const item of siteConfig.landing.features) {
    if (item.description) {
      item.description = md4w.mdToHtml(item.description);
    }
  }

  // Normalize and format hero code
  const shiki = await import("shiki");
  siteConfig.landing.heroCode.contentHighlighted = (
    await shiki.codeToHtml(siteConfig.landing.heroCode.content, {
      lang: siteConfig.landing.heroCode.lang || "sh",
      defaultColor: "dark",
      themes: {
        default: "github-dark",
        dark: "github-dark",
        light: "github-light",
      },
    })
  )
    .replace(/background-color:#[0-9a-fA-F]{6};/g, "")
    .replaceAll(`<span class="line"></span>`, "");

  (await import("node:fs")).writeFileSync("./config.json", JSON.stringify(siteConfig, null, 2))
}

function inferSiteURL() {
  return (
    process.env.NUXT_PUBLIC_SITE_URL ||
    (process.env.NEXT_PUBLIC_VERCEL_URL && `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`) || // Vercel
    process.env.URL || // Netlify
    process.env.CI_PAGES_URL || // Gitlab Pages
    process.env.CF_PAGES_URL // Cloudflare Pages
  );
}
