import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  BusinessIdGenerator,
  type BusinessIdSettingsResolver,
} from '../../../../packages/modules/orders/src/backend/services/business-id-generator.js';

// The generator never touches the DB in these tests — the sequence draw is
// injected. A bare object stands in for the tx EntityManager (unused by the
// stub draw).
const fakeTx = {} as EntityManager;

function seqStub(value: string): (tx: EntityManager) => Promise<string> {
  return async () => value;
}

describe('BusinessIdGenerator', () => {
  it('composes prefix + sequence + suffix', async () => {
    const settings: BusinessIdSettingsResolver = {
      resolvePrefix: async () => 'ORD-',
      resolveSuffix: async () => '-2026',
    };
    const gen = new BusinessIdGenerator(seqStub('1042'), settings);
    expect(await gen.generate(fakeTx, 'channel-1')).toBe('ORD-1042-2026');
  });

  it('returns the bare sequence when no resolver is wired', async () => {
    const gen = new BusinessIdGenerator(seqStub('7'));
    expect(await gen.generate(fakeTx, 'channel-1')).toBe('7');
  });

  it('treats empty-default prefix/suffix as no affix', async () => {
    const settings: BusinessIdSettingsResolver = {
      resolvePrefix: async () => '',
      resolveSuffix: async () => '',
    };
    const gen = new BusinessIdGenerator(seqStub('55'), settings);
    expect(await gen.generate(fakeTx, 'channel-1')).toBe('55');
  });

  it('swallows a resolver error (missing/out-of-scope setting) as empty', async () => {
    const settings: BusinessIdSettingsResolver = {
      resolvePrefix: async () => {
        throw new Error('SettingNotRegistered');
      },
      resolveSuffix: async () => '-X',
    };
    const gen = new BusinessIdGenerator(seqStub('9'), settings);
    expect(await gen.generate(fakeTx, 'channel-1')).toBe('9-X');
  });

  it('is monotonic — successive draws compose distinct ids', async () => {
    let n = 0;
    const gen = new BusinessIdGenerator(async () => String(++n));
    expect(await gen.generate(fakeTx, 'c')).toBe('1');
    expect(await gen.generate(fakeTx, 'c')).toBe('2');
  });
});
