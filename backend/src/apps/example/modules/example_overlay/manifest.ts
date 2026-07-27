// Example deployment — a CLIENT-ONLY overlay module (feature 057).
//
// It exists only for the `example` deployment and is discovered without editing
// the shared core registry (FR-004). It declares its own admin permission so it
// integrates with the permission catalogue and passes the per-deployment
// permission-inventory check (FR-009).

import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'example_overlay',
  name: 'Example Overlay',
  description: 'Reference client-only overlay module for the example deployment.',
  version: '1.0.0',
  dependencies: [],
  permissions: [
    {
      code: 'example_overlay:manage',
      module: 'example_overlay',
      label: 'Manage the example overlay module',
    },
  ],
});
