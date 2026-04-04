<script setup lang="ts">
const siteConfig = useAppConfig().site;
const { data: contributors } = await useAsyncData(() => useContributors());
</script>

<template>
  <UPageSection v-if="contributors?.length" id="contributors" title="Contributors">
    <div class="flex flex-wrap justify-center gap-2">
      <UTooltip v-for="c in contributors" :key="c.username" :text="c.name" :delay-duration="0">
        <a :href="c.profile" target="_blank" class="opacity-80 hover:opacity-100">
          <UAvatar :alt="c.name" :src="c.avatar" size="3xl" />
        </a>
      </UTooltip>
    </div>
    <div class="text-center">
      <UButton
        v-if="siteConfig.github"
        :to="`https://github.com/${siteConfig.github}`"
        target="_blank"
        color="neutral"
        icon="i-lucide-git-pull-request"
      >
        Contribute on GitHub
      </UButton>
    </div>
  </UPageSection>
</template>
