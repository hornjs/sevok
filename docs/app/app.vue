<script setup lang="ts">
import type { BannerProps } from "@nuxt/ui";

const appConfig = useAppConfig();

const { data: navigation } = await useAsyncData("navigation", () =>
  queryCollectionNavigation("content"),
);
const { data: files } = useLazyAsyncData("search", () => queryCollectionSearchSections("content"), {
  server: false,
});

const browserTabIcon = appConfig.site?.logo || undefined;

useHead({
  htmlAttrs: {
    lang: appConfig.site.lang || "en",
  },
  link: [
    {
      rel: "icon",
      href: browserTabIcon,
    },
  ],
});

const route = useRoute();

onMounted(() => {
  watch(
    route,
    () => {
      const hash = window.location.hash;
      if (hash) {
        let attempts = 0;
        const interval = setInterval(() => {
          document.querySelector(hash)?.scrollIntoView();
          if (attempts++ > 5) {
            clearInterval(interval);
          }
        }, 100);
      }
    },
    { immediate: true },
  );
});

provide("navigation", navigation);
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <UBanner v-if="appConfig.site.banner?.title" v-bind="appConfig.site.banner as BannerProps" />
    <AppHeader />
    <UMain>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </UMain>
    <AppFooter />
    <ClientOnly>
      <LazyUContentSearch
        :files="files"
        :navigation="navigation"
        shortcut="meta_k"
      />
    </ClientOnly>
  </UApp>
</template>
