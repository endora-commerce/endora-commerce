import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  composeTestServer,
  teardownTestServer,
  type TestServerHandle,
} from '@endora-commerce/test-kit/server';

import { fixtureComposition } from './fixture-platform.js';

/**
 * A server the kit composed registers the sub-kernel names it composed the
 * sub-kernels **for**.
 *
 * ## Why this is a defect and not a preference
 *
 * `composeTestServer` composes the sales-channel kernel itself — it has to, the
 * subscriber ordering depends on it happening above `composeModules` — and then
 * registered none of the four names `compose-app.ts` registers out of that same
 * object. So the kernel existed and nothing could resolve it: `inventory`'s
 * channel-scoped stock read, `payment_methods`' and `delivery_methods`'
 * auto-bind, and every module that declares a channel bridge each fail with
 * `AwilixResolutionError` on their first call, in a composition that booted
 * cleanly.
 *
 * It did not show up in this repository because the reference harness registers
 * all four itself, under a comment reading *"mirrors `compose-app.ts`"* — which
 * is precisely the shape that hides a kit defect: the one caller that would have
 * noticed had already worked around it. It showed up **outside** this
 * repository, in a host that booted the published platform through the kit and
 * discovered the missing names one failed boot at a time. That host's
 * `boot.test.ts` names feature 109 as the owner.
 *
 * The assertion is therefore about the **container**, not about a route: a route
 * that happens not to touch the sales-channel resolver passes either way, and
 * the whole failure is that a name eleven modules resolve is absent from a
 * container that booted.
 */

let handle: TestServerHandle;

beforeAll(async () => {
  handle = await composeTestServer({ composition: fixtureComposition() });
});

afterAll(async () => {
  if (handle) await teardownTestServer(handle);
});

/**
 * The four names, and the one member of the composed kernel each is.
 *
 * Written as a pair rather than as a list of names so the test fails when a
 * registration resolves to the *wrong* member — which a name-only assertion
 * cannot see, and which is the more likely mistake of the two.
 */
const SUB_KERNEL_REGISTRATIONS: ReadonlyArray<
  readonly [name: string, member: (handle: TestServerHandle) => unknown]
> = [
  ['salesChannelsCache', (h) => h.salesChannels.cache],
  ['salesChannelBridgeRegistry', (h) => h.salesChannels.bridgeRegistry],
  ['salesChannelMembershipPort', (h) => h.salesChannels.membershipService],
  ['salesChannelResolutionPort', (h) => h.salesChannels.resolver],
];

describe('the sales-channel kernel the kit composed is resolvable from the container', () => {
  for (const [name, member] of SUB_KERNEL_REGISTRATIONS) {
    it(`registers '${name}', and registers the kernel member it names`, () => {
      const resolved: unknown = handle.container.resolve(name);
      expect(resolved).toBeDefined();
      expect(resolved).toBe(member(handle));
    });
  }

  it('registers the out-of-request channel a channel-scoped settings read resolves against', async () => {
    // Proved by **delegation** rather than by value, and the reason is the
    // fixture rather than the seam: this composition's ORM declares one entity
    // and `SalesChannel` is not it, so `getSystemDefault()` cannot answer here at
    // all. What is still decidable — and is the whole of what the registration
    // gets wrong when it is wrong — is *which resolver the closure reaches*: a
    // registration built over a second, separately-composed kernel would fail
    // differently from the one on the handle. So both are called and their
    // refusals compared.
    //
    // D-48 is why there is no third case: the resolver cannot fail to find a
    // default, so on a composition that has the entity this answers an id and
    // never "none". The `string | null` in the signature is the seam admitting a
    // caller's own resolver, not this one admitting an absence.
    const resolver = handle.container.resolve('settingsChannelResolver') as () => Promise<
      string | null
    >;
    const throughTheRegistration = await resolver().then(
      () => null,
      (error: unknown) => (error as Error).message,
    );
    const throughTheHandle = await handle.salesChannels.resolver.getSystemDefault().then(
      () => null,
      (error: unknown) => (error as Error).message,
    );
    expect(throughTheRegistration).toBe(throughTheHandle);
    expect(typeof throughTheRegistration).toBe('string');
  });
});
