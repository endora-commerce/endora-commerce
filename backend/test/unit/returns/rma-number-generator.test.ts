import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { RmaNumberGenerator } from '../../../src/modules/returns/services/rma-number-generator.js';

const fakeEm = {} as EntityManager;

describe('RmaNumberGenerator', () => {
  it('composes prefix + sequence + suffix', async () => {
    let n = 1000;
    const gen = new RmaNumberGenerator(
      async () => String(++n),
      {
        resolvePrefix: async () => 'RMA-',
        resolveSuffix: async () => '/2026',
      },
    );
    expect(await gen.generate(fakeEm, 'sc')).toBe('RMA-1001/2026');
    expect(await gen.generate(fakeEm, 'sc')).toBe('RMA-1002/2026');
  });

  it('treats a missing resolver as empty prefix/suffix', async () => {
    const gen = new RmaNumberGenerator(async () => '7');
    expect(await gen.generate(fakeEm, 'sc')).toBe('7');
  });

  it('swallows a resolver failure as an empty string (never blocks authorization)', async () => {
    const gen = new RmaNumberGenerator(async () => '42', {
      resolvePrefix: async () => {
        throw new Error('settings down');
      },
      resolveSuffix: async () => '!',
    });
    expect(await gen.generate(fakeEm, 'sc')).toBe('42!');
  });

  it('produces unique, monotonic numbers', async () => {
    let seq = 0;
    const gen = new RmaNumberGenerator(async () => String(++seq), {
      resolvePrefix: async () => 'R',
      resolveSuffix: async () => '',
    });
    const a = await gen.generate(fakeEm, 'sc');
    const b = await gen.generate(fakeEm, 'sc');
    expect(a).not.toBe(b);
    expect(a).toBe('R1');
    expect(b).toBe('R2');
  });
});
