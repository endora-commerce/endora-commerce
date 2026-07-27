import { describe, expect, it, vi } from 'vitest';
import type { ConfigurationTypeDescriptor } from '@b2b/contracts';
import {
  ConfigurationTypeRegistry,
  ConfigurationTypeUnknown,
} from '../../../src/modules/credentials/services/configuration-type-registry.js';

/**
 * Feature 058 US3 (T047) — the configuration-type registry as the single
 * extension seam: register / resolve / isRegistered / duplicate-warn /
 * inert-for-unknown.
 */
function descriptor(code: string): ConfigurationTypeDescriptor {
  return {
    code,
    label: code.toUpperCase(),
    ownerModule: 'test',
    providers: [
      {
        code: 'default',
        label: 'Default',
        fields: [{ key: 'token', label: 'Token', kind: 'string', required: true, secret: true }],
      },
    ],
  };
}

describe('ConfigurationTypeRegistry [unit]', () => {
  it('registers and looks up a descriptor', () => {
    const registry = new ConfigurationTypeRegistry();
    expect(registry.isRegistered('foo')).toBe(false);
    registry.register(descriptor('foo'));
    expect(registry.isRegistered('foo')).toBe(true);
    expect(registry.get('foo')?.label).toBe('FOO');
    expect(registry.resolve('foo').code).toBe('foo');
    expect(registry.list().map((d) => d.code)).toEqual(['foo']);
    expect(registry.describe().map((d) => d.code)).toEqual(['foo']);
  });

  it('resolve throws ConfigurationTypeUnknown for an unregistered code', () => {
    const registry = new ConfigurationTypeRegistry();
    expect(() => registry.resolve('ghost')).toThrow(ConfigurationTypeUnknown);
    expect(registry.get('ghost')).toBeUndefined();
    expect(registry.isRegistered('ghost')).toBe(false);
  });

  it('warns and overwrites on a duplicate code (last-writer-wins)', () => {
    const warn = vi.fn();
    const registry = new ConfigurationTypeRegistry({ warn });
    registry.register(descriptor('dup'));
    const second: ConfigurationTypeDescriptor = { ...descriptor('dup'), label: 'SECOND' };
    registry.register(second);
    expect(warn).toHaveBeenCalledOnce();
    expect(registry.get('dup')?.label).toBe('SECOND');
    expect(registry.list()).toHaveLength(1);
  });

  it('unregister removes a descriptor and restores the not-registered state', () => {
    const registry = new ConfigurationTypeRegistry();
    registry.register(descriptor('temp'));
    expect(registry.isRegistered('temp')).toBe(true);
    registry.unregister('temp');
    expect(registry.isRegistered('temp')).toBe(false);
    expect(registry.get('temp')).toBeUndefined();
  });
});
