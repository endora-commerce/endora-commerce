import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { contributions } from './index.js';

/**
 * `forms`' admin **declaration** (`specs/170-forms-module/contracts/admin-surfaces.md` §3, T044).
 *
 * Answerable with no DOM — the entry file is data — so it runs under this package's
 * `environment: 'node'` configuration. How the screens behave is the host's
 * `admin/test/modules/forms/`.
 */

const ADMIN_ROOT = new URL('./', import.meta.url);
const I18N_ROOT = new URL('../../i18n/', import.meta.url);

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`${language}.json`, I18N_ROOT), 'utf8')) as Record<string, string>;
}

describe('forms admin contributions', () => {
  it('declares every screen on the code its API enforces, the static paths before /:id', () => {
    expect((contributions.routes ?? []).map((route) => [route.path, route.requiredPermission])).toEqual([
      ['/forms', 'forms:read'],
      ['/forms/new', 'forms:write'],
      // User Story 4 (T081): a user without `forms:entries_read` is refused both (US4-5).
      ['/forms/entries', 'forms:entries_read'],
      ['/forms/entries/:id', 'forms:entries_read'],
      ['/forms/:id', 'forms:read'],
    ]);
    expect((contributions.routes ?? []).filter((route) => route.index).map((route) => route.path)).toEqual(['/forms']);
  });

  it('contributes every screen as a dynamic-import factory', () => {
    for (const route of contributions.routes ?? []) expect(typeof route.component, route.path).toBe('function');
    const entry = readFileSync(new URL('index.ts', ADMIN_ROOT), 'utf8');
    expect(entry).not.toMatch(/^import .* from '\.\/(pages|components)\//m);
  });

  it('puts "Forms" and "Form entries" in the content section', () => {
    expect((contributions.nav ?? []).map((row) => [row.to, row.section, row.weight, row.requiredPermission, row.icon])).toEqual([
      ['/forms', 'content', 260, 'forms:read', 'ClipboardList'],
      ['/forms/entries', 'content', 261, 'forms:entries_read', 'Inbox'],
    ]);
  });

  it('gates every route and nav row on a code its manifest declares', () => {
    const declared = new Set((manifest.permissions ?? []).map((permission) => permission.code));
    for (const route of contributions.routes ?? []) expect(declared.has(String(route.requiredPermission))).toBe(true);
    for (const row of contributions.nav ?? []) expect(declared.has(String(row.requiredPermission))).toBe(true);
  });

  it('labels every nav row in both shipped languages, and ships the same keys in both', () => {
    for (const language of ['en', 'pl'] as const) {
      const shipped = bundle(language);
      for (const row of contributions.nav ?? []) expect(shipped[row.labelKey], `${language}: ${row.labelKey}`).toBeTruthy();
    }
    expect(Object.keys(bundle('pl')).sort()).toEqual(Object.keys(bundle('en')).sort());
  });
});
