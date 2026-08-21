import { afterEach, describe, expect, it } from 'vitest';
import type { CmsSeededBlock } from '@b2b/contracts';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  COOKIE_CONSENT_BLOCK_CODE,
  ensureCookieConsentBlock,
} from '../../../src/modules/google_analytics/services/cookie-consent-block-seeder.js';

/**
 * Feature 075 / D-87 — the twin of `test/unit/newsletter/consent-block-seeder.test.ts`.
 *
 * `google_analytics` ships the cookie-banner message as a CMS block and used to
 * insert it with raw SQL naming `cms`' two tables. It asks `cms` now, through
 * `cmsBlockSeedPort`, and the seed runs at route registration — before the
 * first request, where a closed gate has nothing to throw to. Presence is
 * decided in front of the gate; the port is not reached to produce the answer.
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

describe('google_analytics — the cookie-consent seed decides `cms` presence first', () => {
  it('seeds the block, with its own code and both languages, while `cms` is present', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['google_analytics', 'cms']);

    await expect(ensureCookieConsentBlock(port)).resolves.toBe('seeded');

    expect(port.seen).toHaveLength(1);
    const [block] = port.seen;
    expect(block?.code).toBe(COOKIE_CONSENT_BLOCK_CODE);
    expect(block?.languages).toEqual(['en-US', 'pl-PL']);
    expect(Object.keys(block?.content.languages ?? {})).toEqual(['en-US', 'pl-PL']);
  });

  it('skips the seed without touching the port while `cms` is deactivated', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['google_analytics', 'cms'], { deactivated: ['cms'] });

    await expect(ensureCookieConsentBlock(port)).resolves.toBe('cms-absent');
    expect(port.seen).toEqual([]);
  });

  it('skips the seed without touching the port on a platform without `cms`', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['google_analytics']);

    await expect(ensureCookieConsentBlock(port)).resolves.toBe('cms-absent');
    expect(port.seen).toEqual([]);
  });

  it('seeds again on the first boot after `cms` comes back', async () => {
    const port = recordingPort();
    registryCache.__setEnabledForTesting(['google_analytics', 'cms'], { deactivated: ['cms'] });
    await ensureCookieConsentBlock(port);

    registryCache.__setEnabledForTesting(['google_analytics', 'cms']);

    await expect(ensureCookieConsentBlock(port)).resolves.toBe('seeded');
    expect(port.seen.map((b) => b.code)).toEqual([COOKIE_CONSENT_BLOCK_CODE]);
  });
});
