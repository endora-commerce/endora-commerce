// The `acceptance` deployment — the overlay module the package-schema
// acceptance criterion composes (feature 080, T053(c)).
//
// It exists for one assertion, A10: a per-deployment overlay decorates a
// container registration owned by an **installed package**, not by a module this
// repository ships. That question could not be asked anywhere else — it needs a
// package that has been packed, installed outside the working tree and composed,
// which is precisely what `backend/acceptance/` already builds on every run.
//
// It is its own deployment rather than a second module under `example`, and the
// reason is load-bearing: the decoration below names a registration that exists
// only when the fixture package is installed, and `ctx.di.decorate` refuses a
// name the container does not hold. Put in `example`, it would take every
// `DEPLOYMENT=example` composition in the repository down with it. Here, the
// only process that selects this deployment is the acceptance runner's
// `overlay-decoration` phase — so a composition that cannot apply the decoration
// fails exactly one assertion, which is the assertion's whole job.
//
// **Do not add `acceptance` to `test:backend:deployment`'s `DEPLOYMENT` matrix
// in `.gitlab-ci.yml`.** That job composes the platform from a checkout, and the
// registration this module wraps exists only where the fixture package has been
// installed — which is a throwaway instance the acceptance runner builds and
// nothing else has. The matrix is a hand-written literal rather than a walk of
// `deploymentsOnDisk()`, so nothing adds this deployment on its own; the failure
// if someone does is loud (a refused composition) rather than silent, but it
// would be a red about the harness rather than about the deployment under test.

import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const ACCEPTANCE_OVERLAY_SETTING_CODES = {
  ACTIVATION: 'acceptance_overlay.activation',
} as const;

/**
 * An activation control, because an overlay module is not a second kind of
 * module: both presence axes apply to it unchanged (Principle XVII), and a
 * module with no control would be the one shape this deployment is not meant to
 * demonstrate.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'acceptance_overlay',
  groups: [{ code: 'acceptance_overlay', name: 'Acceptance Overlay' }],
  settings: [
    {
      code: ACCEPTANCE_OVERLAY_SETTING_CODES.ACTIVATION,
      name: 'Acceptance overlay enabled',
      description:
        'Switches this deployment-specific module on or off as a whole. It owns one decoration over a registration an installed package contributes; switching it off leaves that package answering exactly as it does with no deployment at all.',
      groupCode: 'acceptance_overlay',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'acceptance_overlay',
  name: 'Acceptance Overlay',
  description:
    "Decorates a registration owned by the acceptance criterion's fixture package, so that a deployment reaching a packaged owner is measured rather than assumed.",
  version: '1.0.0',
  // No `dependencies` entry for `acceptance_probe`, deliberately. A manifest
  // dependency is a statement about a module this deployment is composed with,
  // and the platform resolves it against the modules it can see; the fixture
  // package is installed in a throwaway instance and is absent from every other
  // composition. What this module actually depends on is a **container name**,
  // which is what the decoration below asserts and what A10 measures — and the
  // failure mode of getting it wrong is loud (`ctx.di.decorate` refuses a name
  // nothing registered) rather than silent.
  dependencies: [],
  activation: { settingCode: ACCEPTANCE_OVERLAY_SETTING_CODES.ACTIVATION, default: true },
  settings,
});
