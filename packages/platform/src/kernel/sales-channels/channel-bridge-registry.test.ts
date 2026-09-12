import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, ChannelMemberEntityTypeSchema } from '@endora-commerce/contracts';
import { ChannelBridgeRegistry } from './channel-bridge-registry.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';
import { HttpError } from '../../http/error-envelope.js';
import { EventBus } from '../../events/bus.js';

/**
 * The contribution registry that replaced the platform's total bridge map
 * (feature 120, FR-015…FR-017; D-226).
 *
 * Two things are asserted here and the second is the one the feature exists
 * for. **A member no module registered refuses, and the refusal happens before
 * anything reaches for an `EntityManager`** — which is what distinguishes this
 * from the state it replaced: the map was total, so an instance that never
 * installed `cms` answered a `cms-page` membership call by executing SQL
 * against a relation that is not there, from inside whatever transaction the
 * caller had already opened.
 *
 * The "no database" half is asserted by *construction* rather than by mocking
 * one: the factory this service is given throws if it is ever called, so a
 * refusal that touched the connection would fail with that sentence instead of
 * with the 503.
 */

const BRIDGE = {
  entityType: 'tax',
  table: 'sales_channel_taxes',
  entityIdColumn: 'tax_id',
} as const;

/** An `EntityManager` factory that is a failure if it is ever reached. */
function noDatabase(): () => EntityManager {
  return () => {
    throw new Error('the membership service reached for an EntityManager');
  };
}

describe('ChannelBridgeRegistry', () => {
  it('answers the bridge its owner registered', () => {
    const registry = new ChannelBridgeRegistry();
    registry.register(BRIDGE);
    expect(registry.require('tax')).toEqual(BRIDGE);
    expect(registry.list()).toEqual([BRIDGE]);
  });

  it('refuses a conflicting second registration for one member', () => {
    const registry = new ChannelBridgeRegistry();
    registry.register(BRIDGE);
    expect(() =>
      registry.register({
        entityType: 'tax',
        table: 'sales_channel_tax_rates',
        entityIdColumn: 'tax_id',
      }),
    ).toThrow(/two modules claim one member/);
    // …and the first registration is the one that stands. A silent overwrite
    // would make the table a membership write lands in a function of module
    // composition order.
    expect(registry.require('tax')).toEqual(BRIDGE);
  });

  it('takes an identical re-registration as the no-op it is', () => {
    // A registration is a statement about the schema, not a capability
    // instance, so repeating it changes nothing. It has to be a no-op rather
    // than a refusal because a process legitimately composes more than once —
    // the test harness builds a platform per file, and the bare-database
    // harness declares the same bridges beside it.
    const registry = new ChannelBridgeRegistry();
    registry.register(BRIDGE);
    registry.register({ ...BRIDGE });
    expect(registry.list()).toHaveLength(1);
  });

  it('starts empty, so a process that composed nothing claims nothing', () => {
    expect(new ChannelBridgeRegistry().list()).toEqual([]);
  });
});

describe('the membership service over an unregistered member (FR-017)', () => {
  const registry = new ChannelBridgeRegistry();
  registry.register(BRIDGE);
  const service = new SalesChannelMembershipService(
    noDatabase(),
    new EventBus(),
    undefined,
    registry,
  );

  /**
   * Every public method that takes an entity type, because the refusal is worth
   * nothing if one of them still reaches the database: eight sites read the
   * bridge and each is a separate `require`. The list is written out rather
   * than derived — a `Reflect.ownKeys` sweep of the prototype would have to
   * invent an argument list per method — so adding a ninth method means adding
   * a row here, which is what the count assertion below is for.
   */
  const calls: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ['addToChannel', () => service.addToChannel('c', 'cms-page', 'e')],
    ['removeFromChannel', () => service.removeFromChannel('c', 'cms-page', 'e')],
    ['bindToDefaultIfEmpty', () => service.bindToDefaultIfEmpty('cms-page', 'e')],
    ['copyMemberships', () => service.copyMemberships('cms-page', 'a', 'b')],
    ['replaceChannelsForEntity', () => service.replaceChannelsForEntity('cms-page', 'e', ['c'])],
    ['filterEntityIdsInChannel', () => service.filterEntityIdsInChannel('c', 'cms-page', ['e'])],
    ['listChannelsForEntity', () => service.listChannelsForEntity('cms-page', 'e')],
    ['listEntityIdsForChannel', () => service.listEntityIdsForChannel('c', 'cms-page')],
  ];

  it.each(calls)('%s refuses and reaches no database', async (_name, call) => {
    const error = await call().then(
      () => null,
      (raised: unknown) => raised,
    );
    expect(error, 'the call resolved instead of refusing').toBeInstanceOf(HttpError);
    const refusal = error as HttpError;
    expect(refusal.code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(refusal.statusCode).toBe(503);
    // Naming the capability, which is the only thing the platform honestly
    // knows: no module registered this member, so there is no module to name.
    expect(refusal.message).toContain('cms-page');
    expect(refusal.details).toEqual([{ path: 'entityType', issue: 'cms-page' }]);
  });

  it('covers every site in the service that resolves a bridge', () => {
    // The floor under the table above, and the reason it is a *derivation*: a
    // refusal that is right in eight places and absent in the ninth is the
    // shape this feature deletes, so the count comes off the service's own
    // source rather than out of this file. A method added without a row here
    // reds, and a row left behind after a method goes reds too.
    const source = readFileSync(
      fileURLToPath(new URL('./sales-channel-membership.service.ts', import.meta.url)),
      'utf8',
    );
    const sites = source.match(/this\.bridges\.require\(/g) ?? [];
    expect(sites, 'the bridge read moved and this floor is measuring nothing').not.toHaveLength(0);
    expect(calls).toHaveLength(sites.length);
  });

  it('serves the member that is registered, from the same service', async () => {
    // The discrimination: the refusals above are about the *member*, not about
    // a service that refuses everything. This one gets past the registry and
    // fails on the factory, which is as far as a test with no database goes.
    await expect(service.addToChannel('c', 'tax', 'e')).rejects.toThrow(
      /reached for an EntityManager/,
    );
  });

  it('covers every member of the published vocabulary in one state or the other', () => {
    // The independent author: `@endora-commerce/contracts`' enum stays the
    // published vocabulary (FR-016) and the registry decides which members are
    // live, which is D-175's vocabulary/grantable split one surface over. A
    // member missing from the enum would make the two halves above untypeable.
    expect(ChannelMemberEntityTypeSchema.options).toContain('tax');
    expect(ChannelMemberEntityTypeSchema.options).toContain('cms-page');
  });
});
