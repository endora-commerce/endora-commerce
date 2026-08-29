// The fixture module's manifest — the package's ROOT export.
//
// It is deliberately a plain object rather than a `defineModuleManifest(...)`
// call: the root export of a published module package must be isomorphic and
// carry no runtime dependency (071 `contracts/module-manifest.md`), and a
// third-party author has no `@endora-commerce/contracts` to import at runtime — and not
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

/**
 * The operator command this package declares — feature 080, T042b / D-160.9.
 *
 * A package's CLI can only ever be a declaration the host invokes: a file under
 * `node_modules` can name no specifier that resolves to the instance's
 * `backend/src/composition.ts`, and `backend` is an application, not a
 * dependency anything can depend on. So the host composes once, decides this
 * module's presence, and calls this `run` with the module's own
 * `ModuleContext` — which is one-to-one with Magento 2's
 * `CommandListInterface`, where `bin/magento` bootstraps the application and
 * constructs each module's command with its dependencies injected.
 *
 * The context is typed structurally and not imported, for the same reason the
 * manifest above is a plain object: a published module package carries no
 * runtime dependency on this repository, and not even a type import, which
 * would drag the contracts sources into this package's own build.
 */
export const cliCommands = [
  {
    name: 'probe',
    summary: 'Report that a package-declared command reached a composed container.',
    help: 'usage: acceptance_probe probe\n\nPrints the module id the host resolved a context for.',
    async run(context: {
      ctx: unknown;
      argv: readonly string[];
      out: (line: string) => void;
      err: (line: string) => void;
    }): Promise<number> {
      context.out(`acceptance_probe: ran with argv=[${context.argv.join(' ')}]`);
      context.out(`acceptance_probe: context resolved = ${String(context.ctx !== undefined)}`);
      return 0;
    },
  },
];

/**
 * What this package offers the admin home dashboard's Recent Activity card —
 * feature 080, T042j / D-163.1.
 *
 * **This declaration is the row's whole point.** Before it, the card was driven
 * by four host-owned tables, two of which were closed over core module ids —
 * `RECENT_ACTIVITY_ACTIONS` and a `RecentActivityModule` union of four — so a
 * package's audit row was *silently absent* rather than refused. A third-party
 * module could not appear on the shop owner's home screen at all, and nothing
 * anywhere said so.
 *
 * A plain object, like the manifest above and for the same reason: a published
 * module package carries no runtime dependency on this repository and not even a
 * type import. That it *would* parse against `ModuleRecentActivitySchema` is
 * checked on the repository side, by
 * `backend/test/unit/scripts/package-schema-acceptance.test.ts`.
 *
 * The operator's half needs nothing here. `acceptance_probe.recent_activity_visible`
 * is **derived** from this declaration, reconciled by `install` like every other
 * setting a package owns, and defaults to visible.
 */
export const recentActivity = {
  entries: [
    {
      action: 'acceptance_probe.execute',
      icon: 'Boxes',
      labelKey: 'activity.verb.acceptance_probe.execute',
    },
  ],
};

export default manifest;
