import { describe, expect, it } from 'vitest';
import {
  RELATED_PAYERS_ORGANIZATION_PERMISSIONS,
  RELATED_PAYERS_OPERATOR_PERMISSIONS,
  RELATED_PAYERS_SETTING_CODES,
  RELATED_PAYERS_SETTING_DEFAULTS,
} from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';
import en from '../../i18n/en.json' with { type: 'json' };
import pl from '../../i18n/pl.json' with { type: 'json' };

/** FR-001, FR-003, FR-024, FR-090 — what `related_payers` declares. */
describe('related_payers manifest', () => {
  const settings = manifest.settings?.settings ?? [];

  it('is operator-toggleable and shipped off (RP-1)', () => {
    expect(manifest.id).toBe('related_payers');
    expect(manifest.activation).toEqual({ settingCode: RELATED_PAYERS_SETTING_CODES.MODULE_ENABLED, default: false });
    expect(settings.find((s) => s.code === RELATED_PAYERS_SETTING_CODES.MODULE_ENABLED)).toMatchObject({
      valueType: 'boolean',
      defaultValue: false,
    });
  });

  it('declares the six channel settings with their defaults (FR-003)', () => {
    for (const [code, value] of Object.entries(RELATED_PAYERS_SETTING_DEFAULTS)) {
      expect(settings.find((s) => s.code === code), code).toMatchObject({ groupCode: 'related_payers', defaultValue: value });
    }
    expect(settings.find((s) => s.code === RELATED_PAYERS_SETTING_CODES.APPROVAL_MODE)?.enumOptions).toEqual([
      'payer',
      'admin',
      'payer_then_admin',
    ]);
    expect(settings.find((s) => s.code === RELATED_PAYERS_SETTING_CODES.UNREGISTERED_PAYER_MODE)?.enumOptions).toEqual([
      'invite',
      'admin',
    ]);
    // A sales-channel override is the settings module's default for a declared setting;
    // none of the six is platform-wide only.
    for (const code of Object.keys(RELATED_PAYERS_SETTING_DEFAULTS)) {
      expect(settings.find((s) => s.code === code)?.hidden ?? false, code).toBe(false);
    }
  });

  it('declares the two operator codes; managing also needs the organization create code', () => {
    expect(manifest.permissions?.map((p) => p.code)).toEqual([
      RELATED_PAYERS_OPERATOR_PERMISSIONS.READ,
      RELATED_PAYERS_OPERATOR_PERMISSIONS.MANAGE,
    ]);
    expect(manifest.permissions?.find((p) => p.code === RELATED_PAYERS_OPERATOR_PERMISSIONS.MANAGE)?.requires).toEqual([
      'related_payers:read',
      'customers:manage',
    ]);
  });

  it('declares an organization permission with the guard that names it, never a member default', () => {
    expect(manifest.organizationPermissions?.map((p) => p.code)).toEqual([
      RELATED_PAYERS_ORGANIZATION_PERMISSIONS.ORDER_WITH_PAYER,
      RELATED_PAYERS_ORGANIZATION_PERMISSIONS.VIEW_PAID_ORDERS,
      RELATED_PAYERS_ORGANIZATION_PERMISSIONS.MANAGE,
      RELATED_PAYERS_ORGANIZATION_PERMISSIONS.APPROVE,
    ]);
    for (const permission of manifest.organizationPermissions ?? []) {
      expect(permission.memberDefault, permission.code).toBe(false);
    }
  });

  it('binds the modules it resolves and nothing it only degrades without', () => {
    expect([...(manifest.dependencies ?? [])].sort()).toEqual([
      'addresses',
      'customer_accounts',
      'orders',
      'organizations',
      'settings',
      'transactional_emails',
    ]);
  });

  it('labels every code, setting and organization permission in English and Polish (FR-101)', () => {
    const keys = [
      ...(manifest.permissions ?? []).map((p) => `adminRoles.permission.${p.code}`),
      'module.name',
      ...(manifest.organizationPermissions ?? []).flatMap((p) => [
        `organizationPermissions.${p.code}.label`,
        `organizationPermissions.${p.code}.description`,
      ]),
      ...settings.flatMap((s) => [
        `settingLabels.${s.code}.name`,
        `settingLabels.${s.code}.description`,
      ]),
      ...(manifest.errorCodes ?? []).map((e) => `errors.${e.code}`),
    ];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((pl as Record<string, string>)[key], `pl ${key}`).toBeTruthy();
    }
    expect(manifest.errorCodes?.map((e) => e.code)).toEqual([
      'RELATED_PAYER_LINK_EXISTS',
      'RELATED_PAYER_INVALID_PAIR',
      'RELATED_PAYER_NOT_USABLE',
      'RELATED_PAYER_REQUEST_LIMIT',
      'RELATED_PAYER_REQUEST_DECIDED',
    ]);
  });
});
