import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';
import { contributions } from './index.js';
import { LABELLED_HISTORY_FIELDS, SILENT_HISTORY_FIELDS, humaniseKey } from './lib/history-fields.js';

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
  it('declares the four screens of User Story 1, the board, the tag list and analytics, each on the code its route enforces', () => {
    expect(
      (contributions.routes ?? []).map((route) => [route.path, route.requiredPermission]),
    ).toEqual([
      ['/crm/opportunities', 'crm:read'],
      ['/crm/opportunities/new', 'crm:write'],
      ['/crm/opportunities/:id', 'crm:read'],
      ['/crm/workflow', 'crm:configure'],
      ['/crm/board', 'crm:read'],
      ['/crm/tags', 'crm:configure'],
      ['/crm/analytics', 'crm:analytics'],
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

  it('puts every sidebar row in the CRM section — opportunities, the board, analytics, tags, workflow last', () => {
    expect(
      (contributions.nav ?? []).map((row) => [row.to, row.section, row.requiredPermission]),
    ).toEqual([
      ['/crm/opportunities', 'crm', 'crm:read'],
      ['/crm/board', 'crm', 'crm:read'],
      ['/crm/analytics', 'crm', 'crm:analytics'],
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
      'open-crm-analytics',
    ]);
    for (const action of actions) {
      expect(paths.has(action.targetRoute), action.id).toBe(true);
      // The palette never advertises a screen the operator cannot open.
      expect(action.requiredPermission, action.id).toBe(permissionOf.get(action.targetRoute));
    }
  });
});

describe('crm admin target sizes', () => {
  it('gives every button 44 px of height on a touch screen', () => {
    // The kit's buttons are 36 px (32 px for `sm`) — right for a pointer, short
    // of the repository's 44 px rule for a finger
    // (`.claude/skills/ux-laws/SKILL.md`, Fitts). Every CRM button therefore
    // carries `min-h-11` with a `sm:` step back down; this holds the next one
    // to it. jsdom lays nothing out, so the class is what can be held.
    const short: string[] = [];
    for (const { path, text } of adminSources()) {
      for (const match of text.matchAll(/<Button\b/g)) {
        let end = match.index + match[0].length;
        for (let depth = 0; end < text.length; end += 1) {
          const char = text[end];
          if (char === '{') depth += 1;
          else if (char === '}') depth -= 1;
          else if (char === '>' && depth === 0) break;
        }
        const tag = text.slice(match.index, end + 1);
        if (!/\bmin-h-11\b/.test(tag)) {
          const line = text.slice(0, match.index).split('\n').length;
          short.push(`${path.slice(path.indexOf('/src/admin/') + 11)}:${line}`);
        }
      }
    }
    expect(short).toEqual([]);
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
      // Wave 2 — value, history, references (User Stories 8, 11, 12).
      'value.excluded.kind.': ['order', 'quote_request'],
      'value.excluded.reason.': ['currency_mismatch'],
      'history.document.open.': ['order', 'quote_request'],
      'history.linkSource.': ['manual', 'auto', 'created_from_opportunity', 'quote_conversion'],
      // One label per field the history can show — the set the tab itself reads.
      'history.field.': [...LABELLED_HISTORY_FIELDS],
      'history.notFollowed.': ['skipped', 'failed'],
      'references.kind.': ['product', 'order'],
      'references.inserted.': ['product', 'order'],
      'references.unavailable.': ['product', 'order'],
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
    // Everything but the five families the host and the backend read by a
    // name they build themselves: sidebar rows and palette actions (from the
    // manifest), permission labels, error codes and audit actions. Stated as
    // the exclusion rather than as a list of the screens' prefixes, so a new
    // prefix is held to this test by existing.
    const own = Object.keys(en).filter(
      (key) => !/^(nav|actions|adminRoles|errors|auditLog)\./.test(key),
    );
    expect(own.length).toBeGreaterThan(400);
    const unused = own.filter((key) => {
      if (text.includes(`'${key}'`)) return false;
      // A member of a composed family is asked for through its prefix.
      const prefix = key.slice(0, key.lastIndexOf('.') + 1);
      const grandPrefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf('.') + 1);
      return !text.includes(`\`${prefix}\${`) && !text.includes(`\`${grandPrefix}\${`);
    });
    expect(unused).toEqual([]);
  });

  it('carries the same keys in both languages, each with the same placeholders', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
    const different = Object.keys(en).filter(
      (key) => placeholders(en[key] as string).join() !== placeholders(pl[key] ?? '').join(),
    );
    expect(different).toEqual([]);
  });

  it('keeps to one Polish word for each thing', () => {
    // The owner's vocabulary has one Polish word for a tag, one for an
    // Opportunity and one for a computed value; the pattern below is the
    // synonyms that crept in beside them.
    const strayed = Object.entries(pl)
      .filter(([, text]) => /\btag(i|u|ów|iem|ami|ach)?\b|\btemat|obliczan/i.test(text))
      .map(([key]) => key);
    expect(strayed).toEqual([]);
  });

  it('says of a deleted note only what is true of it', () => {
    // The change history records that a note was deleted and how long it was,
    // never its text (research N-R6).
    expect(en['comments.delete.body']).not.toMatch(/stays in/i);
    expect(pl['comments.delete.body']).not.toMatch(/pozostanie w historii/i);
  });
});

/**
 * The Change history tab shows the audited state of an Opportunity, and the
 * state is written by the backend's Commands. Nothing else holds the two
 * together: a key added to an audited state would reach the operator as
 * "Other change", which is honest and says nothing.
 *
 * So the state keys are read from the services themselves and each one must be
 * a field the tab labels or one it declares silent.
 */
const SERVICES_ROOT = new URL('../backend/services/', import.meta.url);

/** The index of the bracket closing the one opened at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index] as string;
    if ('{[('.includes(char)) depth += 1;
    else if ('}])'.includes(char) && (depth -= 1) === 0) return index;
  }
  return text.length;
}

/** The top-level keys of the object literal opening at `open`, conditional spreads included. */
function literalKeys(text: string, open: number): string[] {
  const end = closing(text, open);
  const keys: string[] = [];
  let itemStart = open + 1;
  const take = (from: number, to: number): void => {
    const item = text.slice(from, to).trim();
    if (item.startsWith('...')) {
      // `...(condition ? { key: … } : {})` — the keys of the literals it spreads.
      for (let index = from; index < to; index += 1) {
        if (text[index] === '{') {
          keys.push(...literalKeys(text, index));
          index = closing(text, index);
        }
      }
      return;
    }
    const key = /^([A-Za-z_]\w*)\s*(:|$)/.exec(item);
    if (key) keys.push(key[1] as string);
  };
  for (let index = open + 1; index < end; index += 1) {
    const char = text[index] as string;
    if ('{[('.includes(char)) index = closing(text, index);
    else if (char === ',') {
      take(itemStart, index);
      itemStart = index + 1;
    }
  }
  take(itemStart, end);
  return keys;
}

/**
 * Every key a `crm.opportunity.*` Command can put in `before` or `after`: the
 * literals assigned to either name, and the snapshot they spread.
 */
function auditedStateKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(SERVICES_ROOT)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL(file, SERVICES_ROOT), 'utf8');
    if (!source.includes("'crm.opportunity.")) continue;
    // Comments carry commas and braces of their own.
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const starts = [
      ...text.matchAll(/\b(?:before|after)(?::| =)[^,;{}\n]*\{/g),
      ...text.matchAll(/function auditSnapshot\([^)]*\)[^{]*\{\s*return \{/g),
    ];
    for (const match of starts) {
      for (const key of literalKeys(text, match.index + match[0].length - 1)) keys.add(key);
    }
  }
  return [...keys].sort();
}

describe('crm change history fields', () => {
  const keys = auditedStateKeys();

  it('reads the audited states of the services — a scan that found none would prove nothing', () => {
    expect(keys.length).toBeGreaterThan(30);
    // One from each shape the scan has to follow: the snapshot, a conditional
    // spread inside it, a literal on one line, a `const before = {`.
    for (const key of ['title', 'customFieldValues', 'linkedDocument', 'outcome', 'fileName', 'causeOrderId']) {
      expect(keys, key).toContain(key);
    }
  });

  it('labels every audited state key, or declares it silent', () => {
    const unknown = keys.filter(
      (key) => !LABELLED_HISTORY_FIELDS.has(key) && !SILENT_HISTORY_FIELDS.has(key),
    );
    expect(unknown).toEqual([]);
  });

  it('carries a label for every labelled field in both languages, and none is the key itself', () => {
    for (const language of ['en', 'pl'] as const) {
      const labels = bundle(language);
      const missing = [...LABELLED_HISTORY_FIELDS].filter((field) => {
        const label = labels[`history.field.${field}`];
        return !label || label === field;
      });
      expect(missing, language).toEqual([]);
    }
  });

  it('never labels a field it also declares silent', () => {
    expect([...LABELLED_HISTORY_FIELDS].filter((field) => SILENT_HISTORY_FIELDS.has(field))).toEqual([]);
  });

  it('reads a key it was never told about as words', () => {
    expect(humaniseKey('riskProfile')).toBe('risk profile');
    expect(humaniseKey('lead_source')).toBe('lead source');
  });
});
