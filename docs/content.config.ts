import { createResolver } from "nuxt/kit";
import { defineContentConfig, defineCollection } from '@nuxt/content'

const { resolve } = createResolver(import.meta.url);

export default defineContentConfig({
  collections: {
    content: defineCollection({
      type: 'page',
      source: {
        cwd: resolve("./content"),
        include: "**/*.{md,yml}",
        exclude: ["**/.**/**", "**/node_modules/**", "**/dist/**", "**/.docs/**"],
      },
    }),
  },
})
