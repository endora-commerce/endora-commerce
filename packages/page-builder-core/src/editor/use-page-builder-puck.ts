import { createUsePuck, type Config, type PuckApi } from '@puckeditor/core';

/** Typed Puck store selector — use instead of `usePuck(fn)` (selector is ignored on that API). */
export const usePageBuilderPuck: <T = PuckApi<Config>>(selector: (state: PuckApi<Config>) => T) => T =
  createUsePuck<Config>();
