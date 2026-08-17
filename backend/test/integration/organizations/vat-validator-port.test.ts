import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { VatValidator } from '@b2b/contracts';
import type { OrganizationsCradle } from '../../../src/modules/organizations/backend.js';

/**
 * Feature 076 (D-86) — `organizations` supplies the VAT validator it owns.
 *
 * `customers` used to build `new ViesClient()` itself, from an import of this
 * module's `integrations/` directory, over a contribution point of its own. Its
 * comment claimed the harness got "the same fake the organizations wiring gets…
 * that coupling is now structural rather than a note" while the mechanism was
 * two roots constructing two objects, free to diverge and answer differently
 * for the same tax id.
 *
 * The assertion below is that claim, made checkable: **one object**, reached
 * from the container by both names. A test that merely called the endpoint and
 * saw a plausible answer would have passed before this change too.
 */
describe('vatValidatorPort — one validator, two consumers (feature 076)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('hands out the very object `organizations` validates with', () => {
    const cradle = h.container.cradle as unknown as OrganizationsCradle & {
      vatValidatorPort: VatValidator;
    };
    expect(cradle.vatValidatorPort).toBe(cradle.organizationsTaxIdClients.vies);
  });

  it('is the composition-contributed adapter, not a second real client', () => {
    const cradle = h.container.cradle as unknown as { vatValidatorPort: VatValidator };
    // The harness contributes a fake precisely so no test opens a socket to
    // VIES. If `customers` were still constructing its own client, this would
    // be `vies` from a `ViesClient` — the same `provider` string, which is why
    // the identity check above is the load-bearing one and this is the reason
    // it matters.
    expect(cradle.vatValidatorPort.provider).toBe('vies');
    expect(cradle.vatValidatorPort.constructor.name).toBe('FakeVatValidator');
  });
});
