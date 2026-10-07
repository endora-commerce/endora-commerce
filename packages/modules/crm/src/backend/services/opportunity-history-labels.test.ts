import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A history entry is labelled by the Admin UI with `auditLog.<action>` from
 * this module's bundle; a missing key renders as the raw action. Nothing else
 * holds the two together: `i18n:hardcoded` knows nothing of a key no bundle
 * carries.
 *
 * So: every `crm.*` action a Command of this module declares has a label in
 * **both** bundles — except the Commands that write no audit entry at all
 * (`skipAudit` on every path), which can never appear in a history.
 */

/** Recorded with `skipAudit` on every path: derived data, or the second half of an audited change. */
const NEVER_AUDITED = new Set([
  'crm.opportunity.propagation_record',
  'crm.opportunity.propagation_echo',
  'crm.opportunity.value_recalculate',
]);

/** Bell-entry kinds of `crm-notifier.ts`: the same three-part shape, and not Commands. */
const NOTIFICATION_KINDS = new Set([
  'crm.opportunity.assigned',
  'crm.opportunity.message',
  'crm.opportunity.mention',
]);

const servicesDir = new URL('.', import.meta.url);

/**
 * Every `'crm.<object>.<verb>'` literal in the services — the shape of a
 * Command's action, wherever it is written (some are chosen by a conditional,
 * so `action: '…'` alone would miss them). Event names have a version segment
 * and are not matched.
 */
function declaredActions(): string[] {
  const actions = new Set<string>();
  for (const file of readdirSync(servicesDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL(file, servicesDir), 'utf8');
    for (const match of source.matchAll(/'(crm\.[a-z_]+\.[a-z_]+)'/g)) {
      const action = match[1] as string;
      if (!NOTIFICATION_KINDS.has(action)) actions.add(action);
    }
  }
  return [...actions].sort();
}

function bundle(locale: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../../i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
}

describe('crm audit action labels', () => {
  const actions = declaredActions();

  it('reads the Commands of this module — a scan that found none would prove nothing', () => {
    expect(actions.length).toBeGreaterThan(20);
    expect(actions).toContain('crm.opportunity.transition');
    for (const action of NEVER_AUDITED) expect(actions, action).toContain(action);
  });

  it.each(['en', 'pl'] as const)('every audited action has a %s label that is a sentence, not the code', (locale) => {
    const labels = bundle(locale);
    const missing = actions
      .filter((action) => !NEVER_AUDITED.has(action))
      .filter((action) => {
        const label = labels[`auditLog.${action}`];
        return !label || label === action;
      });
    expect(missing).toEqual([]);
  });

  it.each(['en', 'pl'] as const)('no %s label names an action no Command declares', (locale) => {
    const stale = Object.keys(bundle(locale))
      .filter((key) => key.startsWith('auditLog.crm.'))
      .map((key) => key.slice('auditLog.'.length))
      .filter((action) => !actions.includes(action));
    expect(stale).toEqual([]);
  });
});
