<script setup lang="ts">
const siteNav = useSiteNav();
</script>

<template>
  <UContainer>
    <UPage :ui="{ left: 'lg:col-span-2 pr-2 border-r border-default' }">
      <template #left>
        <UPageAside>
          <UPageAnchors :links="siteNav.links.filter((l) => l.title !== 'Blog')" />
          <USeparator v-if="siteNav.activeLinks?.length" type="dashed" class="py-6" />
          <UContentNavigation :navigation="siteNav.activeLinks" :collapsible="false" />
        </UPageAside>
      </template>
      <slot />
    </UPage>
  </UContainer>
</template>
