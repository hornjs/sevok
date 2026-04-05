import type { ServerMiddlewareName } from "sevok";

declare module "sevok" {
  interface ServerMiddlewareNameMap {
    auth: true;
    cache: true;
  }
}

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type ExtractedAuthName = Extract<ServerMiddlewareName, "auth">;
type ExtractedCacheName = Extract<ServerMiddlewareName, "cache">;

export type SupportsAugmentedAuthName = Assert<IsEqual<ExtractedAuthName, "auth">>;
export type SupportsAugmentedCacheName = Assert<IsEqual<ExtractedCacheName, "cache">>;
