import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityQuoteRequestLookupResponseSchema,
  RecordDocumentLookupResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  assignToCrmBook,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * The Quote Requests an Opportunity's link picker chooses from
 * (`specs/143-crm-sales-opportunities/`, User Story 8 — task T101; research
 * N-H2).
 *
 * CRM answers the picker itself, through `quote_requests`' published read
 * port: the Organization's open requests and the one whose number is typed,
 * as `id`, `number`, `status` and nothing else.
 *
 * It asks for `crm:write` **and** `rfqs:handle` (research N-R13, which
 * reverses N-H2 on this point): the answer is Quote Request data, and what
 * another module owns is shown only to somebody who may read it there. The
 * desk's own gate is not widened either way.
 */
describe('crm document lookups (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let reader: Seeded;
  let writer: Seeded;
  /** `crm:write` without the quote desk's code. */
  let crmWriter: Seeded;
  /** The quote desk's code without `crm:write`. */
  let desk: Seeded;
  let rep: Seeded;
  let outsider: Seeded;
  let quote: { id: string; businessId: string };

  const get = (path: string, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: path, cookies });
  const path = (organizationId: string, q = ''): string =>
    `${CRM_API}/lookups/quote-requests?organizationId=${organizationId}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const options = async (url: string, cookies?: Record<string, string>) => {
    const response = await get(url, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityQuoteRequestLookupResponseSchema.parse(response.json()).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Document lookup other');
    reader = await seedCrmAdmin(h.em(), 'doc-lookup-reader', ['crm:read', 'orders:read']);
    writer = await seedCrmAdmin(h.em(), 'doc-lookup-writer', ['crm:read', 'crm:write', 'rfqs:handle']);
    crmWriter = await seedCrmAdmin(h.em(), 'doc-lookup-crm-writer', ['crm:read', 'crm:write']);
    desk = await seedCrmAdmin(h.em(), 'doc-lookup-desk', ['crm:read', 'rfqs:handle']);
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write', 'rfqs:handle']);
    outsider = await seedCrmSalesRep(h.em(), [otherOrganizationId], ['crm:read', 'crm:write', 'rfqs:handle']);
    quote = await submitCrmQuoteRequest(h);
  });

  afterAll(async () => {
    for (const seeded of [reader, writer, crmWriter, desk, rep, outsider]) seeded.undo();
    await teardownBackendServer(h);
  });

  it('is gated crm:write — a link is a write — and rfqs:handle, the code a Quote Request is read with', async () => {
    expect((await get(path(TEST_ORGANIZATION_ID), reader.cookies)).statusCode).toBe(403);
    // Either code alone is not enough.
    expect((await get(path(TEST_ORGANIZATION_ID), crmWriter.cookies)).statusCode).toBe(403);
    expect((await get(path(TEST_ORGANIZATION_ID), desk.cookies)).statusCode).toBe(403);
    expect((await get(path(TEST_ORGANIZATION_ID), writer.cookies)).statusCode).toBe(200);
    // Nobody's gate is widened: the desk's own list still refuses a role without its code.
    expect((await get('/api/v1/admin/quote-requests', crmWriter.cookies)).statusCode).toBe(403);
    expect((await get('/api/v1/admin/quote-requests', CRM_ADMIN)).statusCode).toBe(200);
  });

  it('offers the Organization`s open Quote Requests: id, number and status, nothing else', async () => {
    const found = await options(path(TEST_ORGANIZATION_ID), writer.cookies);
    const mine = found.find((option) => option.id === quote.id);
    expect(mine).toEqual({ id: quote.id, number: quote.businessId, status: 'Pending' });
    const raw = (await get(path(TEST_ORGANIZATION_ID, quote.businessId), writer.cookies)).json() as {
      data: Record<string, unknown>[];
    };
    expect(Object.keys(raw.data[0]!).sort()).toEqual(['id', 'number', 'status']);
  });

  it('searches by number, whatever the case, and answers nothing for a number nobody has', async () => {
    expect(
      (await options(path(TEST_ORGANIZATION_ID, quote.businessId.toLowerCase()), writer.cookies)).map(
        (option) => option.id,
      ),
    ).toEqual([quote.id]);
    expect(await options(path(TEST_ORGANIZATION_ID, 'no-such-number-zz'), writer.cookies)).toEqual([]);
  });

  it('never offers another Organization`s Quote Request, by list or by exact number', async () => {
    expect(await options(path(otherOrganizationId))).toEqual([]);
    expect(await options(path(otherOrganizationId, quote.businessId))).toEqual([]);
  });

  it('answers a confined administrator for their Organizations only', async () => {
    // Positive control: the Organization's own Sales Rep finds it.
    expect((await options(path(TEST_ORGANIZATION_ID), rep.cookies)).some((o) => o.id === quote.id)).toBe(true);
    // Out of reach: an empty list, not a refusal — as the contact lookup answers.
    expect(await options(path(TEST_ORGANIZATION_ID), outsider.cookies)).toEqual([]);
    expect(await options(path(TEST_ORGANIZATION_ID, quote.businessId), outsider.cookies)).toEqual([]);
  });

  it('refuses a request that names no Organization', async () => {
    const response = await get(`${CRM_API}/lookups/quote-requests`, writer.cookies);
    expect(response.statusCode).toBe(400);
  });
});

/**
 * The `@@` document list of an Opportunity's texts
 * (`specs/163-projects-and-tasks/` FR-044, research R-14) — one schema with
 * Projects' (`RecordDocumentLookupResponse`): Orders · Quote Requests · Tasks,
 * each group only for a caller holding its owner's read code (`orders:read`,
 * `rfqs:handle`, `tasks:read`) and only while that owner is present. Orders and
 * Quote Requests are the Opportunity's Organization's; Tasks any the caller may
 * see. Gated `crm:write`: a document is chosen only while writing.
 */
describe('crm document lookups — the @@ list (contract, FR-044)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let own: { id: string };
  let foreign: { id: string };
  let order: { id: string; businessId: string | null };
  let foreignOrder: { id: string; businessId: string | null };
  let quote: { id: string; businessId: string };
  const taskId = randomUUID();
  const TASK_NUMBER = `TSK-L${taskId.slice(0, 8)}`.toUpperCase();
  let everything: Seeded;
  let ordersOnly: Seeded;
  let crmWriter: Seeded;
  let reader: Seeded;
  let outsider: Seeded;

  const url = (params: Record<string, string>): string =>
    `${CRM_API}/lookups/documents?${new URLSearchParams(params).toString()}`;
  const get = (path: string, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: path, cookies });
  const groups = async (path: string, cookies?: Record<string, string>) => {
    const response = await get(path, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return RecordDocumentLookupResponseSchema.parse(response.json()).groups;
  };
  const kinds = (answer: Array<{ kind: string }>): string[] => answer.map((group) => group.kind);
  const ids = (answer: Array<{ kind: string; items: Array<{ id: string }> }>, kind: string): string[] =>
    answer.find((group) => group.kind === kind)?.items.map((item) => item.id) ?? [];

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Document list other');
    own = await createCrmOpportunity(h);
    foreign = await createCrmOpportunity(h, { organizationId: otherOrganizationId });
    order = await seedCrmOrder(h.em());
    foreignOrder = await seedCrmOrder(h.em(), { organizationId: otherOrganizationId });
    quote = await submitCrmQuoteRequest(h);
    await h.orm.em.getConnection().execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "created_at", "updated_at")
       values (?, ?, ?, ?, now(), now())`,
      [taskId, TASK_NUMBER, 'Call the fleet manager', TEST_ADMIN_ID],
    );
    everything = await seedCrmAdmin(h.em(), 'doc-list-all', ['crm:read', 'crm:write', 'orders:read', 'rfqs:handle', 'tasks:read']);
    ordersOnly = await seedCrmAdmin(h.em(), 'doc-list-orders', ['crm:read', 'crm:write', 'orders:read']);
    crmWriter = await seedCrmAdmin(h.em(), 'doc-list-crm', ['crm:read', 'crm:write']);
    reader = await seedCrmAdmin(h.em(), 'doc-list-reader', ['crm:read', 'orders:read', 'rfqs:handle', 'tasks:read']);
    outsider = await seedCrmSalesRep(h.em(), [otherOrganizationId], ['crm:read', 'crm:write', 'orders:read', 'rfqs:handle', 'tasks:read']);
  });

  afterAll(async () => {
    for (const seeded of [everything, ordersOnly, crmWriter, reader, outsider]) seeded?.undo();
    await h.orm.em.getConnection().execute(`delete from "tasks" where "id" = ?`, [taskId]);
    await teardownBackendServer(h);
  });

  it('is gated crm:write', async () => {
    expect((await get(url({ opportunityId: own.id }), reader.cookies)).statusCode).toBe(403);
    expect((await get(url({ opportunityId: own.id }), everything.cookies)).statusCode).toBe(200);
  });

  // `specs/165-task-management/` R-5 added Opportunities — this module's own,
  // offered to every caller, who holds `crm:read` — and Projects, after Tasks.
  it('answers the groups in their order — the Opportunity`s Organization`s Orders and Quote Requests, Tasks and Opportunities', async () => {
    const answer = await groups(url({ opportunityId: own.id }), everything.cookies);
    expect(kinds(answer)).toEqual(['order', 'quote_request', 'task', 'opportunity']);
    expect(ids(answer, 'order')).toContain(order.id);
    expect(ids(answer, 'order')).not.toContain(foreignOrder.id);
    expect(ids(answer, 'quote_request')).toContain(quote.id);
    expect(ids(answer, 'task')).toContain(taskId);
    // A number to insert, and the Task's title beside it.
    expect(answer.find((group) => group.kind === 'order')?.items.find((item) => item.id === order.id)).toEqual({
      id: order.id,
      label: order.businessId,
    });
    expect(answer.find((group) => group.kind === 'quote_request')?.items.find((item) => item.id === quote.id)).toEqual({
      id: quote.id,
      label: quote.businessId,
    });
    expect(answer.find((group) => group.kind === 'task')?.items.find((item) => item.id === taskId)).toEqual({
      id: taskId,
      label: TASK_NUMBER,
      sublabel: 'Call the fleet manager',
    });
    for (const group of answer) expect(group.items.length).toBeLessThanOrEqual(10);
  });

  it('offers another Organization`s Opportunity that Organization`s documents only', async () => {
    const answer = await groups(url({ opportunityId: foreign.id }), everything.cookies);
    expect(ids(answer, 'order')).toContain(foreignOrder.id);
    expect(ids(answer, 'order')).not.toContain(order.id);
    expect(ids(answer, 'quote_request')).not.toContain(quote.id);
  });

  it('narrows every group by what was typed — a number, or a Task`s title', async () => {
    const byOrder = await groups(url({ opportunityId: own.id, q: String(order.businessId) }), everything.cookies);
    expect(ids(byOrder, 'order')).toEqual([order.id]);
    expect(ids(byOrder, 'task')).toEqual([]);
    const byTask = await groups(url({ opportunityId: own.id, q: 'fleet manager' }), everything.cookies);
    expect(ids(byTask, 'task')).toEqual([taskId]);
    expect(ids(byTask, 'order')).toEqual([]);
    const byQuote = await groups(url({ opportunityId: own.id, q: quote.businessId.toLowerCase() }), everything.cookies);
    expect(ids(byQuote, 'quote_request')).toEqual([quote.id]);
  });

  it('offers a group only to a holder of its owner`s read code', async () => {
    expect(kinds(await groups(url({ opportunityId: own.id }), ordersOnly.cookies))).toEqual(['order', 'opportunity']);
    expect(kinds(await groups(url({ opportunityId: own.id }), crmWriter.cookies))).toEqual(['opportunity']);
  });

  it('leaves out the group of a module that is off, and offers it again once it is back', async () => {
    await withModuleOff('tasks', 'deactivated', async () => {
      expect(kinds(await groups(url({ opportunityId: own.id }), everything.cookies))).toEqual(['order', 'quote_request', 'opportunity']);
    });
    await withModuleOff('quote_requests', 'deactivated', async () => {
      expect(kinds(await groups(url({ opportunityId: own.id }), everything.cookies))).toEqual(['order', 'task', 'opportunity']);
    });
    expect(kinds(await groups(url({ opportunityId: own.id }), everything.cookies))).toEqual(['order', 'quote_request', 'task', 'opportunity']);
  });

  // Out of reach means somebody else's book (issue #305): an Organization
  // nobody is assigned to is in every representative's reach. Both cases below
  // put the test Organization in one for themselves (issue #1056) — they used
  // to pass on the assignment the describe above leaves behind.
  it('answers an Opportunity out of the caller`s reach as one that does not exist', async () => {
    const unassign = await assignToCrmBook(h.em(), [TEST_ORGANIZATION_ID]);
    try {
      const hidden = await get(url({ opportunityId: own.id }), outsider.cookies);
      const missing = await get(url({ opportunityId: randomUUID() }), outsider.cookies);
      expect(hidden.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect((hidden.json() as { error: { code: string } }).error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect((missing.json() as { error: { code: string } }).error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    } finally {
      await unassign();
    }
  });

  it('before an Opportunity exists: the chosen Organization`s documents, and Tasks alone without one', async () => {
    const chosen = await groups(url({ organizationId: TEST_ORGANIZATION_ID }), everything.cookies);
    expect(kinds(chosen)).toEqual(['order', 'quote_request', 'task', 'opportunity']);
    expect(ids(chosen, 'order')).toContain(order.id);
    expect(kinds(await groups(url({}), everything.cookies))).toEqual(['task', 'opportunity']);
    // An Organization out of reach has no documents to offer, and is not told apart from none.
    const unassign = await assignToCrmBook(h.em(), [TEST_ORGANIZATION_ID]);
    try {
      expect(kinds(await groups(url({ organizationId: TEST_ORGANIZATION_ID }), outsider.cookies))).toEqual(['task', 'opportunity']);
    } finally {
      await unassign();
    }
  });

  it('refuses a malformed query', async () => {
    expect((await get(url({ opportunityId: 'nope' }), everything.cookies)).statusCode).toBe(400);
    expect((await get(url({ organizationId: 'nope' }), everything.cookies)).statusCode).toBe(400);
  });
});
