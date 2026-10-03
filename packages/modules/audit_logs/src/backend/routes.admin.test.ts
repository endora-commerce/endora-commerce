import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moduleIdForAuditAction } from './routes.admin.js';

/**
 * The escape-hatch audit rows (owner decision of 2026-10-03) read well on the
 * audit log screen.
 *
 * The viewer translates an action as `auditLog.<action>` in the bundle of the
 * module `moduleIdForAuditAction` names, and falls back to the raw code when
 * the key is missing — so a row whose module mapping and bundle disagree shows
 * `tenant.escape_hatch` instead of a sentence. The writer is the platform's,
 * and the label is this module's: the audit log is where an operator reads it.
 */

const ESCAPE_HATCH_ACTION = 'tenant.escape_hatch';

function bundle(locale: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(new URL(`../../i18n/${locale}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
}

describe('the cross-organization access row on the audit log screen', () => {
  it('is labelled from this module`s bundle', () => {
    expect(moduleIdForAuditAction(ESCAPE_HATCH_ACTION)).toBe('audit_logs');
  });

  it.each(['en', 'pl'] as const)('has a %s label', (locale) => {
    const label = bundle(locale)[`auditLog.${ESCAPE_HATCH_ACTION}`];
    expect(label).toBeTruthy();
    expect(label).not.toBe(ESCAPE_HATCH_ACTION);
  });
});
