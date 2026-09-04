import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { DeliveryConfigService } from '../services/delivery/delivery-config.service.js';
import { ProductFeed } from './product-feed.entity.js';

/**
 * Removing a delivery configuration discloses that its credential was left
 * behind (the promise half of issue #84).
 *
 * The cleanup is a genuine compensating action — the configuration row is
 * already committed by the Command above it, and a credential that is already
 * gone is the state the operator asked for. AGENTS.md' composition checklist
 * item 7 names exactly this case and gives it exactly one shape: keep the
 * tolerance, and make `rethrowIfModuleDisabled(error)` its first line. A
 * swallowed presence answer here leaves a decrypted-on-demand secret in the
 * store for a configuration that no longer exists, and reports success.
 *
 * The port is driven to **reject** for the reason stated in `search`'s twin
 * file: `lazyPort`'s forwarding function is synchronous, so this module's raw
 * proxy escapes the `.catch` on its own call, and the identical source text
 * swallows the answer the moment the port arrives through anything `async`.
 */
describe('DeliveryConfigService.remove', () => {
  const service = (deleteCredential: () => Promise<void>) =>
    new DeliveryConfigService({
      emFactory: () =>
        ({
          findOne: (entity: unknown) =>
            Promise.resolve(entity === ProductFeed ? ({ id: 'feed-1' } as never) : null),
        }) as unknown as EntityManager,
      commandBus: {
        run: () => Promise.resolve({ credentialCode: 'feed-delivery-feed-1' }),
      } as never,
      credentials: { delete: deleteCredential } as never,
    });

  it('lets a ModuleDisabledError through instead of reporting a clean removal', async () => {
    await expect(
      service(() => Promise.reject(new ModuleDisabledError('credentials'))).remove('feed-1'),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still tolerates a credential that is already gone', async () => {
    await expect(
      service(() => Promise.reject(new Error('credential configuration not found'))).remove(
        'feed-1',
      ),
    ).resolves.toBeUndefined();
  });
});
