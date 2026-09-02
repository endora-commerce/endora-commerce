import { describe, expect, it } from 'vitest';

import {
  DuplicateAdminRouteError,
  registryNavFor,
  registryRoutes,
} from '../../src/lib/module-registry';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated';

/**
 * The generated admin registry, flattened (feature 091, Phase 2).
 *
 * The entries are driven in rather than read from the artefact wherever the
 * property is about the flattening, so a proof enters at the top of the
 * analysis and does not depend on which modules happen to be converted today.
 * The two cases that *are* about the artefact say so.
 */

const entries = (
  ...items: { moduleId: string; contributions: Record<string, unknown> }[]
): typeof MODULE_ADMIN_CONTRIBUTIONS => items as unknown as typeof MODULE_ADMIN_CONTRIBUTIONS;

const screen = (): Promise<{ default: unknown }> => Promise.resolve({ default: () => null });

describe('registryRoutes', () => {
  it('attributes every route to the module that shipped it', () => {
    // Owner attribution is not a declared field, for D-142's reason: an
    // attribution a module can write is one a module can get wrong. The key of
    // the registry entry is the only thing that says who owns a screen.
    const routes = registryRoutes(
      entries({ moduleId: 'widgets', contributions: { routes: [{ path: '/w', component: screen }] } }),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]!.module).toBe('widgets');
  });

  it('refuses two modules declaring the same path, naming both', () => {
    // Not last-one-wins: `react-router` silently takes the first match, so the
    // second module's screen would be unreachable with no error anywhere.
    expect(() =>
      registryRoutes(
        entries(
          { moduleId: 'widgets', contributions: { routes: [{ path: '/w', component: screen }] } },
          { moduleId: 'gadgets', contributions: { routes: [{ path: '/w', component: screen }] } },
        ),
      ),
    ).toThrow(DuplicateAdminRouteError);
    try {
      registryRoutes(
        entries(
          { moduleId: 'widgets', contributions: { routes: [{ path: '/w', component: screen }] } },
          { moduleId: 'gadgets', contributions: { routes: [{ path: '/w', component: screen }] } },
        ),
      );
    } catch (error) {
      expect((error as Error).message).toContain('widgets');
      expect((error as Error).message).toContain('gadgets');
      expect((error as Error).message).toContain('/w');
    }
  });

  it('reads a module that contributes only nav as contributing no route', () => {
    // All three arrays are optional; a module shipping one sidebar entry that
    // points at a host route is legal.
    expect(
      registryRoutes(entries({ moduleId: 'widgets', contributions: { nav: [] } })),
    ).toEqual([]);
  });

  it('filters nothing — presence and permission are the render-time predicate', () => {
    // The registry answers "what could be here". `isSurfaceVisible` answers
    // "what is here for this operator right now", because an activation flip
    // must take effect without a rebuild (Principle XVII item 5).
    const routes = registryRoutes(
      entries({
        moduleId: 'widgets',
        contributions: { routes: [{ path: '/w', component: screen, requiredPermission: 'x:read' }] },
      }),
    );
    expect(routes[0]!.requiredPermission).toBe('x:read');
  });
});

describe('registryNavFor', () => {
  it('returns only the section asked for', () => {
    const found = registryNavFor(
      'system',
      entries({
        moduleId: 'widgets',
        contributions: {
          nav: [
            { to: '/w', labelKey: 'nav.w.label', icon: 'Box', section: 'system', weight: 10 },
            { to: '/g', labelKey: 'nav.g.label', icon: 'Box', section: 'catalog', weight: 10 },
          ],
        },
      }),
    );
    expect(found.map((item) => item.to)).toEqual(['/w']);
  });

  it('orders by weight, then by module id, so the sidebar is not insertion-dependent', () => {
    const found = registryNavFor(
      'system',
      entries(
        {
          moduleId: 'zeta',
          contributions: {
            nav: [{ to: '/z', labelKey: 'n', icon: 'Box', section: 'system', weight: 10 }],
          },
        },
        {
          moduleId: 'alpha',
          contributions: {
            nav: [{ to: '/a', labelKey: 'n', icon: 'Box', section: 'system', weight: 10 }],
          },
        },
        {
          moduleId: 'mid',
          contributions: {
            nav: [{ to: '/m', labelKey: 'n', icon: 'Box', section: 'system', weight: 5 }],
          },
        },
      ),
    );
    expect(found.map((item) => item.to)).toEqual(['/m', '/a', '/z']);
  });

  it('carries the owner, so `isSurfaceVisible` has a module to gate on', () => {
    const found = registryNavFor(
      'system',
      entries({
        moduleId: 'widgets',
        contributions: {
          nav: [{ to: '/w', labelKey: 'n', icon: 'Box', section: 'system', weight: 1 }],
        },
      }),
    );
    expect(found[0]!.module).toBe('widgets');
  });
});

describe('the committed artefact', () => {
  it('holds `import_export`, the first module to own its admin surface', () => {
    // The one assertion that is about the artefact rather than the flattening:
    // it is what makes a regeneration that silently dropped the layer red.
    expect(MODULE_ADMIN_CONTRIBUTIONS.map((entry) => entry.moduleId)).toContain('import_export');
  });

  it('declares `/import-export` with the code its own API routes enforce', () => {
    const route = registryRoutes().find((item) => item.path === '/import-export');
    expect(route, 'no /import-export route in the registry').toBeDefined();
    expect(route!.module).toBe('import_export');
    expect(route!.requiredPermission).toBe('catalog:write');
  });
});
