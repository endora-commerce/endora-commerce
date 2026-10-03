/**
 * The backend layer — this module's whole composition is one contribution: its
 * e-mail renderers, pushed into the registry `email` owns.
 */
import type { EmailBlockRendererRegistryPort } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';

import { emailBlocks } from '../email/index.js';

/** This module persists nothing. */
export const entities = [] as const;

export function registerModule(ctx: ModuleContext): void {
  // From a boot hook, unprobed: the registry is ungated and decides presence
  // itself, per render, on the contributor recorded here — so switching this
  // module off, or back on, needs no restart and no re-registration.
  ctx.onBoot(() => {
    lazyPort<EmailBlockRendererRegistryPort>(ctx, 'emailBlockRendererRegistry').register(
      'acceptance_blocks',
      emailBlocks,
    );
  });
}
