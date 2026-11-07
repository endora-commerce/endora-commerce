import { LockMode } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldCarryPlan } from '@endora-commerce/contracts';
import { OpportunityLinkService, type OpportunityLinkServiceDeps } from './opportunity-link-service.js';

/**
 * `linkAutomatically` with a carry — an Order joining the Opportunity its Quote
 * Request is linked to (`specs/162-custom-fields-value-carry/` US2-2, US2-3).
 * The Command is run against a fake EntityManager; what the database does with
 * the lock is `test/integration/crm/custom-field-carry-into-opportunity.test.ts`'s.
 */
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000e1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';

function service(plan: () => Promise<CustomFieldCarryPlan>) {
  const parent = { id: OPPORTUNITY_ID, organizationId: ORGANIZATION_ID, customFieldValues: { held: 1 }, version: 3 };
  const txEm = {
    findOne: vi.fn(async () => parent),
    create: vi.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'link', ...data })),
  };
  const audits: Array<{ after: unknown }> = [];
  const deps = {
    emFactory: () => ({ findOne: vi.fn(async () => null) }),
    commandBus: {
      run: vi.fn(async (command: { run: (ctx: unknown) => Promise<{ result: unknown; after: unknown }> }) => {
        const outcome = await command.run({ em: txEm, actor: { kind: 'system' } });
        audits.push({ after: outcome.after });
        return outcome.result;
      }),
    },
    linksChanged: vi.fn(async () => undefined),
    customFieldCarry: { plan: vi.fn(plan) },
    warn: vi.fn(),
  };
  const subject = new OpportunityLinkService(deps as never as OpportunityLinkServiceDeps);
  const link = () =>
    subject.linkAutomatically({
      opportunityId: OPPORTUNITY_ID,
      documentKind: 'order',
      documentId: ORDER_ID,
      linkSource: 'quote_conversion',
      carry: { sourceType: 'order', recordId: ORDER_ID, sourceValues: { k: 'v' } },
    });
  return { deps, txEm, parent, audits, link };
}

describe('OpportunityLinkService.linkAutomatically — the carry of a joining document', () => {
  it('plans over the Opportunity it holds for update, and bumps the version when it carries (#404)', async () => {
    const { txEm, parent, link, deps } = service(async () => ({
      values: { held: 1, k: 'v' },
      carried: ['k'],
      skipped: [],
    }));
    expect(await link()).toBe('linked');
    expect(txEm.findOne).toHaveBeenCalledWith(expect.anything(), { id: OPPORTUNITY_ID }, {
      lockMode: LockMode.PESSIMISTIC_WRITE,
    });
    expect(deps.customFieldCarry.plan).toHaveBeenCalledWith(expect.objectContaining({ targetValues: { held: 1 } }));
    expect(parent.customFieldValues).toEqual({ held: 1, k: 'v' });
    expect(parent.version).toBe(4);
  });

  it('leaves the version alone when nothing was carried', async () => {
    const { parent, link } = service(async () => ({
      values: { held: 1 },
      carried: [],
      skipped: [{ key: 'gone', reason: 'target_missing' }],
    }));
    expect(await link()).toBe('linked');
    expect(parent.customFieldValues).toEqual({ held: 1 });
    expect(parent.version).toBe(3);
  });

  it('still links the document when the carry fails, and says which one did not carry in the log (#405)', async () => {
    const { parent, link, deps, audits } = service(async () => {
      throw new Error('custom-field definitions could not be read');
    });
    expect(await link()).toBe('linked');
    expect(parent.customFieldValues).toEqual({ held: 1 });
    expect(parent.version).toBe(3);
    expect(audits[0]?.after).not.toHaveProperty('customFieldCarry');
    expect(deps.linksChanged).toHaveBeenCalledWith(OPPORTUNITY_ID);
    expect(deps.warn).toHaveBeenCalledOnce();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: OPPORTUNITY_ID,
        documentKind: 'order',
        documentId: ORDER_ID,
        error: expect.any(Error),
      }),
      expect.stringContaining('carry'),
    );
  });
});
