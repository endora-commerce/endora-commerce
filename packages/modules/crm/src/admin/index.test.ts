import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { contributions } from './index.js';

/**
 * `crm`'s admin **declaration** and this package's own source hygiene
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1–§3, §7).
 *
 * Answerable with no DOM — the entry file is data — so it runs under this
 * package's `environment: 'node'` configuration, here and wherever the package
 * is installed. How the screens behave is the host's
 * `admin/test/modules/crm/`.
 */

const ADMIN_ROOT = new URL('./', import.meta.url);
const I18N_ROOT = new URL('../../i18n/', import.meta.url);

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`${language}.json`, I18N_ROOT), 'utf8')) as Record<
    string,
    string
  >;
}

/** Every `.ts` / `.tsx` source under `src/admin/`, tests excluded. */
function adminSources(directory: URL = ADMIN_ROOT): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) found.push(...adminSources(url));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push({ path: url.pathname, text: readFileSync(url, 'utf8') });
    }
  }
  return found;
}

describe('crm admin contributions', () => {
  it('declares the four screens of User Story 1, the board and the tag list, each on the code its route enforces', () => {
    expect(
      (contributions.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    ).toEqual([
      ['/crm/opportunities', 'crm:read'],
      ['/crm/opportunities/new', 'crm:write'],
      ['/crm/opportunities/:id', 'crm:read'],
      ['/crm/workflow', 'crm:configure'],
      ['/crm/board', 'crm:read'],
      ['/crm/tags', 'crm:configure'],
    ]);
    expect((contributions.routes ?? []).filter((route) => route.index)).toHaveLength(1);
  });

  it('contributes every component as a dynamic-import factory', () => {
    for (const route of contributions.routes ?? []) {
      expect(typeof route.component, route.path).toBe('function');
    }
    // The entry exports data: a static import of a screen here would put every
    // CRM screen into the admin's entry chunk.
    const entry = readFileSync(new URL('index.ts', ADMIN_ROOT), 'utf8');
    expect(entry).not.toMatch(/^import .* from '\.\/(pages|components)\//m);
  });

  it('puts every sidebar row in the CRM section — opportunities, the board, tags, workflow last', () => {
    expect(
      (contributions.nav ?? []).map((row) => [row.to, row.section, row.requiredPermission]),
    ).toEqual([
      ['/crm/opportunities', 'crm', 'crm:read'],
      ['/crm/board', 'crm', 'crm:read'],
      ['/crm/tags', 'crm', 'crm:configure'],
      ['/crm/workflow', 'crm', 'crm:configure'],
    ]);
    const weights = (contributions.nav ?? []).map((row) => row.weight ?? 0);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
    expect(new Set(weights).size).toBe(weights.length);
  });

  it('points every sidebar row and every palette action at a route it declares', () => {
    const paths = new Set((contributions.routes ?? []).map((route) => route.path));
    const permissionOf = new Map(
      (contributions.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    );
    for (const row of contributions.nav ?? []) {
      expect(paths.has(row.to), row.to).toBe(true);
      expect(row.requiredPermission, row.to).toBe(permissionOf.get(row.to));
    }
    const actions = manifest.actions ?? [];
    expect(actions.map((action) => action.id)).toEqual([
      'open-opportunities',
      'new-opportunity',
      'open-opportunity-board',
    ]);
    for (const action of actions) {
      expect(paths.has(action.targetRoute), action.id).toBe(true);
      // The palette never advertises a screen the operator cannot open.
      expect(action.requiredPermission, action.id).toBe(permissionOf.get(action.targetRoute));
    }
  });
});

describe('crm admin copy', () => {
  const en = bundle('en');
  const pl = bundle('pl');
  const sources = adminSources();

  it('reads the sources it claims to read', () => {
    // A walk that found nothing would pass every case below.
    expect(sources.length).toBeGreaterThan(10);
  });

  it('carries every key a screen asks for, in both languages', () => {
    const asked = new Set<string>();
    for (const { text } of sources) {
      // `t('a.b')` and `t('a.b', {…})` — the module's own translator is always
      // named `t`; the host's shared one is `tCore` and is not this bundle's.
      for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) asked.add(match[1] as string);
      for (const match of text.matchAll(/\blabelKey: '([^']+)'/g)) asked.add(match[1] as string);
    }
    expect(asked.size).toBeGreaterThan(100);
    const missing = [...asked].filter((key) => en[key] === undefined || pl[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('carries every member of the key families a screen composes at run time', () => {
    // A template-literal key is invisible to the scan above, so each family is
    // enumerated from the vocabulary that produces it.
    const families: Record<string, readonly string[]> = {
      'workflow.kind.': ['open', 'won', 'lost'],
      'workflow.field.name.': ['en', 'pl'],
      'opportunity.state.': ['open', 'won', 'lost'],
      'opportunity.source.': ['manual', 'order', 'quote_request'],
      'opportunity.status.closed.': ['won', 'lost'],
      'assignment.filter.option.': ['me', 'unassigned', 'person'],
      'opportunity.list.sortOption.': [
        'createdAt.desc',
        'createdAt.asc',
        'updatedAt.desc',
        'value.desc',
        'expectedCloseDate.asc',
      ],
      'propagation.outcome.': [
        'applied',
        'already_there',
        'not_found',
        'unknown_status',
        'not_permitted',
        'vetoed',
        'failed',
        'skipped',
      ],
    };
    const composed = sources.flatMap(({ text }) =>
      [...text.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)].map((match) => match[1] as string),
    );
    // Every family a screen composes is one this test enumerates.
    expect([...new Set(composed)].sort()).toEqual(Object.keys(families).sort());
    for (const [prefix, members] of Object.entries(families)) {
      for (const member of members) {
        expect(en[`${prefix}${member}`], `en ${prefix}${member}`).toBeDefined();
        expect(pl[`${prefix}${member}`], `pl ${prefix}${member}`).toBeDefined();
      }
    }
  });

  it('ships no key under its own prefixes that no screen asks for', () => {
    const text = sources.map((source) => source.text).join('\n');
    const own = Object.keys(en).filter((key) =>
      /^(opportunity|links|propagation|workflow|board|assignment|tags|comments|attachments)\./.test(key),
    );
    const unused = own.filter((key) => {
      if (text.includes(`'${key}'`)) return false;
      // A member of a composed family is asked for through its prefix.
      const prefix = key.slice(0, key.lastIndexOf('.') + 1);
      const grandPrefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf('.') + 1);
      return !text.includes(`\`${prefix}\${`) && !text.includes(`\`${grandPrefix}\${`);
    });
    expect(unused).toEqual([]);
  });
});
