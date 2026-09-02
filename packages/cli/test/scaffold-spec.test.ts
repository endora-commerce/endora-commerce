/**
 * The refusals `endora new module` makes before it writes a byte
 * (`contracts/cli-surface.md` §3.3), and the derivations every emitted file
 * reads.
 *
 * Each fixture enters at the top of the analysis — the raw answers, as argv
 * hands them over — rather than at a half-built specification, so the parsing,
 * the normalisation and the manifest validation all run.
 */
import { describe, expect, it } from 'vitest';

import {
  adminScreenRouteOf,
  BASELINE_THROUGH,
  buildScaffoldSpec,
  camelOfActionId,
  formatStamp,
  manifestObjectFor,
  migrationStampFor,
  navLabelKeyOf,
  npmNameFor,
  pascalOf,
  ScaffoldInputError,
  segmentOf,
  slugOf,
} from '../src/new-module/spec.js';

const MINIMAL = {
  id: 'demo_widgets',
  name: 'Demo Widgets',
  description: 'A worked example of a module package.',
};

describe('module id derivations', () => {
  it('strips a leading underscore and hyphenates the rest', () => {
    expect(segmentOf('_lifecycle')).toBe('lifecycle');
    expect(slugOf('quote_requests')).toBe('quote-requests');
    expect(slugOf('_lifecycle')).toBe('lifecycle');
    expect(pascalOf('quote_requests')).toBe('QuoteRequests');
    expect(npmNameFor('@endora-commerce/', 'quote_requests')).toBe(
      '@endora-commerce/mod-quote-requests',
    );
  });

  it('turns a kebab action id into the module-relative key segment', () => {
    expect(camelOfActionId('open-demo-widgets')).toBe('openDemoWidgets');
  });
});

describe('the migration stamp', () => {
  it('is UTC, fixed width, with a literal T at index 8', () => {
    expect(formatStamp(new Date(Date.UTC(2026, 7, 29, 9, 5, 4)))).toBe('20260829T090504');
  });

  it('never lands at or below the frozen historical prefix', () => {
    // A migration stamped inside that block is ordered by history rather than by
    // its module's manifest dependencies, which is an order a fresh database
    // cannot apply.
    expect(migrationStampFor(new Date(Date.UTC(2025, 0, 1)))).toBe('20260801T000001');
    expect(migrationStampFor(new Date(Date.UTC(2025, 0, 1))) > BASELINE_THROUGH).toBe(true);
  });
});

describe('refusals', () => {
  it('refuses an id that is not a legal module id', () => {
    expect(() => buildScaffoldSpec({ ...MINIMAL, id: 'Demo-Widgets' })).toThrow(
      ScaffoldInputError,
    );
    expect(() => buildScaffoldSpec({ ...MINIMAL, id: '9lives' })).toThrow(ScaffoldInputError);
  });

  it('refuses a missing name and a missing description', () => {
    expect(() => buildScaffoldSpec({ id: 'demo_widgets', description: 'x' })).toThrow(
      /--name is required/,
    );
    expect(() => buildScaffoldSpec({ id: 'demo_widgets', name: 'Demo' })).toThrow(
      /--description is required/,
    );
  });

  it('refuses an action with no permission to gate its route', () => {
    // `check:action-route-permissions` compares the action's declared code
    // against the gate on that action's own route; a module with no permission
    // emits no gated route for it to find.
    expect(() =>
      buildScaffoldSpec({ ...MINIMAL, actions: ['open-widgets=/widgets'] }),
    ).toThrow(/needs a --permission/);
  });

  it('refuses a permission the core catalogue already owns', () => {
    expect(() =>
      buildScaffoldSpec({ ...MINIMAL, permissions: ['catalog:read=View catalog'] }),
    ).toThrow(/PERMISSION_CATALOGUE/);
  });

  it('refuses a permission written without a label', () => {
    expect(() => buildScaffoldSpec({ ...MINIMAL, permissions: ['demo:read'] })).toThrow(
      /<code>=<label>/,
    );
  });

  it('refuses an action route carrying a query string', () => {
    expect(() =>
      buildScaffoldSpec({
        ...MINIMAL,
        permissions: ['demo_widgets:read=View widgets'],
        actions: ['open-widgets=/widgets?tab=all'],
      }),
    ).toThrow(/query string/);
  });

  it('refuses an icon outside KnownIconNameSchema', () => {
    expect(() => buildScaffoldSpec({ ...MINIMAL, icon: 'NotAnIcon' })).toThrow(
      /KnownIconNameSchema/,
    );
  });

  it('refuses both activation forms at once, and a reason-less non-deactivatable', () => {
    expect(() =>
      buildScaffoldSpec({
        ...MINIMAL,
        activationSetting: 'demo_widgets.enabled',
        nonDeactivatable: 'because',
      }),
    ).toThrow(/exactly one of them/);
    expect(() => buildScaffoldSpec({ ...MINIMAL, nonDeactivatable: '  ' })).toThrow(
      /needs a reason/,
    );
  });

  it('refuses a dependency on itself and an illegal dependency id', () => {
    expect(() => buildScaffoldSpec({ ...MINIMAL, dependencies: ['demo_widgets'] })).toThrow(
      /this module itself/,
    );
    expect(() => buildScaffoldSpec({ ...MINIMAL, dependencies: ['Not An Id'] })).toThrow(
      /legal module id/,
    );
  });

  it('refuses a tenant scope that is not one of the decorators', () => {
    expect(() => buildScaffoldSpec({ ...MINIMAL, tenantScope: 'tenant' })).toThrow(
      /org-scoped, customer-scoped, global/,
    );
  });

  it('refuses an `_`-prefixed id with anything but a non-deactivatable declaration', () => {
    // `defineModuleManifest` refuses every other activation form for a
    // platform-internal id, and the default `<id>.enabled` is not even a legal
    // setting code for one — so the tool asks for the reason rather than
    // emitting a manifest that throws on import.
    expect(() => buildScaffoldSpec({ ...MINIMAL, id: '_internal' })).toThrow(
      /nonDeactivatable/,
    );
    expect(
      buildScaffoldSpec({ ...MINIMAL, id: '_internal', nonDeactivatable: 'platform-internal' })
        .activation,
    ).toEqual({ kind: 'non-deactivatable', reason: 'platform-internal' });
  });

  it('refuses an activation setting code the settings store would not accept', () => {
    expect(() =>
      buildScaffoldSpec({ ...MINIMAL, activationSetting: 'Demo Widgets Enabled' }),
    ).toThrow(/legal setting code/);
  });
});

describe('the admin layer', () => {
  it('refuses a section outside the set the shell renders', () => {
    // A module may not invent a section: an invented heading is one no other
    // module can join, so an entry declaring one renders nowhere at all.
    expect(() =>
      buildScaffoldSpec({
        ...MINIMAL,
        permissions: ['demo_widgets:read=View demo widgets'],
        admin: 'widgets',
      }),
    ).toThrow(ScaffoldInputError);
  });

  it('refuses an admin layer with no permission to gate it', () => {
    // The nav entry's `requiredPermission` is the code enforced on its own
    // destination, and the destination is this module's admin route — which is
    // emitted only when there is a permission to gate it with. There is no code
    // for the scaffold to invent.
    expect(() => buildScaffoldSpec({ ...MINIMAL, admin: 'system' })).toThrow(
      /--admin needs a --permission/,
    );
  });

  it('is absent unless the flag asked for it', () => {
    expect(buildScaffoldSpec(MINIMAL).layers.admin).toBeNull();
    expect(adminScreenRouteOf(buildScaffoldSpec(MINIMAL))).toBeNull();
  });

  it('mounts the screen on the route the palette action already names', () => {
    // One value, read three times: the action's `targetRoute`, the SPA route,
    // and the server route `/api/v1/admin` + it that the gate is on.
    const spec = buildScaffoldSpec({
      ...MINIMAL,
      permissions: ['demo_widgets:read=View demo widgets'],
      actions: ['open-demo-widgets=/demo-widgets'],
      admin: 'catalog',
    });

    expect(spec.layers.admin).toBe('catalog');
    expect(adminScreenRouteOf(spec)).toBe('/demo-widgets');
    expect(navLabelKeyOf(spec)).toBe('nav.demoWidgets.label');
  });

  it('falls back to the module slug when no action names a route', () => {
    const spec = buildScaffoldSpec({
      ...MINIMAL,
      permissions: ['demo_widgets:read=View demo widgets'],
      admin: 'system',
    });

    expect(adminScreenRouteOf(spec)).toBe('/demo-widgets');
  });
});

describe('the specification it produces', () => {
  it('defaults the activation control to the module\'s own <id>.enabled setting', () => {
    const spec = buildScaffoldSpec(MINIMAL);

    expect(spec.activation).toEqual({ kind: 'setting', settingCode: 'demo_widgets.enabled' });
    expect(spec.tenantScope).toBe('org-scoped');
    expect(spec.icon).toBe('Boxes');
  });

  it('validates the manifest it describes through the contract\'s own validator', () => {
    const spec = buildScaffoldSpec({
      ...MINIMAL,
      permissions: ['demo_widgets:read=View widgets'],
      actions: ['open-widgets=/widgets'],
    });
    const manifest = manifestObjectFor(spec);

    expect(manifest.actions?.[0]).toMatchObject({
      id: 'open-widgets',
      labelKey: 'actions.openWidgets.label',
      descriptionKey: 'actions.openWidgets.description',
      targetRoute: '/widgets',
      requiredPermission: 'demo_widgets:read',
    });
    expect(manifest.permissions?.[0]).toEqual({
      code: 'demo_widgets:read',
      module: 'demo_widgets',
      label: 'View widgets',
    });
  });
});
