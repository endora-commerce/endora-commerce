import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

describe('crm manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('crm');
    expect(manifest.activation).toEqual({ settingCode: 'crm.enabled', default: true });
  });

  it('declares its activation control as a boolean setting of its own group', () => {
    const control = manifest.settings?.settings.find((s) => s.code === 'crm.enabled');
    expect(control).toMatchObject({ groupCode: 'crm', valueType: 'boolean', defaultValue: true });
  });

  it('declares the two automatic-creation settings, both off by default', () => {
    const codes = ['crm.auto_create_from_orders', 'crm.auto_create_from_quote_requests'];
    for (const code of codes) {
      const setting = manifest.settings?.settings.find((s) => s.code === code);
      expect(setting, code).toMatchObject({ groupCode: 'crm', valueType: 'boolean', defaultValue: false });
    }
  });

  it('declares the four permissions a route enforces today, grouped under the module', () => {
    expect(manifest.permissions).toEqual([
      { code: 'crm:read', label: 'View sales opportunities', module: 'crm', requires: ['orders:read', 'custom_fields:read'] },
      { code: 'crm:write', label: 'Create and work sales opportunities', module: 'crm', requires: ['crm:read'] },
      { code: 'crm:configure', label: 'Configure the CRM workflow and tags', module: 'crm', requires: ['crm:read'] },
      { code: 'crm:analytics', label: 'View CRM analytics', module: 'crm', requires: ['crm:read'] },
    ]);
  });

  it('declares every error code it raises, each once', () => {
    const codes = (manifest.errorCodes ?? []).map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining([
        'CRM_OPPORTUNITY_NOT_FOUND',
        'CRM_INVALID_TRANSITION',
        'CRM_TRANSITION_VETOED',
        'CRM_TRANSITION_CONFLICT',
        'CRM_DOCUMENT_NOT_FOUND',
        'CRM_DOCUMENT_ALREADY_LINKED',
        'CRM_LINK_ORGANIZATION_MISMATCH',
        'CRM_STATUS_CODE_TAKEN',
        'CRM_STATUS_IN_USE',
        'CRM_STATUS_INITIAL_REQUIRED',
        'CRM_WORKFLOW_INVALID',
      ]),
    );
    expect(codes.every((code) => code.startsWith('CRM_'))).toBe(true);
  });
});
