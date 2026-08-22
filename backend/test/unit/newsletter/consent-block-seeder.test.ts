import { afterEach, describe, expect, it } from 'vitest';
import type { CmsSeededBlock } from '@endora-commerce/contracts';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  ensureNewsletterConsentBlock,
  NEWSLETTER_CONSENT_BLOCK_CODE,
} from '../../../src/modules/newsletter/services/consent-block-seeder.js';

/**
 * Feature 075 / D-87 — `newsletter` stops writing `cms`' tables and asks `cms`
 * to keep its consent block in place instead (`cmsBlockSeedPort`).
 *
 * The edge is new, so Principle XVII item 6 wants the off state proven, and the
 * off state here is sharper than usual: the seed runs at route registration,
 * before the first request, so a closed gate throws where nothing can answer
 * it. `runBootHooks` and the plugin attach both turn that into a failed start —
 * an operator switching `cms` off would have taken `newsletter` down with it,
 * which is the inversion Constitution XVII forbids.
 *
 * So presence is **decided** in front of the gate, and two things are asserted
 * per case: the answer, and that the port was **not reached** to produce it. A
 * seeder that called the port and mapped its throw would satisfy the first
 * while leaving the presence answer somewhere a `catch` could swallow.
 */

function recordingPort(): { seen: CmsSeededBlock[]; ensureSeededBlock: (b: CmsSeededBlock) => Promise<void> } {
  const seen: CmsSeededBlock[] = [];
  return {
    seen,
    ensureSeededBlock: async (block) => {
      seen.push(block);
    },
  };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('newsletter — the consent block seed decides `cms` presence first', () => {
  it('seeds the block, with its own code and both languages, while `cms` is present', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['newsletter', 'cms']);

    await expect(ensureNewsletterConsentBlock(port)).resolves.toBe('seeded');

    expect(port.seen).toHaveLength(1);
    const [block] = port.seen;
    expect(block?.code).toBe(NEWSLETTER_CONSENT_BLOCK_CODE);
    expect(block?.languages).toEqual(['en-US', 'pl-PL']);
    expect(Object.keys(block?.content.languages ?? {})).toEqual(['en-US', 'pl-PL']);
  });

  it('skips the seed without touching the port while `cms` is deactivated', async () => {
    // The case Principle XVII item 6 names specifically: the platform still
    // ships `cms`, the operator has switched it off. Both axes are combined by
    // `effectiveState`, so this must read exactly like "not installed".
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['newsletter', 'cms'], { deactivated: ['cms'] });

    await expect(ensureNewsletterConsentBlock(port)).resolves.toBe('cms-absent');
    expect(port.seen).toEqual([]);
  });

  it('skips the seed without touching the port on a platform without `cms`', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['newsletter']);

    await expect(ensureNewsletterConsentBlock(port)).resolves.toBe('cms-absent');
    expect(port.seen).toEqual([]);
  });

  it('seeds again on the first boot after `cms` comes back', async () => {
    // Off is reversible and non-destructive: nothing about the skip may leave
    // the seed permanently undone.
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['newsletter', 'cms'], { deactivated: ['cms'] });
    await ensureNewsletterConsentBlock(port);

    registryCache.__setEnabledForTesting(['newsletter', 'cms']);

    await expect(ensureNewsletterConsentBlock(port)).resolves.toBe('seeded');
    expect(port.seen.map((b) => b.code)).toEqual([NEWSLETTER_CONSENT_BLOCK_CODE]);
  });
});
