import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityTransitionVetoError,
  type OpportunityReadPort,
  type OpportunityTransitionGuardRegistryPort,
  type OpportunityTransitionPort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { CrmOpportunity } from '../../helpers/package-entities.js';
import {
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * The two ports CRM publishes (User Story 14;
 * `specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §4).
 *
 * `opportunityReadPort` answers plain records — never an entity — under the
 * **caller's** tenant scope. `opportunityTransitionPort` moves an Opportunity
 * through its workflow and answers every refusal as a value, so a caller in
 * another module never has to read an HTTP error to learn what happened. Both
 * are gated: resolving either while `crm` is off throws `ModuleDisabledError`.
 */
describe('crm published ports (User Story 14)', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;

  const readPort = () => h.container.resolve<OpportunityReadPort>('opportunityReadPort');
  const transitionPort = () => h.container.resolve<OpportunityTransitionPort>('opportunityTransitionPort');

  /** Call a port as the platform administrator. */
  const asPlatform = <T>(body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, { allowAll: true, allowedOrganizationIds: [] }),
      body,
    );
  /** Call a port as an administrator confined to these Organizations. */
  const confinedTo = <T>(organizationIds: string[], body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId: TEST_ADMIN_ID },
        { allowAll: false, allowedOrganizationIds: organizationIds },
      ),
      body,
    );

  const statusOf = async (id: string) =>
    (await h.em().findOneOrFail(CrmOpportunity, { id }, { filters: false })).statusCode;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Ports A');
    organizationB = await seedCrmOrganization(h.em(), 'Ports B');
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('opportunityReadPort', () => {
    it('finds an Opportunity by id as a plain record, and no entity', async () => {
      const created = await createCrmOpportunity(h, {
        title: 'Port read',
        organizationId: organizationA,
        manualValue: '1500',
      });
      const record = await asPlatform(() => readPort().findById(created.id));
      expect(record).toEqual({
        id: created.id,
        number: created.number,
        title: 'Port read',
        organizationId: organizationA,
        customerAccountId: null,
        salesChannelId: null,
        statusCode: 'new',
        statusKind: 'open',
        assignedAdminUserId: expect.toSatisfy((value: unknown) => value === null || typeof value === 'string'),
        value: '1500.00',
        valueMode: 'manual',
        currency: 'PLN',
        closedAt: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(record).not.toBeInstanceOf(CrmOpportunity);
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    });

    it('answers null for an id that names nothing, and for one that is not an id', async () => {
      expect(await asPlatform(() => readPort().findById('00000000-0000-4000-8000-00000000dead'))).toBeNull();
      expect(await asPlatform(() => readPort().findById('not-an-id'))).toBeNull();
    });

    it('finds the Opportunity a document is linked to, and null for an unlinked one', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      const linked = await seedCrmOrder(h.em(), { organizationId: organizationA });
      const unlinked = await seedCrmOrder(h.em(), { organizationId: organizationA });
      expect((await linkCrmOrder(h, opportunity.id, linked.id)).statusCode).toBe(201);

      expect((await asPlatform(() => readPort().findByDocument('order', linked.id)))?.id).toBe(opportunity.id);
      expect(await asPlatform(() => readPort().findByDocument('order', unlinked.id))).toBeNull();
      // The same id under the other kind is another document.
      expect(await asPlatform(() => readPort().findByDocument('quote_request', linked.id))).toBeNull();
    });

    it('lists the open Opportunities of an Organization, and not the closed ones', async () => {
      const organizationId = await seedCrmOrganization(h.em(), 'Ports open');
      const open = await createCrmOpportunity(h, { organizationId, title: 'Still open' });
      const lost = await createCrmOpportunity(h, { organizationId, title: 'Lost' });
      expect((await transitionCrmOpportunity(h, lost.id, 'lost')).statusCode).toBe(200);
      await createCrmOpportunity(h, { organizationId: organizationB, title: 'Somebody else' });

      const records = await asPlatform(() => readPort().listOpenForOrganization(organizationId));
      expect(records.map((record) => record.id)).toEqual([open.id]);
      expect(records[0]).toMatchObject({ statusKind: 'open', organizationId });
    });

    it('reads under the caller’s scope: another Organization’s Opportunity is not there', async () => {
      const mine = await createCrmOpportunity(h, { organizationId: organizationA });
      const theirs = await createCrmOpportunity(h, { organizationId: organizationB });
      const theirOrder = await seedCrmOrder(h.em(), { organizationId: organizationB });
      expect((await linkCrmOrder(h, theirs.id, theirOrder.id)).statusCode).toBe(201);

      // Positive controls: the confined caller reads their own, and the
      // platform administrator reads the other one through the same calls.
      expect((await confinedTo([organizationA], () => readPort().findById(mine.id)))?.id).toBe(mine.id);
      expect((await asPlatform(() => readPort().findById(theirs.id)))?.id).toBe(theirs.id);
      expect((await asPlatform(() => readPort().findByDocument('order', theirOrder.id)))?.id).toBe(theirs.id);
      expect((await asPlatform(() => readPort().listOpenForOrganization(organizationB))).length).toBeGreaterThan(0);

      expect(await confinedTo([organizationA], () => readPort().findById(theirs.id))).toBeNull();
      expect(await confinedTo([organizationA], () => readPort().findByDocument('order', theirOrder.id))).toBeNull();
      expect(await confinedTo([organizationA], () => readPort().listOpenForOrganization(organizationB))).toEqual([]);
    });
  });

  describe('opportunityTransitionPort', () => {
    const apply = (opportunityId: string, to: string) =>
      asPlatform(() =>
        transitionPort().applyStatus({ opportunityId, to, actor: { kind: 'system' }, reason: 'from a port' }),
      );

    it('applies a permitted transition and says from where to where', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      expect(await apply(opportunity.id, 'qualified')).toEqual({ applied: true, from: 'new', to: 'qualified' });
      expect(await statusOf(opportunity.id)).toBe('qualified');
    });

    it('answers already_there and writes nothing', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      expect(await apply(opportunity.id, 'new')).toEqual({ applied: false, reason: 'already_there', from: 'new' });
      const read = await h.em().findOneOrFail(CrmOpportunity, { id: opportunity.id }, { filters: false });
      expect(read.version).toBe(opportunity.version);
    });

    it('answers not_found for an Opportunity that does not exist or is outside the caller’s scope', async () => {
      expect(await apply('00000000-0000-4000-8000-00000000dead', 'qualified')).toMatchObject({
        applied: false,
        reason: 'not_found',
        from: null,
      });
      const theirs = await createCrmOpportunity(h, { organizationId: organizationB });
      const outcome = await confinedTo([organizationA], () =>
        transitionPort().applyStatus({ opportunityId: theirs.id, to: 'qualified', actor: { kind: 'system' } }),
      );
      expect(outcome).toMatchObject({ applied: false, reason: 'not_found', from: null });
      expect(await statusOf(theirs.id)).toBe('new');
    });

    it('answers unknown_status for a status the workflow does not have', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      expect(await apply(opportunity.id, 'no_such_status')).toMatchObject({
        applied: false,
        reason: 'unknown_status',
        from: 'new',
      });
    });

    it('answers not_permitted for a status the workflow has no edge to', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      const outcome = await apply(opportunity.id, 'won');
      expect(outcome).toMatchObject({ applied: false, reason: 'not_permitted', from: 'new' });
      expect((outcome as { detail: string }).detail).toContain('new');
      expect(await statusOf(opportunity.id)).toBe('new');
    });

    it('answers vetoed with the guard’s sentence — distinguishable from not_permitted', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
      h.container.resolve<OpportunityTransitionGuardRegistryPort>('opportunityTransitionGuardRegistry').register({
        ownerModuleId: 'crm',
        match: { from: 'new', to: 'qualified' },
        guard: (event) => {
          if (event.opportunityId !== opportunity.id) return;
          throw new OpportunityTransitionVetoError('Not before the budget is known.', event.from, event.to);
        },
      });
      expect(await apply(opportunity.id, 'qualified')).toEqual({
        applied: false,
        reason: 'vetoed',
        from: 'new',
        detail: 'Not before the budget is known.',
      });
      expect(await statusOf(opportunity.id)).toBe('new');
    });
  });

  describe('while crm is off', () => {
    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'both ports fail closed with ModuleDisabledError (%s), and answer again afterwards',
      async (axis) => {
        const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });
        // Positive control.
        expect((await asPlatform(() => readPort().findById(opportunity.id)))?.id).toBe(opportunity.id);

        await withModuleOff('crm', axis, async () => {
          await expect(asPlatform(async () => readPort().findById(opportunity.id))).rejects.toBeInstanceOf(
            ModuleDisabledError,
          );
          await expect(
            asPlatform(async () =>
              transitionPort().applyStatus({ opportunityId: opportunity.id, to: 'qualified', actor: { kind: 'system' } }),
            ),
          ).rejects.toBeInstanceOf(ModuleDisabledError);
        });

        expect(await statusOf(opportunity.id)).toBe('new');
        expect((await asPlatform(() => readPort().findById(opportunity.id)))?.id).toBe(opportunity.id);
      },
    );
  });
});
