// Example deployment — a CLIENT-ONLY overlay module (features 057/072, D-103).
//
// It exists only for the `example` deployment and is discovered without editing
// the shared core registry (FR-004). It declares its own admin permission so it
// integrates with the permission catalogue and passes the per-deployment
// permission-inventory check (FR-009), and its own activation control so an
// operator can switch it off like any other module (Principle XVII).

import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

export const EXAMPLE_OVERLAY_SETTING_CODES = {
  ACTIVATION: 'example_overlay.activation',
} as const;

/**
 * The activation control is an ordinary Setting the module owns, exactly as a
 * core module's is. An overlay module is not a second kind of module: the two
 * presence axes apply to it unchanged, and "off" means its routes answer 503,
 * its permission leaves the grantable set and its interceptor stops running —
 * none of which the pre-D-103 `plugin.ts` path could express, because it
 * registered a bare `app.get` that composition pushed unwrapped.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'example_overlay',
  groups: [{ code: 'example_overlay', name: 'Example Overlay' }],
  settings: [
    {
      code: EXAMPLE_OVERLAY_SETTING_CODES.ACTIVATION,
      name: 'Example overlay enabled',
      description:
        'Switches this deployment-specific module on or off as a whole: its admin route, its permission and its response interceptor. Nothing is dropped — switching it back on restores everything exactly as it was.',
      groupCode: 'example_overlay',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'example_overlay',
  name: 'Example Overlay',
  description: 'Reference client-only overlay module for the example deployment.',
  version: '1.0.0',
  // `backend.ts` resolves `requireAdmin`, which `auth` owns. An overlay module
  // declares a cross-module edge exactly as a core module does — that is what
  // makes it real to the lifecycle and to an operator switching `auth` off, and
  // `check:port-dependencies` fails the build without it.
  dependencies: ['auth'],
  activation: { settingCode: EXAMPLE_OVERLAY_SETTING_CODES.ACTIVATION, default: true },
  settings,
  permissions: [
    {
      code: 'example_overlay:manage',
      module: 'example_overlay',
      label: 'Manage the example overlay module',
    },
  ],
});
