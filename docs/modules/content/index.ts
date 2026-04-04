import { defineNuxtModule } from "nuxt/kit";
import type { SiteConfig } from "../../config";
import { setupContentHooks } from "./hooks";

export default defineNuxtModule({
  async setup(_, nuxt) {
    if (nuxt.options._prepare) {
      return;
    }

    const siteConfig = (nuxt.options as any).site as SiteConfig;

    await setupContentHooks(nuxt, siteConfig);

    if ((siteConfig as SiteConfig).landing === false) {
      nuxt.hooks.hook("pages:extend", (pages) => {
        const index = pages.findIndex((page) => page.path === "/");
        if (index !== -1) {
          pages.splice(index, 1);
        }
      });
    }

    // @ts-ignore
    globalThis.__sitedocs__ = { siteConfig };
  },
});
