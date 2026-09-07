/// <reference types="vite/client" />

/**
 * The `VITE_*` names this package reads by **dot** access, declared where they
 * are read.
 *
 * `import.meta.env.VITE_API_BASE_URL` is kept verbatim in the one file that
 * reads it, because Vite replaces that exact expression at the consumer's build
 * time and a cast or an indirection is a chance for the replacement to stop
 * happening in a way no type-check can see (the kit's own tsconfig records the
 * same reasoning). `VITE_BUILD_ID` is read by index access, which `vite/client`'s
 * own index signature already answers, so it is not declared here.
 *
 * This declaration is scoped to this package's program. The admin application
 * carries its own, so the two never collide, and neither reaches a consumer:
 * `tsc` emits no declaration for a `.d.ts` input, so nothing in `dist` names
 * `ImportMetaEnv`.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
