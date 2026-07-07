import { createUsePuck } from '@measured/puck';

/** Typed Puck store selector — use instead of `usePuck(fn)` (selector is ignored on that API). */
export const usePageBuilderPuck = createUsePuck();
