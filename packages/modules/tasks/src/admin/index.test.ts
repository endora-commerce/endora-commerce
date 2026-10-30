/// <reference types="node" />
// The test runs in Node; the admin layer it tests is compiled without Node types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { contributions } from './index.js';

/**
 * `tasks`' admin **declaration** (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§2, task T067).
 *
 * Answerable with no DOM — the entry file is data — so it runs under this
 * package's `environment: 'node'` configuration. How the screens behave is the
 * host's `admin/test/modules/tasks/`.
 */

const ADMIN_ROOT = new URL('./', import.meta.url);
const I18N_ROOT = new URL('../../i18n/', import.meta.url);

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`${language}.json`, I18N_ROOT), 'utf8')) as Record<string, string>;
}

describe('tasks admin contributions', () => {
  it('declares its screens, each on the code its route enforces — the workflow (165 T047), priorities and tags (T083) and general settings (T071) on tasks:configure', () => {
    expect((contributions.routes ?? []).map((route) => [route.path, route.requiredPermission])).toEqual([
      ['/tasks', 'tasks:read'],
      ['/tasks/mine', 'tasks:read'],
      ['/tasks/new', 'tasks:write'],
      ['/tasks/settings/workflow', 'tasks:configure'],
      ['/tasks/settings/priorities', 'tasks:configure'],
      ['/tasks/settings/tags', 'tasks:configure'],
      ['/tasks/settings/general', 'tasks:configure'],
      ['/tasks/:id', 'tasks:read'],
    ]);
    expect((contributions.routes ?? []).filter((route) => route.index)).toHaveLength(1);
  });

  it('contributes every screen as a dynamic-import factory', () => {
    for (const route of contributions.routes ?? []) {
      expect(typeof route.component, route.path).toBe('function');
    }
    const entry = readFileSync(new URL('index.ts', ADMIN_ROOT), 'utf8');
    expect(entry).not.toMatch(/^import .* from '\.\/(pages|components)\//m);
  });

  it('puts "My tasks" and "Tasks" after "Projects", and "Task settings" with the section’s configuration rows', () => {
    expect(
      (contributions.nav ?? []).map((row) => [row.to, row.section, row.weight, row.requiredPermission, row.icon]),
    ).toEqual([
      ['/tasks/mine', 'work', 200, 'tasks:read', 'ListChecks'],
      ['/tasks', 'work', 210, 'tasks:read', 'ListChecks'],
      ['/tasks/settings/workflow', 'work', 430, 'tasks:configure', 'Settings'],
    ]);
  });

  it('gates every route and nav row on a code its manifest declares', () => {
    const declared = new Set((manifest.permissions ?? []).map((permission) => permission.code));
    for (const route of contributions.routes ?? []) for (const code of [route.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
    for (const row of contributions.nav ?? []) for (const code of [row.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
    for (const zone of contributions.zones ?? []) for (const code of [zone.requiredPermission ?? ''].flat()) expect(declared.has(code)).toBe(true);
  });

  it('contributes the Tasks panel to an Order, a Quote Request and an Opportunity (165 US6)', () => {
    expect((contributions.zones ?? []).map((zone) => [zone.zone, zone.weight, zone.requiredPermission])).toEqual([
      ['order.detail.after', 660, 'tasks:read'],
      ['quote_request.detail.after', 660, 'tasks:read'],
      ['opportunity.detail.after', 660, 'tasks:read'],
    ]);
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
