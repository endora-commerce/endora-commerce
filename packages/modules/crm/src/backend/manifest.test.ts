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

  it('declares only the permission a route enforces today, grouped under the module', () => {
    expect(manifest.permissions).toEqual([
      {
        code: 'crm:read',
        label: 'View sales opportunities',
        module: 'crm',
        requires: ['orders:read'],
      },
    ]);
  });
});
