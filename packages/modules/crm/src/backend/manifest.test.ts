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
});
