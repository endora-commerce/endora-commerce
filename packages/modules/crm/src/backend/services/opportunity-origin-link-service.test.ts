import { describe, expect, it, vi } from 'vitest';
import {
  CRM_OPPORTUNITY_ORIGIN_TYPE,
  OpportunityOriginLinkService,
  readEventOrigin,
  type OpportunityOriginLinkServiceDeps,
  type OriginatedDocument,
} from './opportunity-origin-link-service.js';

const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000e1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b1';
const OTHER_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b2';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000f1';

const origin = { type: CRM_OPPORTUNITY_ORIGIN_TYPE, id: OPPORTUNITY_ID };
const order: OriginatedDocument = {
  kind: 'order',
  id: ORDER_ID,
  organizationId: ORGANIZATION_ID,
  createdByAdminUserId: null,
};

function service(overrides: { opportunity?: unknown; scope?: unknown } = {}) {
  const deps = {
    emFactory: () => ({
      findOne: vi.fn(async () =>
        'opportunity' in overrides ? overrides.opportunity : { id: OPPORTUNITY_ID, organizationId: ORGANIZATION_ID },
      ),
    }),
    links: { linkAutomatically: vi.fn(async () => 'linked' as const) },
    adminScope: { resolveForAdmin: vi.fn(async () => overrides.scope ?? { allowAll: true }) },
    warn: vi.fn(),
  };
  return { deps, subject: new OpportunityOriginLinkService(deps as never as OpportunityOriginLinkServiceDeps) };
}

describe('OpportunityOriginLinkService', () => {
  it('links the document to the Opportunity its origin names, as created from it', async () => {
    const { deps, subject } = service();
    expect(await subject.link(origin, order)).toBe('linked');
    expect(deps.links.linkAutomatically).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      documentKind: 'order',
      documentId: ORDER_ID,
      linkSource: 'created_from_opportunity',
    });
    expect(deps.warn).not.toHaveBeenCalled();
    // `order.created.v1` names no actor, so nobody's reach is asked.
    expect(deps.adminScope.resolveForAdmin).not.toHaveBeenCalled();
  });

  it('answers what the link service answers for a document that is linked already', async () => {
    const { deps, subject } = service();
    deps.links.linkAutomatically.mockResolvedValueOnce('already-linked' as never);
    expect(await subject.link(origin, order)).toBe('already-linked');
  });

  it('leaves an origin of another type alone, reading nothing', async () => {
    const { deps, subject } = service();
    expect(await subject.link({ type: 'somebody_elses_thing', id: OPPORTUNITY_ID }, order)).toBe('not-ours');
    expect(deps.links.linkAutomatically).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('refuses an Opportunity that does not exist, and says so in the log only', async () => {
    const { deps, subject } = service({ opportunity: null });
    expect(await subject.link(origin, order)).toBe('refused');
    expect(deps.links.linkAutomatically).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledTimes(1);
  });

  it('refuses an Opportunity of another Organization than the document, with the same words', async () => {
    const missing = service({ opportunity: null });
    await missing.subject.link(origin, order);
    const foreign = service({ opportunity: { id: OPPORTUNITY_ID, organizationId: OTHER_ORGANIZATION_ID } });
    expect(await foreign.subject.link(origin, order)).toBe('refused');
    expect(foreign.deps.links.linkAutomatically).not.toHaveBeenCalled();
    // Missing and out of reach are one answer.
    expect(foreign.deps.warn.mock.calls).toEqual(missing.deps.warn.mock.calls);
  });

  describe('when the event names the administrator who created the document', () => {
    const byAdmin: OriginatedDocument = { ...order, kind: 'quote_request', createdByAdminUserId: ADMIN_ID };

    it('links for one who reaches every Organization', async () => {
      const { deps, subject } = service({ scope: { allowAll: true } });
      expect(await subject.link(origin, byAdmin)).toBe('linked');
      expect(deps.adminScope.resolveForAdmin).toHaveBeenCalledWith(ADMIN_ID);
    });

    it('links for one confined to a set that holds the Opportunity’s Organization', async () => {
      const { subject } = service({ scope: { allowAll: false, allowedOrganizationIds: [ORGANIZATION_ID] } });
      expect(await subject.link(origin, byAdmin)).toBe('linked');
    });

    it('refuses for one who cannot reach the Opportunity’s Organization', async () => {
      const { deps, subject } = service({
        scope: { allowAll: false, allowedOrganizationIds: [OTHER_ORGANIZATION_ID] },
      });
      expect(await subject.link(origin, byAdmin)).toBe('refused');
      expect(deps.links.linkAutomatically).not.toHaveBeenCalled();
      expect(deps.warn).toHaveBeenCalledTimes(1);
    });

    it('refuses for one whose reach could not be established', async () => {
      const { deps, subject } = service({
        scope: { allowAll: false, allowedOrganizationIds: [], unresolved: new Error('no role') },
      });
      expect(await subject.link(origin, byAdmin)).toBe('refused');
      expect(deps.links.linkAutomatically).not.toHaveBeenCalled();
    });
  });
});

describe('readEventOrigin', () => {
  it('reads a well-formed origin off a payload', () => {
    expect(readEventOrigin({ orderId: ORDER_ID, origin })).toEqual(origin);
  });

  it.each([
    ['no origin', { orderId: ORDER_ID }],
    ['a null origin', { origin: null }],
    ['an id that is not a uuid', { origin: { type: CRM_OPPORTUNITY_ORIGIN_TYPE, id: 'x' } }],
    ['an extra key', { origin: { ...origin, organizationId: ORGANIZATION_ID } }],
    ['no payload', null],
  ])('answers null for %s', (_label, payload) => {
    expect(readEventOrigin(payload)).toBeNull();
  });
});
