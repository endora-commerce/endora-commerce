import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Feature 154, US4 (T053) — a business registered on a storefront gets exactly
 * the channel of the store it registered on (owner decision D6,
 * `contracts/storefront-api.md` §5), bound in the creating step so no
 * Organization exists without a channel. Business registration is open to the
 * access step, so this holds on a store closed to anonymous visitors too: there
 * it is how a business applies for an account. An invitation joins an existing
 * Organization and changes nothing about its channels.
 */

const OPEN = 'rc-open';
const CLOSED = 'rc-closed';

let seq = 0;
function registration(): Record<string, unknown> {
  seq += 1;
  const stamp = `${Date.now()}${seq}`.slice(-10);
  return {
    organization: {
      name: `Registration channel ${stamp}`,
      taxId: `PL${stamp}`,
      registeredAddress: {
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    },
    firstUser: {
      email: `rc-${stamp}@example.test`,
      password: 'a-very-strong-password-123!',
      firstName: 'Anna',
      lastName: 'Nowak',
    },
    acceptedTermsVersion: '1.0.0',
  };
}

describe('business registration — the registering store becomes the channel (T053)', () => {
  let h: BackendServerHandle;

  async function channelCodesOf(organizationId: string): Promise<string[]> {
    const channels = await h.salesChannels.membershipService.listChannelsForEntity(
      'organization',
      organizationId,
    );
    return channels.map((c) => c.code).sort();
  }

  async function register(channel: string | null): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      headers: channel === null ? {} : { 'x-sales-channel': channel },
      payload: registration(),
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { organization?: { id: string }; organizationId?: string } };
    const id = body.data.organization?.id ?? body.data.organizationId;
    expect(id).toEqual(expect.any(String));
    return id!;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [code, anonymousAccess] of [
      [OPEN, true],
      [CLOSED, false],
    ] as const) {
      em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        anonymousAccess,
      });
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('assigns exactly the channel the business registered on', async () => {
    const id = await register(OPEN);
    expect(await channelCodesOf(id)).toEqual([OPEN]);
  });

  it('assigns the channel on a store closed to anonymous visitors too', async () => {
    const id = await register(CLOSED);
    expect(await channelCodesOf(id)).toEqual([CLOSED]);
  });

  it('assigns exactly the default channel when no channel is named', async () => {
    const id = await register(null);
    expect(await channelCodesOf(id)).toEqual(['default']);
  });

  it('leaves the Organization’s channels alone when an invitation is accepted on another store', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: `rc-invited-${Date.now()}@example.test` },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    const probe = await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-invitation-token' });
    const { token } = probe.json() as { token: string };

    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${token}/accept`,
      headers: { 'x-sales-channel': OPEN },
      payload: { password: 'invited-strong-password-12!', firstName: 'Inv', lastName: 'Itee' },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    expect(await channelCodesOf(TEST_ORGANIZATION_ID)).toEqual(['default']);
  });
});
