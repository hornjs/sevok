import type {
  ServerHandler,
  ServerMethodHandlers,
  ServerWildcardMethod,
} from "sevok";

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type WildcardMethodIsStar = Assert<IsEqual<ServerWildcardMethod, "*">>;

declare const handler: ServerHandler;

const handlers: ServerMethodHandlers = {
  GET: handler,
  "*": handler,
};

type SupportsWildcardHandler = Assert<IsEqual<typeof handlers["*"], ServerHandler | undefined>>;

export type {
  SupportsWildcardHandler,
  WildcardMethodIsStar,
};
