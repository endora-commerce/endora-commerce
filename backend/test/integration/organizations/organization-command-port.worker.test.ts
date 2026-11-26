import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OrganizationCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * `specs/186-aggregate-ports/` T024 (issue #1821, US1a) — an ERP-style worker
 * maintains an Organization tree through `organizationCommandPort` with no
 * administrator anywhere: every call runs under `withSystemScope`, so each
 * entry records the `system` actor (no administrator id) and the worker names
 * itself through `source` (D-293.6).
 *
 * The worker creates a head office and a branch under it, re-parents an
 * existing branch, approves a pending Organization, blocks and unblocks it.
 * Then the refusals that must write nothing: a command hook's veto (the
 * `example` deployment's `command_hook_fixture` refuses an `organization.create`
 * whose name carries its `VETO` marker) rolls the create back; an extension key
 * no hook module claims and a malformed `source` are refused before anything
 * is written. The sales-channel assignment is US1b's and not here.
 */

const SOURCE = 'erp.customer-master';
const FIXTURE = 'command_hook_fixture';

describe('organizationCommandPort from a worker (186 T024)', () => {
  let h: BackendServerHandle;
  let port: OrganizationCommandPort;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL186W${stamp}${(seq++).toString().padStart(3, '0')}`;
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: ERP customer-master sync', fn);

  const input = (name: string, extra: { parentId?: string; status?: 'active' | 'pending_verification' } = {}) => ({
    name,
    taxId: taxId(),
    registeredAddress: { street: 'ul. Fabryczna 1', city: 'Poznań', postalCode: '60-001', country: 'PL' },
    salesChannelIds: [channel] as [string],
    status: extra.status ?? ('active' as const),
    ...(extra.parentId ? { parentId: extra.parentId } : {}),
  });

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'organization', objectId }, { orderBy: { actedAt: 'asc' } });
  const reread = (id: string) => h.em().fork().findOneOrFail(Organization, { id });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  async function withFixture<T>(run: () => Promise<T>): Promise<T> {
    const before = registryCache.enabledIds();
    registryCache.__setEnabledForTesting([...new Set([...before, FIXTURE])]);
    try {
      return await run();
    } finally {
      registryCache.__setEnabledForTesting([...before]);
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    port = h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
    const em = h.em().fork();
    const sales = em.create(SalesChannel, {
      code: `worker-${stamp}`,
      name: { en: 'worker' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('maintains a tree and moderates it with the system actor, recording its source', async () => {
    const options = { source: SOURCE };
    const head = await asWorker(() => port.create(input(`Worker head ${stamp}`), options));
    const otherHead = await asWorker(() => port.create(input(`Worker other head ${stamp}`), options));
    const branch = await asWorker(() => port.create(input(`Worker branch ${stamp}`, { parentId: head.id }), options));
    expect((await reread(branch.id)).parentId).toBe(head.id);

    // An existing branch moves to another head office: `organization.move`.
    await asWorker(() => port.setParent(branch.id, { parentId: otherHead.id }, options));
    expect((await reread(branch.id)).parentId).toBe(otherHead.id);

    const pending = await asWorker(() => port.create(input(`Worker pending ${stamp}`, { status: 'pending_verification' }), options));
    await asWorker(() => port.approve(pending.id, options));
    await asWorker(() => port.block(pending.id, { reason: 'Credit hold in the ERP' }, options));
    await asWorker(() => port.unblock(pending.id, options));
    expect((await reread(pending.id)).status).toBe('active');

    const written = [...(await entries(branch.id)), ...(await entries(pending.id))];
    expect(written.map((e) => e.action)).toEqual([
      'organization.create',
      'organization.move',
      'organization.create',
      'organization.approved',
      'organization.blocked',
      'organization.unblocked',
    ]);
    for (const entry of written) {
      expect(entry.actorAdminUserId ?? null, entry.action).toBeNull();
      expect(entry.stateAfter, entry.action).toMatchObject({ source: SOURCE });
    }
    // The approval stamps no administrator.
    expect((await reread(pending.id)).approvedByAdminUserId ?? null).toBeNull();
  });

  it('rolls a vetoed create back: no Organization, no entry', async () => {
    const vetoed = input(`CMDHOOK VETO worker ${stamp}`);
    const answer = await withFixture(() => refusal(asWorker(() => port.create(vetoed, { source: SOURCE }))));
    expect(answer).toMatchObject({ statusCode: 409, code: 'COMMAND_HOOK_FIXTURE_REFUSED' });
    expect(await h.em().fork().findOne(Organization, { taxId: vetoed.taxId })).toBeNull();
  });

  it('refuses an unclaimed extension and a malformed source before anything is written', async () => {
    const pending = await asWorker(() => port.create(input(`Worker refusals ${stamp}`, { status: 'pending_verification' })));
    const recorded = (await entries(pending.id)).length;
    expect(
      await refusal(asWorker(() => port.approve(pending.id, { extensions: { nobody_claims_this: {} } }))),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(await refusal(asWorker(() => port.approve(pending.id, { source: 'ERP Sync!' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    const unwritten = input(`Worker bad source ${stamp}`);
    expect(await refusal(asWorker(() => port.create(unwritten, { source: ' ' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await h.em().fork().findOne(Organization, { taxId: unwritten.taxId })).toBeNull();
    expect((await reread(pending.id)).status).toBe('pending_verification');
    expect(await entries(pending.id)).toHaveLength(recorded);
  });
});
