import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { contributions } from './index.js';

/**
 * `projects`' admin **declaration** (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§3, tasks T055 and T096).
 *
 * Answerable with no DOM — the entry file is data — so it runs under this
 * package's `environment: 'node'` configuration. How the screens behave is the
 * host's `admin/test/modules/projects/`.
 */

const ADMIN_ROOT = new URL('./', import.meta.url);
const I18N_ROOT = new URL('../../i18n/', import.meta.url);

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`${language}.json`, I18N_ROOT), 'utf8')) as Record<string, string>;
}

describe('projects admin contributions', () => {
  it('declares its screens, each on the code its route enforces', () => {
    expect((contributions.routes ?? []).map((route) => [route.path, route.requiredPermission])).toEqual([
      ['/projects', 'projects:read'],
      ['/projects/new', 'projects:write'],
      // User Story 3 — Templates are configuration.
      ['/projects/templates', 'projects:configure'],
      ['/projects/templates/new', 'projects:configure'],
      ['/projects/templates/:id', 'projects:configure'],
      // User Story 4 — Project Roles and loss reasons are configuration too.
      ['/projects/roles', 'projects:configure'],
      ['/projects/loss-reasons', 'projects:configure'],
      // User Story 10 — analytics, on a code of its own.
      ['/projects/analytics', 'projects:analytics'],
      ['/projects/:id', 'projects:read'],
    ]);
    expect((contributions.routes ?? []).filter((route) => route.index)).toHaveLength(1);
  });

  it('contributes every screen as a dynamic-import factory', () => {
    for (const route of contributions.routes ?? []) {
      expect(typeof route.component, route.path).toBe('function');
    }
    const entry = readFileSync(new URL('index.ts', ADMIN_ROOT), 'utf8');
    expect(entry).not.toMatch(/^import .* from '\.\/(pages|components|zones)\//m);
  });

  it('puts "Projects" first in the "Projects & tasks" section, on projects:read, and the configuration after the Tasks entries', () => {
    expect(
      (contributions.nav ?? []).map((row) => [row.to, row.section, row.weight, row.requiredPermission, row.icon]),
    ).toEqual([
      ['/projects', 'work', 100, 'projects:read', 'ClipboardList'],
      ['/projects/analytics', 'work', 300, 'projects:analytics', 'LineChart'],
      ['/projects/templates', 'work', 400, 'projects:configure', 'Layers'],
      ['/projects/roles', 'work', 410, 'projects:configure', 'Users'],
      ['/projects/loss-reasons', 'work', 420, 'projects:configure', 'Tag'],
    ]);
  });

  it('contributes the Project panel to the four record screens and the Organization’s Projects to its screen, on projects:read, at weight 650 (User Stories 6, 11)', () => {
    expect((contributions.zones ?? []).map((zone) => [zone.zone, zone.weight, zone.requiredPermission])).toEqual([
      ['order.detail.after', 650, 'projects:read'],
      ['quote_request.detail.after', 650, 'projects:read'],
      ['opportunity.detail.after', 650, 'projects:read'],
      ['task.detail.after', 650, 'projects:read'],
      ['organization.detail.after', 650, 'projects:read'],
    ]);
    for (const zone of contributions.zones ?? []) expect(typeof zone.component, zone.zone).toBe('function');
  });

  it('gates every route, nav row and zone on a code its manifest declares', () => {
    const declared = new Set((manifest.permissions ?? []).map((permission) => permission.code));
    for (const route of contributions.routes ?? []) for (const code of [route.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
    for (const row of contributions.nav ?? []) for (const code of [row.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
    for (const zone of contributions.zones ?? []) for (const code of [zone.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
  });

  it('labels every nav row in both shipped languages', () => {
    for (const language of ['en', 'pl'] as const) {
      const shipped = bundle(language);
      for (const row of contributions.nav ?? []) expect(shipped[row.labelKey], `${language}: ${row.labelKey}`).toBeTruthy();
    }
  });

  it('ships every English key in Polish too, and no Polish key English lacks', () => {
    expect(Object.keys(bundle('pl')).sort()).toEqual(Object.keys(bundle('en')).sort());
  });
});
