import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RelatedPayerWritePort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` US8 (FR-030 – FR-032, SC-006) — a deployment's automation
 * links and unlinks payers through `relatedPayerWritePort`.
 *
 * The port is resolved from the composed container by its published name, which is the
 * registration an overlay's `lazyPort(ctx, 'relatedPayerWritePort')` reads on every call —
 * the presence gate is that registration, so a container read exercises it exactly.
 */
describe('relatedPayerWritePort (US8)', () => {
  let h: BackendServerHandle;
  const port = (): RelatedPayerWritePort => h.container.resolve<RelatedPayerWritePort>('relatedPayerWritePort');

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
    }
    throw new Error('expected a refusal');
  }

  async function linkRows(buyer: string) {
    return (await h
      .em()
      .getConnection()
      .execute(`select * from related_payer_links where organization_id = ? order by created_at`, [buyer])) as Array<
      Record<string, unknown>
    >;
  }

  it('adds with scope, window and terms; a repeat is idempotent; revoke; actor automation with source', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const billing = await makeAddress(h.em(), y, 'billing');

    const first = await port().addPayer({
      buyerOrganizationId: x,
      payerOrganizationId: y,
      source: 'erp.sync-1',
      addressScope: { kind: 'one', billingAddressId: billing },
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      commercialTerms: 'payer',
    });
    expect(first.created).toBe(true);
    const again = await port().addPayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp.sync-1' });
    expect(again).toEqual({ linkId: first.linkId, created: false });

    const [row] = await linkRows(x);
    expect(row).toMatchObject({
      id: first.linkId,
      origin: 'automation',
      origin_source: 'erp.sync-1',
      address_scope: 'one',
      billing_address_id: billing,
      commercial_terms: 'payer',
      state: 'active',
    });

    const [entry] = await h.em().fork().find(AuditLogEntry, { action: 'related_payers.link.create', objectId: first.linkId });
    expect(entry?.actorAdminUserId ?? null).toBeNull();
    expect(entry?.stateAfter).toMatchObject({ actorKind: 'automation', source: 'erp.sync-1' });

    expect(await port().revokePayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp.sync-1' })).toEqual({
      revoked: true,
    });
    expect(await port().revokePayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp.sync-1' })).toEqual({
      revoked: false,
    });
    const [revoked] = await h
      .em()
      .fork()
      .find(AuditLogEntry, { action: 'related_payers.link.revoke', objectId: first.linkId });
    expect(revoked?.stateAfter).toMatchObject({ revokedByKind: 'automation', source: 'erp.sync-1' });
  });

  it('refuses FR-010 pairs and malformed input, writing nothing', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const personal = await makeOrganization(h.em(), 'Personal', { isPersonal: true });
    expect(await refusal(port().addPayer({ buyerOrganizationId: x, payerOrganizationId: x, source: 'erp' }))).toEqual({
      statusCode: 422,
      code: 'RELATED_PAYER_INVALID_PAIR',
    });
    expect(
      await refusal(port().addPayer({ buyerOrganizationId: x, payerOrganizationId: personal, source: 'erp' })),
    ).toEqual({ statusCode: 422, code: 'RELATED_PAYER_INVALID_PAIR' });
    const y = await makeOrganization(h.em(), 'Payer Y');
    expect(await refusal(port().addPayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'Not A Code' }))).toEqual({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
    expect(await linkRows(x)).toEqual([]);
  });

  it('an inactive link of the pair is a live link: add is refused, not duplicated', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const { linkId } = await port().addPayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp' });
    await h.em().getConnection().execute(`update related_payer_links set state = 'inactive' where id = ?`, [linkId]);
    expect(await refusal(port().addPayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp' }))).toEqual({
      statusCode: 422,
      code: 'RELATED_PAYER_LINK_EXISTS',
    });
    expect(await linkRows(x)).toHaveLength(1);
  });

  it('FR-032: with the module switched off the port answers MODULE_DISABLED and writes nothing', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    await withModuleOff('related_payers', 'deactivated', async () => {
      expect(await refusal(Promise.resolve().then(() => port().addPayer({ buyerOrganizationId: x, payerOrganizationId: y, source: 'erp' })))).toEqual({
        statusCode: 503,
        code: 'MODULE_DISABLED',
      });
    });
    expect(await linkRows(x)).toEqual([]);
  });
});
