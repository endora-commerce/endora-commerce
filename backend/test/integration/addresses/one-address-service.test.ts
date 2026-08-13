import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AddressService } from '../../../src/modules/addresses/services/address-service.js';

/**
 * Feature 072 wave 1 (T090) — one `AddressService`, where there were three.
 *
 * `AddressService` takes its dictionary validator and its audit writer as
 * **optional** constructor arguments, and three places built one:
 *
 *   - `composition.ts` / the harness — validator + audit, handed to `orders`
 *   - `organizations/plugin.ts`      — validator + audit, built for itself
 *   - `orders/plugin.ts`             — `options.addressService ?? new
 *                                       AddressService(options.emFactory)`
 *
 * The third is the interesting one. Both roots do pass `addressService` today,
 * so the fallback is dead — but it is a **loaded** dead branch, not an inert
 * one: anything that constructs `commerceModule` without that option gets an
 * address service that silently validates no country or region code and writes
 * no audit entry, on the checkout path. `currencies` shipped the same shape and
 * it was not dead there; the difference between the two is one caller, which is
 * not a difference worth relying on.
 *
 * Two assertions, deliberately of different kinds. The first is behavioural:
 * the instance the container hands out is fully armed, so an invalid country
 * code is refused rather than stored. The second is structural: nothing outside
 * the module constructs the service at all, so there is no second instance to
 * drift from the first. The structural one is what actually holds the property
 * over time — a behavioural test can only ever check the instance it was handed.
 *
 * The structural scan is textual, so it matches the constructor call in a
 * comment too. That is deliberate rather than tolerated: a comment showing the
 * unsafe construction reads as a suggestion, and this file is the one place
 * that would catch it being copied back out.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../../src');

/** Source files that may name the constructor: the module that owns it. */
const OWNER_PREFIX = 'modules/addresses/';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('addresses — one service [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('hands out a validator-armed service, so a bad country code is refused', async () => {
    const service = (h.container.cradle as unknown as { addressService: AddressService })
      .addressService;
    expect(service).toBeInstanceOf(AddressService);

    const orgs = await h.em().execute<Array<{ id: string }>>(
      'select id from organizations limit 1',
    );
    const organizationId = orgs[0]?.id;
    expect(organizationId).toBeDefined();

    // An unarmed service accepts this and stores a dangling reference; the
    // armed one rejects it. That difference is the whole point of the
    // consolidation.
    await expect(
      service.createAddress(organizationId!, {
        kind: 'delivery',
        recipientName: 'Probe',
        street: 'Probe 1',
        city: 'Probe',
        postalCode: '00-001',
        country: 'ZZ',
      }),
    ).rejects.toThrow();
  });

  it('is constructed nowhere outside the module that owns it', () => {
    const offenders = walk(srcRoot)
      .filter((file) => readFileSync(file, 'utf8').includes('new AddressService('))
      .map((file) => relative(srcRoot, file))
      .filter((rel) => !rel.startsWith(OWNER_PREFIX))
      .sort();

    expect(
      offenders,
      'a module outside `addresses` constructs its own AddressService — resolve ' +
        '`addressService` from the container instead, or the optional validator ' +
        'and audit writer silently differ between instances',
    ).toEqual([]);
  });
});
