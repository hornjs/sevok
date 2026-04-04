<script setup lang="ts">
const appConfig = useAppConfig();
</script>

<template>
  <USeparator class="-mb-2.5">
    <img :src="appConfig.site.logo" :alt="`${appConfig.site.name} logo`" class="w-10 h-10" />
  </USeparator>
  <UFooter>
    <template #left>
      <AppFooterNotes />
    </template>

    <template #right>
      <SocialButtons />
    </template>
  </UFooter>
</template>
