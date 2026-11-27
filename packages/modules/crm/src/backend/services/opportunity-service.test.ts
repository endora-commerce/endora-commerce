import { describe, expect, it, vi } from 'vitest';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { OpportunityService, type OpportunityServiceDeps } from './opportunity-service.js';

/**
 * `createForDocument` — the Opportunity the system creates for a document that
 * was just placed. A carry rides on that creation and never fails it
 * (`specs/162-custom-fields-value-carry/` research R-9; #405).
 */
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000e1';

function service() {
  const created = { id: OPPORTUNITY_ID, organizationId: ORGANIZATION_ID, number: 'OPP-000001' };
  const deps = {
    emFactory: () => ({ count: vi.fn(async () => 1) }),
    commandBus: { run: vi.fn(async () => created) },
    workflowRead: { loadGraph: vi.fn(async () => ({ initial: () => ({ code: 'new' }) })) },
    assignment: {
      resolveDefault: vi.fn(async () => null),
      notifyAssigned: vi.fn(async () => undefined),
    },
    customFieldCarry: {
      plan: vi.fn(async () => {
        throw new Error('custom-field definitions could not be read');
      }),
    },
    recalculateValue: vi.fn(async () => undefined),
    warn: vi.fn(),
  };
  return { deps, subject: new OpportunityService(deps as never as OpportunityServiceDeps) };
}

describe('OpportunityService.createForDocument — a carry that fails', () => {
  it('still creates the Opportunity, and says which document did not carry in the log (#405)', async () => {
    const { deps, subject } = service();
    const result = await subject.createForDocument({
      title: 'ORD-1 — Acme',
      organizationId: ORGANIZATION_ID,
      currency: 'PLN',
      salesChannelId: null,
      source: 'order',
      document: { kind: 'order', id: ORDER_ID },
      carry: { sourceType: 'order', recordId: ORDER_ID, sourceValues: { k: 'v' } },
    });
    expect(result).toEqual({ id: OPPORTUNITY_ID, number: 'OPP-000001' });
    expect(deps.commandBus.run).toHaveBeenCalledOnce();
    expect(deps.recalculateValue).toHaveBeenCalledWith(OPPORTUNITY_ID);
    expect(deps.warn).toHaveBeenCalledOnce();
    expect(deps.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        documentKind: 'order',
        documentId: ORDER_ID,
        organizationId: ORGANIZATION_ID,
        error: expect.any(Error),
      }),
      expect.stringContaining('carry'),
    );
  });
});

/**
 * `createForDocument`'s idempotence answer (`already-linked`) is the document
 * link's unique index refusing a second Opportunity — and only that. Since
 * `crm.opportunity.create` is hookable (`specs/193-admin-form-extensions/`
 * FR-111), a `beforeCommit` hook's own write can raise a unique violation of
 * another constraint, which must fail the creation, not cancel it silently.
 */
describe('OpportunityService.createForDocument — which unique violation is already-linked', () => {
  const violation = (constraint: string) =>
    new UniqueConstraintViolationException(Object.assign(new Error('duplicate key value'), { constraint }));
  const input = {
    title: 'ORD-1 — Acme',
    organizationId: ORGANIZATION_ID,
    currency: 'PLN',
    salesChannelId: null,
    source: 'order' as const,
    document: { kind: 'order' as const, id: ORDER_ID },
  };

  it('answers already-linked for the document link’s unique index', async () => {
    const { deps, subject } = service();
    deps.commandBus.run.mockRejectedValueOnce(violation('crm_opportunity_links_document_unique'));
    expect(await subject.createForDocument(input)).toBe('already-linked');
    expect(deps.recalculateValue).not.toHaveBeenCalled();
  });

  it('rethrows a unique violation of any other constraint — a hook’s, say', async () => {
    const { deps, subject } = service();
    const other = violation('acme_erp_links_external_id_unique');
    deps.commandBus.run.mockRejectedValueOnce(other);
    await expect(subject.createForDocument(input)).rejects.toBe(other);
  });
});
