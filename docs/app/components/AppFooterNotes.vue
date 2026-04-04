<script lang="ts" setup>
const appConfig = useAppConfig();
</script>

<template>
  <p class="text-sm text-muted">
    <span class="text-default font-medium">
      <NuxtLink
        class="text-highlighted hover:text-primary"
        :to="`https://github.com/${appConfig.site.github}`"
        target="_blank"
        >{{ appConfig.site.name }}
      </NuxtLink>
    </span>
    &nbsp;<span class="text-muted">{{ appConfig.site.shortDescription.replace(/\.$/, "") }}</span
    >.
  </p>
</template>
