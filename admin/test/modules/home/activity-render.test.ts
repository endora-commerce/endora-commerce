import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_RENDERING,
  formatRelative,
  renderActivity,
} from '../../../../packages/admin-shell/src/modules/home/activity-render';

/**
 * Feature 024 / T013, rewritten by feature 080's T042j (D-163.1).
 *
 * This file used to open with a **verbatim copy of the backend allow-list**,
 * 22 tokens, under a comment saying the duplication was intentional so that
 * either side adding a token without the other would fail. It did not fail:
 * `prompt_action.execute` had been in the backend list and absent from this
 * one — and from this copy of it — for as long as feature 043 had shipped, and
 * the assertion that would have caught it (`ACTIVITY_RENDERING[action]` is
 * defined) only ever ran over the tokens somebody remembered to paste here.
 *
 * There is no table left to mirror. The rendering arrives on the row, so what
 * this file tests is the resolution and the fallback, and the guard against
 * a table coming back is a source assertion at the bottom.
 */

describe('renderActivity', () => {
  it('renders what the row declares — any module, including one this build never heard of', () => {
    const r = renderActivity({
      module: 'acceptance_probe',
      icon: 'Boxes',
      labelKey: 'activity.verb.probe.execute',
    });
    expect(r.scope).toBe('acceptance_probe');
    expect(r.verbKey).toBe('activity.verb.probe.execute');
    expect(r.icon).not.toBe(UNKNOWN_RENDERING.icon);
  });

  it('resolves the verb in the declaring module rather than in core', () => {
    const r = renderActivity({
      module: 'catalog',
      icon: 'Plus',
      labelKey: 'activity.verb.product.create',
    });
    expect(r.scope).toBe('catalog');
    // The pre-T042j key. It moved to the owning module's bundle with the table.
    expect(r.verbKey).not.toMatch(/^home\.activity\.verb\./);
  });

  it('falls back to a generic icon for a name this build does not map', () => {
    const r = renderActivity({
      module: 'catalog',
      icon: 'NoSuchIcon',
      labelKey: 'activity.verb.product.create',
    });
    // Still renders, and still in the module's own scope: an unknown icon is
    // never a reason to drop a row.
    expect(r.scope).toBe('catalog');
    expect(r.verbKey).toBe('activity.verb.product.create');
  });

  it('falls back to UNKNOWN_RENDERING when the row carries no label key', () => {
    expect(renderActivity({ module: 'catalog', icon: 'Plus', labelKey: '' })).toBe(
      UNKNOWN_RENDERING,
    );
    expect(
      renderActivity({ module: '', icon: 'Plus', labelKey: 'activity.verb.x.y' }),
    ).toBe(UNKNOWN_RENDERING);
    expect(UNKNOWN_RENDERING.verbKey).toBe('home.activity.verb.unknown');
    expect(UNKNOWN_RENDERING.scope).toBe('core');
  });
});

/**
 * The retiring condition for D-163.1's fourth table, on the admin side.
 *
 * Its backend siblings are asserted in
 * `backend/test/unit/audit_logs/derived-action-tables.test.ts`; this half lives
 * here because the file is this app's. An audit action token is
 * `<object>.<verb>` in snake_case, and the only reason to write one in this
 * module is to key a table off it.
 */
describe('the dashboard rendering table stays retired', () => {
  const SOURCE = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/admin-shell/src/modules/home/activity-render.ts',
  );

  it('names no audit action token', () => {
    const source = readFileSync(SOURCE, 'utf8');
    // Strip comments: the file explains what it retired, by name.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const tokens = code.match(/['"][a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+['"]/g) ?? [];
    expect(
      tokens.filter((t) => !t.includes('home.activity.')),
      'an action token written here is a hand-maintained rendering table coming back — ' +
        'the icon and the verb key travel on the row, declared by the owning module',
    ).toEqual([]);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-05-20T12:00:00.000Z').getTime();

  it('returns "justNow" within a minute', () => {
    expect(formatRelative('2026-05-20T11:59:30.000Z', now).key).toBe('home.activity.time.justNow');
  });

  it('returns minutesAgo with a count when between 1 and 59 minutes', () => {
    const r = formatRelative('2026-05-20T11:58:00.000Z', now);
    expect(r.key).toBe('home.activity.time.minutesAgo');
    expect(r.params).toEqual({ count: 2 });
  });

  it('returns hoursAgo when between 1 and 23 hours', () => {
    const r = formatRelative('2026-05-20T05:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.hoursAgo');
    expect(r.params).toEqual({ count: 7 });
  });

  it('returns yesterday at ~24 h', () => {
    const r = formatRelative('2026-05-19T12:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.yesterday');
  });

  it('returns daysAgo when older than yesterday', () => {
    const r = formatRelative('2026-05-15T12:00:00.000Z', now);
    expect(r.key).toBe('home.activity.time.daysAgo');
    expect(r.params).toEqual({ count: 5 });
  });

  it('handles invalid timestamps gracefully', () => {
    expect(formatRelative('not-a-date', now).key).toBe('home.activity.time.justNow');
  });
});
