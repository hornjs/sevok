import { defineNuxtModule } from "nuxt/kit";
import type { SiteConfig } from "../config";

export default defineNuxtModule({
  setup(_, nuxt) {
    if (nuxt.options._prepare) {
      return;
    }

    const siteConfig = (nuxt.options as any).site as SiteConfig;

    const uiConfig = {
      primary: siteConfig.themeColor || "amber",
      gray: "neutral",
    };

    // if (siteConfig.themeColor) {
    //   const { getColors } = await import('theme-colors')
    //   const colors = getColors(siteConfig.themeColor)
    //   // UI
    //   // uiConfig.primary = colors['500']
    //
    //   // Tailwind
    //   nuxt.options.tailwindcss ||= {} as any
    //   nuxt.options.tailwindcss.config ||= {}
    //   nuxt.options.tailwindcss.config.theme ||= {}
    //   nuxt.options.tailwindcss.config.theme.extend ||= {}
    //   nuxt.options.tailwindcss.config.theme.extend.colors = {
    //     ...colors,
    //     ...nuxt.options.tailwindcss.config.theme.extend.colors,
    //   }
    // }

    nuxt.hook("ready", () => {
      nuxt.options.appConfig.ui = {
        ...nuxt.options.appConfig.ui,
        ...uiConfig,
      };
    });
  },
});
