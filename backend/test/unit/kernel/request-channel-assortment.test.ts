import { describe, expect, it } from 'vitest';
import { createRootContainer } from '../../../src/kernel/container.js';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import type { CachedChannel } from '../../../src/kernel/sales-channels/sales-channels-cache.js';
import {
  outOfRequestChannel,
  productIdsInRequestChannel,
} from '../../../src/kernel/sales-channels/request-channel-assortment.js';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { systemTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';

/**
 * Issue #259 — the assortment gate the acquisition seams share.
 *
 * The behaviour worth pinning here is the one that is easiest to get wrong in
 * the direction nobody notices: what happens when there is **no** request
 * channel. An empty set would refuse every acquisition outside HTTP — a CLI
 * seed, a worker, a fixture calling a service directly — and the system-default
 * channel would be the fabrication D-47…D-51 drained under four spellings.
 * `null` is neither, and the return type is what stops a caller reading it as
 * the empty set.
 *
 * The channel is read off the scope and never resolved here, so every case
 * asserts the argument the bridge accessor was called with as well as the
 * answer: a gate that asked about some other channel would return the right
 * shape from the wrong question.
 */

const CHANNEL: CachedChannel = {
  id: 'channel-1',
  code: 'probe',
  name: { 'en-US': 'Probe' },
  active: true,
  isPublic: true,
  systemDefault: false,
  defaultLanguage: 'en-US',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  languages: ['en-US'],
  currencies: ['PLN'],
  version: 1,
};

interface Recorded {
  readonly port: SalesChannelMembershipPort;
  readonly calls: Array<{ channelId: string; entityType: string; entityIds: readonly string[] }>;
}

/**
 * A membership port that answers `filterEntityIdsInChannel` and **throws** on
 * every other method, so a gate that reached for `listChannelsForEntity` or
 * wrote a membership would fail loudly rather than quietly work.
 */
function membershipPublishing(published: readonly string[]): Recorded {
  const calls: Recorded['calls'] = [];
  const port = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'filterEntityIdsInChannel') {
          return async (
            channelId: string,
            entityType: string,
            entityIds: readonly string[],
          ): Promise<string[]> => {
            calls.push({ channelId, entityType, entityIds });
            return entityIds.filter((id) => published.includes(id));
          };
        }
        return () => {
          throw new Error(`the assortment gate reached for ${String(property)}`);
        };
      },
    },
  ) as SalesChannelMembershipPort;
  return { port, calls };
}

/** Run `body` as if inside a request that resolved {@link CHANNEL}. */
async function inRequestOn<T>(channel: CachedChannel, body: () => Promise<T>): Promise<T> {
  return enterPlatformScope(systemTenantContext('assortment gate unit test'), body, {
    container: createRootContainer(),
    channel,
  });
}

describe('productIdsInRequestChannel', () => {
  it('narrows to what the request channel publishes, through the bridge accessor', async () => {
    const { port, calls } = membershipPublishing(['a']);

    const answer = await inRequestOn(CHANNEL, () => productIdsInRequestChannel(port, ['a', 'b']));

    expect(answer).not.toBeNull();
    expect([...answer!]).toEqual(['a']);
    expect(calls).toEqual([
      { channelId: 'channel-1', entityType: 'product', entityIds: ['a', 'b'] },
    ]);
  });

  it('answers null, and asks nothing, when there is no request channel', async () => {
    const { port, calls } = membershipPublishing([]);

    // No scope at all — a CLI script, a worker, a fixture. `null` is the answer
    // and the empty `calls` is the proof that no channel was invented to ask
    // about.
    expect(await productIdsInRequestChannel(port, ['a'])).toBeNull();
    expect(calls).toEqual([]);
  });

  it('answers null inside a scope whose channel slot was never filled', async () => {
    // A worker opens a platform scope but resolves no channel. That is the same
    // "no channel" as having no scope, and it must not read as an empty
    // assortment.
    const { port, calls } = membershipPublishing([]);

    const answer = await enterPlatformScope(
      systemTenantContext('assortment gate unit test'),
      () => productIdsInRequestChannel(port, ['a']),
      { container: createRootContainer(), entryPoint: 'worker' },
    );

    expect(answer).toBeNull();
    expect(calls).toEqual([]);
  });

  it('does not ask the bridge about an empty id list', async () => {
    const { port, calls } = membershipPublishing(['a']);

    const answer = await inRequestOn(CHANNEL, () => productIdsInRequestChannel(port, []));

    expect(answer).not.toBeNull();
    expect([...answer!]).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('de-duplicates the ids it asks about', async () => {
    const { port, calls } = membershipPublishing(['a']);

    await inRequestOn(CHANNEL, () => productIdsInRequestChannel(port, ['a', 'a', 'b']));

    expect(calls[0]?.entityIds).toEqual(['a', 'b']);
  });
});

describe('outOfRequestChannel', () => {
  it('is true for a product the request channel does not publish', async () => {
    const { port } = membershipPublishing(['a']);
    expect(await inRequestOn(CHANNEL, () => outOfRequestChannel(port, 'b'))).toBe(true);
  });

  it('is false for a product the same channel does publish', async () => {
    const { port } = membershipPublishing(['a']);
    expect(await inRequestOn(CHANNEL, () => outOfRequestChannel(port, 'a'))).toBe(false);
  });

  it('is false outside a request — there is no channel to be out of', async () => {
    const { port, calls } = membershipPublishing([]);
    expect(await outOfRequestChannel(port, 'a')).toBe(false);
    expect(calls).toEqual([]);
  });
});
