import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  ProjectLinkListResponseSchema,
  quoteRequestSummarySchema,
  type QuoteRequestReadPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_API, createCrmOpportunity, linkCrmQuoteRequest } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects } from '../projects/helpers.js';

/**
 * Issue #456 (owner ruling of 2026-11-07) — one rule for what a quote request
 * is worth: per line, Σ quantity × (agreed price ?? asked price), with a
 * `agreement` of `agreed`, `partial` or `none`; a quote without any price has
 * no amount at all (PO ruling of 2026-11-08: "no price" is not zero).
 * `quote_requests` publishes it on `quoteRequestReadPort`; the quote desk list,
 * a CRM Opportunity's link and a Project's link all show that one figure.
 *
 * Before the fix the desk list showed a quote with one agreed line at the asked
 * prices of every line (39.00 here), while CRM and Projects showed 35.00.
 */
describe('issue #456 — the quote desk, CRM and Projects show one amount [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const admin = { b2b_session: 'stub-admin-session' };
  const projects: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await deleteProjects(h, projects);
    await teardownBackendServer(h);
  });

  const createQuote = async (asked = true) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 2, ...(asked ? { desiredUnitPrice: 12 } : {}) },
          { productId: SEED_PRODUCT_102_ID, quantity: 3, ...(asked ? { desiredUnitPrice: 5 } : {}) },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  };

  const agree = async (id: string, version: number, prices: [number, number | null]) => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: admin,
      headers: { 'if-match': `"${version}"` },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: prices[0] },
          { productId: SEED_PRODUCT_102_ID, quantity: 3, ...(prices[1] === null ? {} : { agreedUnitPrice: prices[1] }) },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { version: number } }).data.version;
  };

  const deskRow = async (id: string) => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { data: unknown[] }).data
      .map((r) => quoteRequestSummarySchema.parse(r))
      .find((r) => r.id === id);
    expect(row, 'on the quote desk list').toBeDefined();
    return { amount: row!.amount, agreement: row!.agreement };
  };

  const crmLink = async (opportunityId: string, quoteId: string) => {
    const res = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${opportunityId}`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    const link = OpportunityDetailResponseSchema.parse(res.json()).data.links.find((l) => l.documentId === quoteId);
    expect(link?.available).toBe(true);
    return { amount: link?.total ?? null, agreement: link?.agreement };
  };

  const projectLink = async (projectId: string, quoteId: string) => {
    const res = await callProjects(h, 'GET', `/${projectId}/links`);
    expect(res.statusCode, res.body).toBe(200);
    const link = ProjectLinkListResponseSchema.parse(res.json()).data.find((l) => l.recordId === quoteId);
    expect(link?.available).toBe(true);
    return { amount: link?.amount ?? null, agreement: link?.agreement };
  };

  const linkBoth = async (opportunityId: string, projectId: string, quoteId: string) => {
    const linked = await linkCrmQuoteRequest(h, opportunityId, quoteId);
    expect(linked.statusCode, linked.body).toBe(201);
    const projectLinked = await callProjects(h, 'POST', `/${projectId}/links`, {
      payload: { kind: 'quote_request', recordId: quoteId },
    });
    expect(projectLinked.statusCode, projectLinked.body).toBe(201);
  };

  const everywhere = async (opportunityId: string, projectId: string, quoteId: string) => {
    const port = h.container.resolve<QuoteRequestReadPort>('quoteRequestReadPort');
    const published = await port.amountOf(quoteId);
    const shown = { amount: published!.amount, agreement: published!.agreement };
    expect(await deskRow(quoteId)).toEqual(shown);
    expect(await crmLink(opportunityId, quoteId)).toEqual(shown);
    expect(await projectLink(projectId, quoteId)).toEqual(shown);
    return published;
  };

  it('none, then partial, then agreed: the desk, CRM and Projects follow the port at every step', async () => {
    const quote = await createQuote();
    const opportunity = await createCrmOpportunity(h, { title: 'Issue 456' });
    const project = await createProject(h, { title: 'Issue 456', organizationIds: [TEST_ORGANIZATION_ID], visibility: 'everyone' });
    projects.push(project.id);
    await linkBoth(opportunity.id, project.id, quote.id);

    // Asked prices only: 2 × 12.00 + 3 × 5.00.
    expect(await everywhere(opportunity.id, project.id, quote.id)).toEqual({ amount: '39.00', currency: 'PLN', agreement: 'none' });

    // 2 × 10.00 agreed + 3 × 5.00 asked.
    const v1 = await agree(quote.id, quote.version, [10, null]);
    expect(await everywhere(opportunity.id, project.id, quote.id)).toEqual({ amount: '35.00', currency: 'PLN', agreement: 'partial' });

    // 2 × 10.00 + 3 × 4.50, every line agreed.
    await agree(quote.id, v1, [10, 4.5]);
    expect(await everywhere(opportunity.id, project.id, quote.id)).toEqual({ amount: '33.50', currency: 'PLN', agreement: 'agreed' });
  });

  it('a quote without any price has no amount anywhere — not 0.00', async () => {
    const quote = await createQuote(false);
    const opportunity = await createCrmOpportunity(h, { title: 'Issue 456, unpriced' });
    const project = await createProject(h, { title: 'Issue 456, unpriced', organizationIds: [TEST_ORGANIZATION_ID], visibility: 'everyone' });
    projects.push(project.id);
    await linkBoth(opportunity.id, project.id, quote.id);
    expect(await everywhere(opportunity.id, project.id, quote.id)).toEqual({ amount: null, currency: 'PLN', agreement: 'none' });
  });
});
