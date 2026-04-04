import { createResolver } from "nuxt/kit";
import { defineNuxtConfig } from "nuxt/config";
import siteConfig from "./config.json";

const { resolve } = createResolver(import.meta.url);

// Flag enabled when developing docs theme
const isDev = !!process.env.NUXT_DOCS_DEV;

// SSR enabled only for production build to save life (at least until our stack will be a little bit lighter)
const isProd = process.env.NODE_ENV === "production";
const ssr = Boolean(isProd || process.env.NUXT_DOCS_SSR);

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '@nuxt/content',
  ],
  ssr,
  css: [resolve("./app/assets/main.css")],
  devtools: { enabled: isDev },
  compatibilityDate: '2026-04-03',
  // @ts-ignore
  site: siteConfig,
  app: {
    head: {
      htmlAttrs: {
        dir: "ltr",
      },
      templateParams: {
        separator: "·",
      },
    },
  },
  sourcemap: {
    server: isDev,
    client: isDev
  },
  content: {
    database: {
      type: "d1",
      bindingName: "sevo_docs_db"
    }
  }
})
