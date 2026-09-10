import { describe, expect, it } from 'vitest';
import type { CustomerAccountReadPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { createChannelLanguageResolver, createCustomerEmailResolver } from './notification-context.js';

/**
 * `specs/110-instance-repository/` T118c — the two notification answers this
 * module took over from `returnsBridge`.
 *
 * Both were closures a composition root wrote, once each in `composition.ts` and
 * in `test/helpers/test-server.ts`, and both had a fallback: `null` for an
 * address that does not resolve and `en-US` for a channel that does not. A
 * fallback is the shape that fails quietly — an English e-mail to a Polish
 * channel is a plausible answer rather than a visible one — so the mapping and
 * its two fallbacks are the whole of what these three cases assert.
 *
 * **It composes nothing, deliberately.** A module package's test may not name
 * `@endora-commerce/platform/composition`: `check:platform-surface` cannot refuse
 * it here, because `collectPlatformSurfaceSources` drops `.test.ts`, so its
 * silence is a blind spot and not a permission. Making both resolvers functions
 * of what they read removes the need rather than working around the check — the
 * shape `cms`' `asset-embed-resolver.test.ts` established for the first target of
 * this sweep.
 *
 * **What this file cannot see** is that `backend/index.ts` wires either of them,
 * which is the half a drain's defect lives in. That is
 * `backend/test/integration/returns/notification-language.test.ts` for the
 * language and `backend/test/integration/returns/notifications.test.ts` for the
 * address, both over the composed harness.
 */

const ACCOUNT = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'buyer@example.com',
} as unknown as Awaited<ReturnType<CustomerAccountReadPort['findById']>>;

describe('T118c — the returns notification context', () => {
  describe('the recipient address', () => {
    it('answers the account’s e-mail', async () => {
      const resolve = createCustomerEmailResolver({ findById: async () => ACCOUNT });

      expect(await resolve('22222222-2222-4222-8222-222222222222')).toBe('buyer@example.com');
    });

    it('answers null for an account that does not resolve', async () => {
      // `null` rather than a throw: the notifier reports `no_recipient` and the
      // workflow transition it announces stays applied.
      const resolve = createCustomerEmailResolver({ findById: async () => null });

      expect(await resolve('22222222-2222-4222-8222-222222222222')).toBeNull();
    });

    it('lets a ModuleDisabledError travel rather than reading it as “no address”', async () => {
      // Composition checklist item 7, and the reason there is no `catch` in the
      // resolver. `customer_accounts` declares `nonDeactivatable`, so this cannot
      // happen on a running platform — which is why the assertion is here rather
      // than nowhere: the day that manifest changes, swallowing the refusal turns
      // a switched-off identity module into "this buyer has no e-mail address".
      const resolve = createCustomerEmailResolver({
        findById: async () => {
          throw new ModuleDisabledError('customer_accounts');
        },
      });

      await expect(resolve('22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(
        ModuleDisabledError,
      );
    });
  });

  describe('the channel language', () => {
    it('answers the channel’s default language', async () => {
      const resolve = createChannelLanguageResolver(
        () => ({ findOne: async () => ({ defaultLanguage: 'pl-PL' }) }) as never,
      );

      expect(await resolve('33333333-3333-4333-8333-333333333333')).toBe('pl-PL');
    });

    it('falls back to en-US for a channel that is not there', async () => {
      const resolve = createChannelLanguageResolver(
        () => ({ findOne: async () => null }) as never,
      );

      expect(await resolve('33333333-3333-4333-8333-333333333333')).toBe('en-US');
    });

    it('queries the channel by the id it was given', async () => {
      // The fallback above is what makes a wrong query invisible: a resolver
      // reading the wrong id answers `en-US` and looks like a shop with no
      // translations. This is the case that tells the two apart.
      const seen: unknown[] = [];
      const resolve = createChannelLanguageResolver(
        () =>
          ({
            findOne: async (_entity: unknown, where: unknown) => {
              seen.push(where);
              return { defaultLanguage: 'de-DE' };
            },
          }) as never,
      );

      await resolve('33333333-3333-4333-8333-333333333333');

      expect(seen).toEqual([{ id: '33333333-3333-4333-8333-333333333333' }]);
    });
  });
});
