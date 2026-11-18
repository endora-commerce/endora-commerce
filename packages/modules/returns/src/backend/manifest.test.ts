import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

/**
 * `specs/180-off-platform-complaints/` T036 — the manifest's phase-A declarations
 * (contracts/settings-emails-events.md §1, §2, §6).
 */
describe('returns manifest — phase A', () => {
  it('declares returns.new_case_recipients as an empty string list', () => {
    const setting = manifest.settings?.settings.find((s) => s.code === 'returns.new_case_recipients');
    expect(setting).toMatchObject({ valueType: 'string_list', defaultValue: [], groupCode: 'returns' });
    expect(setting?.description).toMatch(/10/);
  });

  it('declares the four notification e-mails with their variables', () => {
    const emails = Object.fromEntries((manifest.transactionalEmails ?? []).map((e) => [e.code, e]));
    const keys = (code: string): string[] => (emails[code]?.variables ?? []).map((v) => v.key);
    expect(keys('return_new_case')).toEqual([
      'caseReference',
      'kindLabel',
      'customerName',
      'organizationName',
      'productList',
      'offPlatform',
      'submittedAt',
      'adminCaseUrl',
    ]);
    expect(keys('return_submitted')).toEqual(['caseReference', 'kindLabel', 'productList', 'submittedAt', 'caseUrl']);
    expect(keys('return_comment_added')).toEqual(['caseReference', 'commentBody', 'caseUrl']);
    expect(keys('return_status_entered')).toEqual(['caseReference', 'statusName', 'caseUrl']);
    for (const code of ['return_new_case', 'return_submitted', 'return_comment_added', 'return_status_entered']) {
      expect(emails[code]?.group).toBe('returns');
    }
  });

  it('binds admin_users, which names the authorizer and the bell recipients', () => {
    expect(manifest.dependencies).toContain('admin_users');
  });

  it('degrades without admin_notifications, saying what is lost', () => {
    const edge = (manifest.nonBindingDependencies ?? []).find((e) => e.moduleId === 'admin_notifications');
    expect(edge).toMatchObject({ name: 'adminNotificationRecordPort', kind: 'degrades-without' });
    expect(edge && 'whenAbsent' in edge ? edge.whenAbsent : '').toBe(
      'no bell entry is recorded for a new return or complaint; the case, the shop e-mail and the customer e-mails are unaffected',
    );
    expect(manifest.dependencies).not.toContain('admin_notifications');
  });
});

/**
 * `specs/180-off-platform-complaints/` T095 — the phase-B declarations
 * (contracts/settings-emails-events.md §1, §4, §6, §8).
 */
describe('returns manifest — phase B', () => {
  const en = JSON.parse(readFileSync(new URL('../../i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const pl = JSON.parse(readFileSync(new URL('../../i18n/pl.json', import.meta.url), 'utf8')) as Record<string, string>;

  it('declares the two boolean settings, off by default, with en and pl labels', () => {
    for (const [code, key] of [
      ['returns.off_platform_complaints_enabled', 'settings.offPlatformComplaintsEnabled.label'],
      ['returns.proof_of_purchase_required', 'settings.proofOfPurchaseRequired.label'],
      ['returns.new_case_recipients', 'settings.newCaseRecipients.label'],
    ] as const) {
      const setting = manifest.settings?.settings.find((s) => s.code === code);
      if (code !== 'returns.new_case_recipients') {
        expect(setting, code).toMatchObject({ valueType: 'boolean', defaultValue: false, groupCode: 'returns' });
      }
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });

  it('binds assets_library and catalog, which hold the bytes and judge the product', () => {
    expect(manifest.dependencies).toEqual(expect.arrayContaining(['assets_library', 'catalog']));
  });

  it('declares the read-gated return-clauses palette action, worded in en and pl', () => {
    const action = (manifest.actions ?? []).find((a) => a.id === 'return-clauses');
    expect(action).toMatchObject({
      labelKey: 'actions.returnClauses.label',
      descriptionKey: 'actions.returnClauses.description',
      icon: 'FileCheck',
      targetRoute: '/returns/clauses',
      requiredPermission: 'returns:read',
      keywordsKey: 'actions.returnClauses.keywords',
      weight: 236,
    });
    for (const key of ['actions.returnClauses.label', 'actions.returnClauses.description', 'actions.returnClauses.keywords']) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });

  it('owns the five error codes, each with an en and a pl sentence', () => {
    const codes = (manifest.errorCodes ?? []).map((e) => e.code);
    for (const code of [
      'RETURN_OFF_PLATFORM_DISABLED',
      'RETURN_PROOF_OF_PURCHASE_REQUIRED',
      'RETURN_CLAUSES_NOT_ACCEPTED',
      'RETURN_ATTACHMENT_REJECTED',
      'RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM',
    ]) {
      expect(codes).toContain(code);
    }
    for (const code of codes) {
      expect(en[`errors.${code}`], code).toBeTruthy();
      expect(pl[`errors.${code}`], code).toBeTruthy();
    }
  });
});
