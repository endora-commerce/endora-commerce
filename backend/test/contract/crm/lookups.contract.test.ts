import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityAssigneeLookupResponseSchema,
  OpportunityContactLookupResponseSchema,
  OpportunityMentionLookupResponseSchema,
  OpportunityOrganizationLookupResponseSchema,
  OpportunitySalesChannelLookupResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * The pickers of the CRM screens
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10a; research
 * N-D4).
 *
 * The defect this file exists for: a role holding `crm:read` and `orders:read`
 * and nothing else got 403 from the Organization and Sales Channel pickers of
 * the list and the board, because they read `organizations`' and
 * `sales_channels`' own admin lists. What is proven here is both halves of the
 * repair — CRM's lookups answer that role, **and the owners' endpoints still
 * refuse it** — and that an Organization out of the caller's reach is offered
 * by none of them.
 */
describe('crm lookups (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let otherOrganizationName: string;
  let reader: Seeded;
  let writer: Seeded;
  let stranger: Seeded;
  let inactive: Seeded;
  let rep: Seeded;

  const get = (path: string, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: path, cookies });

  const lookup = async (path: string, cookies: Record<string, string> = CRM_ADMIN): Promise<unknown> => {
    const response = await get(`${CRM_API}/lookups/${path}`, cookies);
    expect(response.statusCode, `${path} ${response.body}`).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Lookup other');
    const [organization] = (await h.em().getConnection().execute(
      `select "name" from "organizations" where "id" = ?`,
      [otherOrganizationId],
    )) as Array<{ name: string }>;
    otherOrganizationName = organization!.name;
    // The role of the defect report: read Opportunities and Orders, nothing else.
    reader = await seedCrmAdmin(h.em(), 'lookup-reader', ['crm:read', 'orders:read']);
    writer = await seedCrmAdmin(h.em(), 'lookup-writer', ['crm:read', 'crm:write', 'orders:read']);
    stranger = await seedCrmAdmin(h.em(), 'lookup-stranger', ['orders:read']);
    inactive = await seedCrmAdmin(h.em(), 'lookup-inactive', ['crm:read']);
    const em = h.em();
    const row = await em.findOneOrFail(AdminUser, { id: inactive.adminUserId }, { filters: false });
    row.status = 'inactive';
    await em.flush();
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    for (const seeded of [reader, writer, stranger, inactive, rep]) seeded.undo();
    await teardownBackendServer(h);
  });

  it('answers a role holding only crm:read and orders:read — and refuses one without crm:read', async () => {
    for (const path of ['organizations', 'sales-channels', 'assignees']) {
      await lookup(path, reader.cookies);
      const refused = await get(`${CRM_API}/lookups/${path}`, stranger.cookies);
      expect(refused.statusCode, `${path} ${refused.body}`).toBe(403);
    }
  });

  it('offers contact persons to crm:write only — they are chosen on the forms, not in a filter', async () => {
    const path = `${CRM_API}/lookups/contacts?organizationId=${TEST_ORGANIZATION_ID}`;
    expect((await get(path, reader.cookies)).statusCode).toBe(403);
    expect((await get(path, stranger.cookies)).statusCode).toBe(403);
    expect((await get(path, writer.cookies)).statusCode).toBe(200);
  });

  it('weakens nobody else\'s gate: the owners\' own lists still refuse that role', async () => {
    for (const path of [
      '/api/v1/admin/organizations',
      '/api/v1/admin/sales-channels',
      '/api/v1/admin/admin-users',
      '/api/v1/admin/customers',
    ]) {
      const refused = await get(path, writer.cookies);
      expect(refused.statusCode, `${path} ${refused.body}`).toBe(403);
      // Positive control: the endpoint exists and answers somebody.
      const served = await get(path, CRM_ADMIN);
      expect(served.statusCode, `${path} ${served.body}`).toBe(200);
    }
  });

  describe('organizations', () => {
    const names = async (query: string, cookies?: Record<string, string>): Promise<string[]> =>
      OpportunityOrganizationLookupResponseSchema.parse(
        await lookup(`organizations${query}`, cookies),
      ).data.map((option) => option.name);

    it('searches by name and answers an id and a name, nothing else', async () => {
      const body = OpportunityOrganizationLookupResponseSchema.parse(
        await lookup(`organizations?q=${encodeURIComponent(otherOrganizationName)}`, reader.cookies),
      );
      expect(body.data).toEqual([{ id: otherOrganizationId, name: otherOrganizationName }]);
      const raw = (await lookup(
        `organizations?q=${encodeURIComponent(otherOrganizationName)}`,
        reader.cookies,
      )) as { data: Record<string, unknown>[] };
      expect(Object.keys(raw.data[0]!).sort()).toEqual(['id', 'name']);
    });

    it('answers one Organization by id — the label of a preselection', async () => {
      expect(await names(`?id=${otherOrganizationId}`)).toEqual([otherOrganizationName]);
      expect(await names('?id=00000000-0000-4000-8000-00000000dead')).toEqual([]);
    });

    it('offers a confined administrator only the Organizations they may reach', async () => {
      // Positive control: the platform administrator finds it.
      expect(await names(`?q=${encodeURIComponent(otherOrganizationName)}`)).toEqual([
        otherOrganizationName,
      ]);
      expect(await names(`?q=${encodeURIComponent(otherOrganizationName)}`, rep.cookies)).toEqual([]);
      expect(await names(`?id=${otherOrganizationId}`, rep.cookies)).toEqual([]);
      const reachable = OpportunityOrganizationLookupResponseSchema.parse(
        await lookup('organizations', rep.cookies),
      ).data;
      expect(reachable.map((option) => option.id)).toEqual([TEST_ORGANIZATION_ID]);
    });

    it('honours limit and refuses a malformed query', async () => {
      expect((await names('?limit=1')).length).toBe(1);
      for (const query of ['?limit=0', '?limit=51', '?id=nope']) {
        const response = await get(`${CRM_API}/lookups/organizations${query}`);
        expect(response.statusCode, `${query} ${response.body}`).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  it('lists the sales channels with their per-language names, the default one included', async () => {
    const [channel] = (await h.em().getConnection().execute(
      `select "id", "code" from "sales_channels" where "system_default" = true limit 1`,
    )) as Array<{ id: string; code: string }>;
    const body = OpportunitySalesChannelLookupResponseSchema.parse(
      await lookup('sales-channels', reader.cookies),
    );
    const found = body.data.find((option) => option.id === channel!.id);
    expect(found).toMatchObject({ id: channel!.id, code: channel!.code, active: true });
    // The currencies a channel sells in are what the create form offers.
    expect(found!.systemDefault).toBe(true);
    expect(found!.currencies).toContain(found!.defaultCurrency);
    expect(typeof found!.name).toBe('object');
  });

  describe('assignees', () => {
    const ids = async (query = ''): Promise<string[]> =>
      OpportunityAssigneeLookupResponseSchema.parse(
        await lookup(`assignees${query}`, reader.cookies),
      ).data.map((option) => option.id);

    it('offers active administrators by name and never a deactivated one', async () => {
      const found = await ids('?q=lookup-&limit=50');
      expect(found).toContain(reader.adminUserId);
      expect(found).toContain(writer.adminUserId);
      // Positive control for the exclusion: the search does match that account's name.
      expect(found).not.toContain(inactive.adminUserId);
      const raw = (await lookup('assignees?q=lookup-reader', reader.cookies)) as {
        data: Record<string, unknown>[];
      };
      expect(raw.data.length).toBeGreaterThan(0);
      // A name to choose by; no e-mail address, no role.
      expect(Object.keys(raw.data[0]!).sort()).toEqual(['id', 'name']);
    });

    it('answers nothing for a search nobody matches', async () => {
      expect(await ids('?q=nobody-is-called-this')).toEqual([]);
    });
  });

  // User Story 18 — who a text may mention.
  describe('mentionable', () => {
    const options = async (query = '', cookies: Record<string, string> = writer.cookies) =>
      OpportunityMentionLookupResponseSchema.parse(await lookup(`mentionable${query}`, cookies)).data;
    const ids = async (query = '', cookies?: Record<string, string>): Promise<string[]> =>
      (await options(query, cookies)).map((option) => option.id);
    /**
     * A search that matches one seeded administrator and nobody else: the
     * surname carries a random suffix. Other files of a run seed people too, so
     * a search by a shared prefix could push this one past the limit.
     */
    const only = async (seeded: Seeded): Promise<string> => {
      const row = await h.em().findOneOrFail(AdminUser, { id: seeded.adminUserId }, { filters: false });
      return `q=${encodeURIComponent(row.lastName)}`;
    };

    it('is offered to crm:write — where a text is written — and refused without it', async () => {
      const path = `${CRM_API}/lookups/mentionable`;
      expect((await get(path, writer.cookies)).statusCode).toBe(200);
      expect((await get(path, reader.cookies)).statusCode).toBe(403);
      expect((await get(path, stranger.cookies)).statusCode).toBe(403);
    });

    it('offers active administrators who hold crm:read — never one without it, never a deactivated one', async () => {
      const found = await ids('?q=lookup-&limit=50');
      expect(found).toContain(reader.adminUserId);
      expect(found).toContain(writer.adminUserId);
      // Positive controls for the two exclusions: the search does match both names.
      expect(found).not.toContain(stranger.adminUserId);
      expect(found).not.toContain(inactive.adminUserId);
    });

    it('answers an id and a name — no e-mail address, no role', async () => {
      const raw = (await lookup(`mentionable?${await only(reader)}`, writer.cookies)) as {
        data: Record<string, unknown>[];
      };
      expect(raw.data).toHaveLength(1);
      expect(Object.keys(raw.data[0]!).sort()).toEqual(['id', 'name']);
      expect(JSON.stringify(raw)).not.toContain('@');
    });

    it('with an Organization, offers only people who may see it', async () => {
      // The Sales Rep is confined to the test Organization.
      const theRep = await only(rep);
      expect(await ids(`?${theRep}&organizationId=${TEST_ORGANIZATION_ID}`)).toEqual([rep.adminUserId]);
      expect(await ids(`?${theRep}&organizationId=${otherOrganizationId}`, CRM_ADMIN)).toEqual([]);
      // Positive control for the exclusion: without an Organization the same search finds them.
      expect(await ids(`?${theRep}`)).toEqual([rep.adminUserId]);
      // Somebody who reaches every Organization is offered for both.
      const theReader = await only(reader);
      expect(await ids(`?${theReader}&organizationId=${otherOrganizationId}`, CRM_ADMIN)).toEqual([
        reader.adminUserId,
      ]);
      expect(await ids(`?${theReader}&organizationId=${TEST_ORGANIZATION_ID}`)).toEqual([reader.adminUserId]);
    });

    it('offers nobody for an Organization the caller may not reach', async () => {
      expect(await ids(`?organizationId=${otherOrganizationId}`, rep.cookies)).toEqual([]);
      // Positive control: the same caller is answered for their own.
      expect((await ids(`?organizationId=${TEST_ORGANIZATION_ID}&limit=50`, rep.cookies)).length).toBeGreaterThan(0);
    });

    it('honours limit, answers nothing for a search nobody matches, refuses a malformed query', async () => {
      expect(await options('?q=lookup-&limit=1')).toHaveLength(1);
      expect(await ids('?q=nobody-is-called-this')).toEqual([]);
      const refused = await get(`${CRM_API}/lookups/mentionable?organizationId=nope`, writer.cookies);
      expect(refused.statusCode).toBe(400);
    });
  });

  describe('contacts', () => {
    const contacts = async (organizationId: string, cookies: Record<string, string>, q = '') =>
      OpportunityContactLookupResponseSchema.parse(
        await lookup(`contacts?organizationId=${organizationId}${q}`, cookies),
      ).data;

    it('offers the members of the Organization, with name and e-mail', async () => {
      const found = await contacts(TEST_ORGANIZATION_ID, writer.cookies);
      expect(found.map((option) => option.id)).toContain(TEST_CUSTOMER_ID);
      const bySearch = await contacts(TEST_ORGANIZATION_ID, writer.cookies, '&q=stub-customer');
      expect(bySearch.map((option) => option.id)).toContain(TEST_CUSTOMER_ID);
      expect(await contacts(TEST_ORGANIZATION_ID, writer.cookies, '&q=nobody-is-called-this')).toEqual([]);
    });

    it('offers nobody of an Organization the caller may not reach', async () => {
      // Positive control: the confined administrator is offered their own Organization's members.
      expect((await contacts(TEST_ORGANIZATION_ID, rep.cookies)).map((option) => option.id)).toContain(
        TEST_CUSTOMER_ID,
      );
      expect(await contacts(otherOrganizationId, rep.cookies)).toEqual([]);
    });

    it('requires the Organization', async () => {
      const response = await get(`${CRM_API}/lookups/contacts`, writer.cookies);
      expect(response.statusCode, response.body).toBe(400);
    });
  });
});
