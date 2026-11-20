import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { RELATED_PAYERS_AUDIT_KEYS } from './audit-state.js';
import {
  requestAcceptCommand,
  requestCreateCommand,
  requestExpireCommand,
  requestRejectCommand,
  requestRouteCommand,
  requestWithdrawCommand,
  invitationSendCommand,
} from './request-commands.js';

/**
 * `specs/182-related-payers/` T069 (FR-100, SC-006, contracts/commands-audit.md) — every request
 * Command records codes, ids, booleans and a length: never the tax ID, the contact e-mail, the
 * comment, the rejection reason or a name.
 */
const SENDER = randomUUID();
const PAYER = randomUUID();
const SENTINELS = ['S182TAXID77', 's182-contact@example.test', 'S182-COMMENT words', 'S182-REASON why', 'S182-SENDER-NAME'];

function harness() {
  const rows: Array<Record<string, unknown>> = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const tx = {
    find: async (_entity: unknown, where: Record<string, unknown>) => rows.filter((r) => matches(r, where)),
    findOne: async (_entity: unknown, where: Record<string, unknown>) => rows.find((r) => matches(r, where)) ?? null,
    create: (_entity: unknown, data: Record<string, unknown>) => ({
      version: 1,
      state: data['state'] ?? 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }),
    persist: (row: Record<string, unknown>) => {
      if (!rows.includes(row)) rows.push(row);
    },
    flush: async () => undefined,
  };
  const em = { fork: () => em, transactional: async <T>(fn: (scoped: unknown) => Promise<T>) => fn(tx), ...tx };
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const bus = new CommandBus({ em } as never, audit as never, new EventBus());
  return { bus, entries, rows };
}

const create = (decision: {
  routing: 'counterparty' | 'operator' | 'awaiting_registration';
  operatorReason: null | 'ineligible' | 'no_account';
  counterpartyOrganizationId?: string | null;
}) =>
  requestCreateCommand({
    senderOrganizationId: SENDER,
    senderCustomerAccountId: randomUUID(),
    direction: 'buyer_request',
    taxIdNormalized: 'S182TAXID77',
    contactEmail: 's182-contact@example.test',
    comment: 'S182-COMMENT words',
    decision: { counterpartyOrganizationId: PAYER, ...decision },
    approvalMode: 'payer',
    unregisteredMode: 'admin',
    salesChannelId: randomUUID(),
    language: 'pl-PL',
    expiresAt: new Date(Date.now() + 86_400_000),
  });

describe('request audit state carries codes, never values (FR-100)', () => {
  it('create, accept (link), reject with a reason, withdraw, expire', async () => {
    const h = harness();
    await withSystemScope('related_payers request audit sentinel', async () => {
      const accepted = await h.bus.run(create({ routing: 'counterparty', operatorReason: null }));
      await h.bus.run(requestAcceptCommand({ requestId: accepted.id, expectedVersion: 1, step: 'counterparty', deciderId: randomUUID() }));
      const rejected = await h.bus.run(create({ routing: 'operator', operatorReason: 'ineligible' }));
      await h.bus.run(
        requestRejectCommand({ requestId: rejected.id, expectedVersion: 1, step: 'operator', deciderId: randomUUID(), reason: 'S182-REASON why' }),
      );
      const withdrawn = await h.bus.run(create({ routing: 'counterparty', operatorReason: null }));
      await h.bus.run(requestWithdrawCommand({ requestId: withdrawn.id, expectedVersion: 1, senderCustomerAccountId: randomUUID() }));
      const expired = await h.bus.run(create({ routing: 'counterparty', operatorReason: null }));
      await h.bus.run(requestExpireCommand({ requestId: expired.id, expectedVersion: 1 }));
    });

    expect(h.entries.map((e) => e.action)).toEqual([
      'related_payers.request.create',
      'related_payers.request.accept',
      'related_payers.request.create',
      'related_payers.request.reject',
      'related_payers.request.create',
      'related_payers.request.withdraw',
      'related_payers.request.create',
      'related_payers.request.expire',
    ]);
    expectNoAuditValues(h.entries, SENTINELS);
    for (const entry of h.entries) {
      for (const state of [entry.stateBefore, entry.stateAfter]) {
        for (const key of Object.keys(state ?? {})) expect(RELATED_PAYERS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
      }
    }
    // The rejection reason is recorded as its length only.
    expect(h.entries.find((e) => e.action === 'related_payers.request.reject')?.stateAfter).toMatchObject({ rejectionReasonLength: 15 });
  });
});

/**
 * Phase 6 (US5, contracts/commands-audit.md) — the request routed to an Organization that exists
 * now (assign, attach on registration), the invitation to register (its token is never recorded,
 * only its hash is stored), and the operator's acceptance naming the Organization it just created.
 */
describe('Phase 6 request Commands record codes and ids only', () => {
  it('route, invitation.send, accept with an assigned counterparty', async () => {
    const h = harness();
    let token = '';
    await withSystemScope('related_payers request audit sentinel', async () => {
      const routed = await h.bus.run(create({ routing: 'operator', operatorReason: 'no_account', counterpartyOrganizationId: null }));
      await h.bus.run(
        requestRouteCommand({
          requestId: routed.id,
          expectedVersion: 1,
          decision: { routing: 'counterparty', counterpartyOrganizationId: PAYER, operatorReason: null },
        }),
      );
      const invited = await h.bus.run(create({ routing: 'operator', operatorReason: 'no_account', counterpartyOrganizationId: null }));
      const sent = await h.bus.run(invitationSendCommand({ requestId: invited.id, from: 'operator' }));
      token = sent.token;
      const created = await h.bus.run(create({ routing: 'operator', operatorReason: 'no_account', counterpartyOrganizationId: null }));
      await h.bus.run(
        requestAcceptCommand({
          requestId: created.id,
          expectedVersion: 1,
          step: 'operator',
          deciderId: randomUUID(),
          assignCounterpartyOrganizationId: PAYER,
        }),
      );
    });
    expect(h.entries.map((e) => e.action)).toEqual([
      'related_payers.request.create',
      'related_payers.request.route',
      'related_payers.request.create',
      'related_payers.invitation.send',
      'related_payers.request.create',
      'related_payers.request.accept',
    ]);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expectNoAuditValues(h.entries, [...SENTINELS, token]);
    for (const entry of h.entries) {
      for (const state of [entry.stateBefore, entry.stateAfter]) {
        for (const key of Object.keys(state ?? {})) expect(RELATED_PAYERS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
      }
    }
    expect(h.entries.find((e) => e.action === 'related_payers.request.route')?.stateAfter).toMatchObject({
      routing: 'counterparty',
      counterpartyOrganizationId: PAYER,
    });
    expect(h.entries.find((e) => e.action === 'related_payers.invitation.send')?.stateAfter).toEqual({ routing: 'awaiting_registration' });
    // The stored row keeps the token's hash, never the token.
    const invitedRow = h.rows.find((r) => r['routing'] === 'awaiting_registration')!;
    expect(invitedRow['invitationTokenHash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h.rows)).not.toContain(token);
  });
});
