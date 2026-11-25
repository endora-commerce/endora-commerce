import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  composedOrganizationParticipant,
  expectComposedOrganizationParticipant,
  mergeSql,
  seedRows,
} from '../../helpers/organization-merge-participants.js';

/**
 * `specs/192-organization-merge/` T047 — the `related_payers` participant
 * (spec § Edge cases, *Payer links between the two*): links and requests on
 * either side are re-pointed to the survivor; a link that would join the
 * survivor to itself is revoked and stays on the archived loser; a link that
 * duplicates one of the survivor's live links is revoked (the survivor's is
 * kept); a pending request between the two is closed with a merge reason.
 */
describe('related_payers — Organization merge participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const link = (id: string, organizationId: string, payerOrganizationId: string, state = 'active') =>
    [
      `insert into "related_payer_links" ("id","organization_id","payer_organization_id","state","origin","created_at","updated_at")
       values (?, ?, ?, ?, 'operator', now(), now())`,
      [id, organizationId, payerOrganizationId, state],
    ] as const;
  const request = (id: string, organizationId: string, counterpartyOrganizationId: string) =>
    [
      `insert into "related_payer_requests" ("id","organization_id","direction","sender_customer_account_id","tax_id_normalized","contact_email",
         "counterparty_organization_id","routing","approval_mode","unregistered_mode","state","sales_channel_id","language","expires_at","created_at","updated_at")
       values (?, ?, 'buyer_request', ?, 'PL0000000000', 'payer@example.test', ?, 'counterparty', 'counterparty', 'reject', 'pending', ?, 'pl',
               now() + interval '7 days', now(), now())`,
      [id, organizationId, randomUUID(), counterpartyOrganizationId, randomUUID()],
    ] as const;

  it('re-points links and requests, revokes self-links and duplicates, closes self-requests (T047)', async () => {
    const [p, q] = [randomUUID(), randomUUID()];
    const l = {
      survivorToP: randomUUID(),
      loserToP: randomUUID(),
      loserToQ: randomUUID(),
      qToLoser: randomUUID(),
      loserToSurvivor: randomUUID(),
      survivorToLoser: randomUUID(),
    };
    const r = { self: randomUUID(), toP: randomUUID(), fromQ: randomUUID() };
    let preview: Awaited<ReturnType<ReturnType<typeof composedOrganizationParticipant>['preview']>> | null = null;
    const outcome = await expectComposedOrganizationParticipant(h, {
      moduleId: 'related_payers',
      key: 'payer-links',
      action: 'related_payer.merge_reassign',
      seed: async ({ survivorId, loserId }) => {
        await seedRows(h, [
          link(l.survivorToP, survivorId, p),
          link(l.loserToP, loserId, p),
          link(l.loserToQ, loserId, q),
          link(l.qToLoser, q, loserId),
          link(l.loserToSurvivor, loserId, survivorId),
          link(l.survivorToLoser, survivorId, loserId, 'inactive'),
          request(r.self, loserId, survivorId),
          request(r.toP, loserId, p),
          request(r.fromQ, q, loserId),
        ]);
        preview = await composedOrganizationParticipant(h, 'related_payers', 'payer-links').preview({
          hostType: 'organization',
          survivorId,
          loserId,
          hostContext: {},
        });
      },
      snapshot: ({ survivorId, loserId }) =>
        mergeSql(
          h,
          `select 'link' as "t", "id", "organization_id"::text || '>' || "payer_organization_id"::text || ':' || "state" as "v"
             from "related_payer_links" where ? in ("organization_id", "payer_organization_id") or ? in ("organization_id", "payer_organization_id")
           union all
           select 'request', "id", "organization_id"::text || '>' || coalesce("counterparty_organization_id"::text, '') || ':' || "state"
             from "related_payer_requests" where ? in ("organization_id", "counterparty_organization_id") or ? in ("organization_id", "counterparty_organization_id")
           order by 1, 2`,
          [survivorId, loserId, survivorId, loserId],
        ),
      failOn: {
        table: 'related_payer_links',
        on: 'UPDATE',
        when: (loserId) => `OLD."organization_id" = '${loserId}' or OLD."payer_organization_id" = '${loserId}'`,
      },
    });
    expect(outcome.moved).toBe(8);
    expect(preview!.conflicts.map((c) => `${c.code}:${c.resolution}`).sort()).toEqual(
      [
        'RELATED_PAYER_MERGE_DUPLICATE_LINK:revoked',
        'RELATED_PAYER_MERGE_SELF_LINK:revoked',
        'RELATED_PAYER_MERGE_SELF_LINK:revoked',
        'RELATED_PAYER_MERGE_SELF_REQUEST:closed',
      ].sort(),
    );

    const { survivorId, loserId } = outcome;
    const links = new Map(
      (
        await mergeSql<Array<{ id: string; organization_id: string; payer_organization_id: string; state: string; revoked_at: Date | null }>>(
          h,
          `select "id", "organization_id", "payer_organization_id", "state", "revoked_at" from "related_payer_links" where "id" = any(?::uuid[])`,
          [`{${Object.values(l).join(',')}}`],
        )
      ).map((row) => [row.id, row]),
    );
    expect(links.get(l.survivorToP)).toMatchObject({ organization_id: survivorId, payer_organization_id: p, state: 'active' });
    expect(links.get(l.loserToP)).toMatchObject({ organization_id: survivorId, payer_organization_id: p, state: 'revoked' });
    expect(links.get(l.loserToQ)).toMatchObject({ organization_id: survivorId, payer_organization_id: q, state: 'active' });
    expect(links.get(l.qToLoser)).toMatchObject({ organization_id: q, payer_organization_id: survivorId, state: 'active' });
    expect(links.get(l.loserToSurvivor)).toMatchObject({ organization_id: loserId, payer_organization_id: survivorId, state: 'revoked' });
    expect(links.get(l.survivorToLoser)).toMatchObject({ organization_id: survivorId, payer_organization_id: loserId, state: 'revoked' });

    const requests = new Map(
      (
        await mergeSql<Array<{ id: string; organization_id: string; counterparty_organization_id: string; state: string; decided_by_kind: string | null }>>(
          h,
          `select "id", "organization_id", "counterparty_organization_id", "state", "decided_by_kind" from "related_payer_requests" where "id" = any(?::uuid[])`,
          [`{${Object.values(r).join(',')}}`],
        )
      ).map((row) => [row.id, row]),
    );
    expect(requests.get(r.self)).toMatchObject({
      organization_id: survivorId,
      counterparty_organization_id: survivorId,
      state: 'withdrawn',
      decided_by_kind: 'merge',
    });
    expect(requests.get(r.toP)).toMatchObject({ organization_id: survivorId, counterparty_organization_id: p, state: 'pending' });
    expect(requests.get(r.fromQ)).toMatchObject({ organization_id: q, counterparty_organization_id: survivorId, state: 'pending' });
  });
});
