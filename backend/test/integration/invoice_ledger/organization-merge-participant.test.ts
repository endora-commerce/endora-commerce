import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  composedOrganizationParticipant,
  expectComposedOrganizationParticipant,
  mergeSql,
  seedRows,
} from '../../helpers/organization-merge-conformance.js';

/**
 * `specs/192-organization-merge/` T045 (FR-044, OQ-10) — the `invoice_ledger`
 * participants: a client mapping of the loser moves only where the survivor
 * has none for the same adapter, credential and environment; where both have
 * one, the survivor's wins and the loser's is kept on the archived loser and
 * listed in the preview (`client-maps`, configuration). Document mappings are
 * re-pointed (`document-maps`, records); the delivery log is kept.
 */
describe('invoice_ledger — Organization merge participants', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const clientMap = (id: string, organizationId: string, credentialCode: string) =>
    [
      `insert into "invoice_ledger_client_maps" ("id","adapter_id","organization_id","nip_used","remote_client_id","credential_code","environment","updated_at")
       values (?, 'merge-ledger', ?, '0000000000', ?, ?, 'production', now())`,
      [id, organizationId, `remote-${id.slice(0, 8)}`, credentialCode],
    ] as const;
  const documentMap = (organizationId: string) =>
    [
      `insert into "invoice_ledger_document_maps" ("id","adapter_id","invoice_id","organization_id","environment","credential_code","created_at")
       values (?, 'merge-ledger', ?, ?, 'production', 'default', now())`,
      [randomUUID(), randomUUID(), organizationId],
    ] as const;

  it('fills the survivor’s mapping gaps and lists the loser’s mapping it keeps (client-maps, S+f, OQ-10)', async () => {
    const ids = { survivorDefault: randomUUID(), loserDefault: randomUUID(), loserOther: randomUUID() };
    let warnings: readonly { code: string; details?: Readonly<Record<string, unknown>> }[] = [];
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'invoice_ledger',
      key: 'client-maps',
      action: 'invoice_ledger.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [
          clientMap(ids.survivorDefault, survivorId, 'default'),
          clientMap(ids.loserDefault, loserId, 'default'),
          clientMap(ids.loserOther, loserId, 'branch'),
        ]);
        warnings = (
          await composedOrganizationParticipant(h, 'invoice_ledger', 'client-maps').preview({
            hostType: 'organization',
            survivorId,
            loserId,
            hostContext: {},
          })
        ).warnings;
      },
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select "id", "organization_id" from "invoice_ledger_client_maps" where "organization_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
      failOn: { table: 'invoice_ledger_client_maps', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(1);
    expect(warnings).toEqual([{ code: 'INVOICE_LEDGER_CLIENT_MAP_KEPT', details: { clientMapIds: [ids.loserDefault] } }]);
    const rows = new Map(
      (
        await mergeSql<Array<{ id: string; organization_id: string }>>(
          h,
          `select "id", "organization_id" from "invoice_ledger_client_maps" where "id" in (?, ?, ?)`,
          Object.values(ids),
        )
      ).map((row) => [row.id, row.organization_id]),
    );
    expect(rows.get(ids.loserOther)).toBe(outcome.survivorId);
    expect(rows.get(ids.loserDefault)).toBe(outcome.loserId);
    expect(rows.get(ids.survivorDefault)).toBe(outcome.survivorId);
  });

  it('re-points the document mappings and keeps the delivery log (document-maps)', async () => {
    const deliveryId = randomUUID();
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'invoice_ledger',
      key: 'document-maps',
      action: 'invoice_ledger.merge_reassign',
      seed: ({ loserId }) =>
        seedRows(h, [
          documentMap(loserId),
          documentMap(loserId),
          documentMap(loserId),
          [
            `insert into "invoice_ledger_deliveries" ("id","adapter_id","invoice_id","organization_id","kind","credential_code","environment",
               "numbering_mode","ksef_routing","status","idempotency_key","attempt_count","attempts","ksef_delegated","created_at","updated_at")
             values (?, 'merge-ledger', ?, ?, 'invoice', 'default', 'production', 'endora', 'native', 'succeeded', ?, 0, '[]'::jsonb, false, now(), now())`,
            [deliveryId, randomUUID(), loserId, randomUUID()],
          ],
        ]),
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select "id", "organization_id" from "invoice_ledger_document_maps" where "organization_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
      failOn: { table: 'invoice_ledger_document_maps', on: 'UPDATE', when: (loserId) => `OLD."organization_id" = '${loserId}'` },
    });
    expect(outcome.moved).toBe(3);
    const [delivery] = await mergeSql<Array<{ organization_id: string }>>(
      h,
      `select "organization_id" from "invoice_ledger_deliveries" where "id" = ?`,
      [deliveryId],
    );
    expect(delivery?.organization_id).toBe(outcome.loserId);
  });
});
