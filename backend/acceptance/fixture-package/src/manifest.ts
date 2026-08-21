// The fixture module's manifest — the package's ROOT export.
//
// It is deliberately a plain object rather than a `defineModuleManifest(...)`
// call: the root export of a published module package must be isomorphic and
// carry no runtime dependency (071 `contracts/module-manifest.md`), and a
// third-party author has no `@b2b/contracts` to import at runtime — and not
// even as a type, because a type import resolves through this repository's
// `paths` and drags the contracts sources into the package's own build. The
// built artefact therefore names nothing from this repository, which the runner
// asserts on the packed tarball before it installs anything.
//
// Every schema default is written out, because nothing parses this object on
// the way out: `ModuleManifestSchema` applies its defaults inside
// `defineModuleManifest`, and a package that never calls it must supply them.
// That it *would* parse is checked on the repository side, by
// `backend/test/unit/scripts/package-schema-acceptance.test.ts`, against the
// real schema — a type import would have dragged the contracts sources into
// this package's build, which is the coupling the artefact must not have.

/** The Setting that holds the operator's activation choice (Principle XVII). */
export const ACCEPTANCE_PROBE_ACTIVATION_SETTING = 'acceptance_probe.activation';

/** The one admin permission this module owns. */
export const ACCEPTANCE_PROBE_PERMISSION = 'acceptance_probe:manage';

/** The table the migration creates and the entity maps. */
export const ACCEPTANCE_PROBE_TABLE = 'acceptance_probe_rows';

export const manifest = {
  id: 'acceptance_probe',
  name: 'Acceptance Probe',
  description:
    'Synthetic third-party module. It exists to prove that a package installed from a tarball reaches the database, the composition, the permission catalogue and the command palette.',
  version: '1.0.0',
  // `backend/index.ts` resolves `requireAdmin`, which `auth` owns. A package
  // declares that edge exactly as a core module does.
  dependencies: ['auth'],
  activation: {
    settingCode: ACCEPTANCE_PROBE_ACTIVATION_SETTING,
    default: true,
  },
  settings: {
    moduleCode: 'acceptance_probe',
    groups: [{ code: 'acceptance_probe', name: 'Acceptance Probe' }],
    settings: [
      {
        code: ACCEPTANCE_PROBE_ACTIVATION_SETTING,
        name: 'Acceptance probe enabled',
        description:
          'Switches the acceptance-probe module on or off as a whole: its admin route, its permission and its palette action.',
        groupCode: 'acceptance_probe',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'open-acceptance-probe',
      labelKey: 'actions.openAcceptanceProbe.label',
      descriptionKey: 'actions.openAcceptanceProbe.description',
      icon: 'Boxes',
      targetRoute: '/acceptance-probe',
      requiredPermission: ACCEPTANCE_PROBE_PERMISSION,
      keywords: ['acceptance', 'probe', 'package'],
      weight: 100,
    },
  ],
  permissions: [
    {
      code: ACCEPTANCE_PROBE_PERMISSION,
      module: 'acceptance_probe',
      label: 'Manage the acceptance probe module',
    },
  ],
};

export default manifest;
