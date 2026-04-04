import type { ContentNavigationItem } from "@nuxt/content";

export function useSiteNav() {
  const navigation = inject<Ref<ContentNavigationItem[]>>("navigation");
  const route = useRoute();
  const isActive = (path: string) => route.path.startsWith(path);

  const links = computed(() => {
    return navigation.value.map((item) => {
      // Flaten single child
      if (item.children?.length === 1) {
        item = {
          ...item,
          ...item.children[0],
          children: undefined,
        };
      }

      // Check if group index is not exists and default to first child
      const originalPath = item.path;

      item.path = resolveItemPath(item);

      return {
        ...item,
        to: item.path,
        originalPath,
        hasIndex: item.path === originalPath,
        label: item.title || titleCase(originalPath),
        active: isActive(originalPath),
      };
    });
  });

  const activeSection = computed(() =>
    // links.value.find((l) => route.path.startsWith(l.originalPath)),
    resolveActiveSection(links.value, route.path),
  );
  const activeLinks = computed(() => (activeSection.value?.children || []).filter(Boolean));

  return reactive({
    links,
    activeSection,
    activeLinks,
  });
}

function resolveItemPath(item: ContentNavigationItem): string | undefined {
  // Check if group index is not exists and default to first child
  if (item.children?.length && !item.children.some((c) => c.path === item.path)) {
    return resolveItemPath(item.children[0]);
  }
  return item.path;
}

function resolveActiveSection(links: ContentNavigationItem[], path: string) {
  const active = links.find((l) => isPathPrefix(path, l.originalPath));
  if (active) {
    return active;
  }

  const parts = path.split("/").filter(Boolean);
  while (parts.length) {
    const part = "/" + parts[0];
    if (links.some((l) => l.originalPath.startsWith(part))) {
      break;
    }
    parts.shift();
  }

  while (parts.length) {
    const part = "/" + parts[parts.length - 1];
    if (links.some((l) => isPartial(l.originalPath, part))) {
      break;
    }
    parts.pop();
  }

  path = parts.join("/");
  if (!path) {
    return null;
  }
  path = "/" + path;

  return links.find((l) => isPartial(l.originalPath, path));
}

function isPartial(originalPath: string, path: string) {
  const start = originalPath.indexOf(path);
  if (start === -1) {
    return false;
  }
  const end = start + path.length;
  return (
    (start === 0 || originalPath[start - 1] === "/") &&
    (end === originalPath.length || originalPath[end] === "/")
  );
}

function isPathPrefix(path: string, prefix: string) {
  return path.startsWith(prefix) && (path.length === prefix.length || path[prefix.length] === "/");
}
