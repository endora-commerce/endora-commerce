import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formEntryListResponseSchema } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import {
  FORMS_ADMIN,
  deleteForms,
  insertFormEntry,
  publishEntriesForm,
  readEntryRow,
  type PublishedForm,
} from '../../helpers/seed-forms.js';

/**
 * `specs/170-forms-module/` T072 — the Principle XI review of `research.md`, held at the HTTP
 * surface (US4-6, FR-046): an administrator scoped to organisation A sees A's entries in the list,
 * the search and the export, never B's and never an anonymous one; every route on one entry answers
 * an out-of-scope or anonymous id with **the same** `404` as a missing one; a bulk delete skips them
 * without saying so; and deleting a form whose entries cross tenants needs an unrestricted scope
 * (`403 FORM_SCOPE_REQUIRED`) as well as `forms:entries_write`.
 *
 * The retention half of the scope rule (`PUT …/retention`) is User Story 9's route (T118, T125).
 */
describe('forms entries — cross-tenant isolation (Principle XI, FR-046)', () => {
  let h: BackendServerHandle;
  const API = '/api/v1/admin/forms/entries';
  const RUN = randomUUID().slice(0, 8);
  const MISSING = '00000000-0000-4000-8000-0000000170e8';
  const PERMISSIONS = ['forms:read', 'forms:write', 'forms:entries_read', 'forms:entries_write', 'forms:entries_export'];
  type Session = { cookies: { b2b_session: string }; undo: () => void };
  let scoped: Session;
  let formsWriterOnly: Session;
  let form: PublishedForm;
  let channelId: string;
  let orgA: string;
  let orgB: string;
  const entry: Record<'a' | 'b' | 'anonymous', string> = { a: '', b: '', anonymous: '' };
  const created: string[] = [];

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookies: Record<string, string>,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  /** The refusal without its request id — what must be identical across the cases. */
  function refusalOf(response: LightMyRequestResponse): unknown {
    const { requestId: _requestId, ...rest } = (response.json() as { error: Record<string, unknown> }).error;
    return { status: response.statusCode, ...rest };
  }

  const seed = (owner: { customerAccountId: string; organizationId: string } | null, name: string) =>
    insertFormEntry(h, {
      form,
      salesChannelId: channelId,
      submittedAt: new Date(),
      answers: { name },
      submitterEmail: `${name}@tenancy-${RUN}.test`,
      searchText: `${name} tenancy-${RUN}`,
      owner,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.em().fork().findOneOrFail(SalesChannel, { code: 'default' })).id;
    orgA = await seedCrmOrganization(h.em(), `forms-a-${RUN}`);
    orgB = await seedCrmOrganization(h.em(), `forms-b-${RUN}`);
    scoped = await seedCrmSalesRep(h.em(), [orgA], PERMISSIONS);
    formsWriterOnly = await seedCrmAdmin(h.em(), 'forms-writer-only', ['forms:read', 'forms:write', 'forms:entries_read']);
    form = await publishEntriesForm(h, `Tenancy ${RUN}`);
    created.push(form.detail.id);
    entry.a = await seed({ customerAccountId: randomUUID(), organizationId: orgA }, 'alice');
    entry.b = await seed({ customerAccountId: randomUUID(), organizationId: orgB }, 'bob');
    entry.anonymous = await seed(null, 'anon');
  }, 90_000);

  afterAll(async () => {
    scoped?.undo();
    formsWriterOnly?.undo();
    if (h) await deleteForms(h, created);
    await teardownBackendServer(h);
  });

  it('lists only the scope’s entries, never an anonymous one (US4-6)', async () => {
    const response = await call('GET', `?formId=${form.detail.id}`, scoped.cookies);
    expect(response.statusCode, response.body).toBe(200);
    const page = formEntryListResponseSchema.parse((response.json() as { data: unknown }).data);
    expect(page.items.map((item) => item.id)).toEqual([entry.a]);
    // The unrestricted administrator sees all three.
    const all = await call('GET', `?formId=${form.detail.id}`, FORMS_ADMIN);
    expect((formEntryListResponseSchema.parse((all.json() as { data: unknown }).data).items).length).toBe(3);
  });

  it('searches within the scope only', async () => {
    const response = await call('GET', `?q=${encodeURIComponent(`tenancy-${RUN}`)}`, scoped.cookies);
    const page = formEntryListResponseSchema.parse((response.json() as { data: unknown }).data);
    expect(page.items.map((item) => item.id)).toEqual([entry.a]);
  });

  it('exports within the scope only', async () => {
    const response = await call('GET', `/export?formId=${form.detail.id}`, scoped.cookies);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain(entry.a);
    expect(response.body).not.toContain(entry.b);
    expect(response.body).not.toContain(entry.anonymous);
  });

  describe.each([
    ['another organisation’s entry', () => entry.b],
    ['an anonymous entry', () => entry.anonymous],
  ])('%s answers exactly like a missing one', (_name, idOf) => {
    it.each<[string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown]>([
      ['the detail', 'GET', '', undefined],
      ['mark-read', 'POST', '/mark-read', undefined],
      ['a status change', 'PATCH', '/status', { status: 'closed', expectedStatus: 'new' }],
      ['a note', 'POST', '/notes', { body: 'A note' }],
      ['a delete', 'DELETE', '', undefined],
    ])('%s', async (_route, method, suffix, payload) => {
      const outOfScope = await call(method, `/${idOf()}${suffix}`, scoped.cookies, payload);
      const missing = await call(method, `/${MISSING}${suffix}`, scoped.cookies, payload);
      expect(outOfScope.statusCode, outOfScope.body).toBe(404);
      expect(refusalOf(outOfScope)).toEqual(refusalOf(missing));
      expect((await readEntryRow(h, idOf()))!['status']).toBe('new');
    });
  });

  it('skips out-of-scope and anonymous ids in a bulk delete without saying so', async () => {
    const mine = await seed({ customerAccountId: randomUUID(), organizationId: orgA }, 'alice2');
    const response = await call('POST', '/delete', scoped.cookies, { ids: [mine, entry.b, entry.anonymous] });
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { data: unknown }).data).toEqual({ deleted: 1 });
    expect(await readEntryRow(h, mine)).toBeUndefined();
    expect(await readEntryRow(h, entry.b)).toBeDefined();
    expect(await readEntryRow(h, entry.anonymous)).toBeDefined();
  });

  describe('deleting a form whose entries cross tenants (T079, research Principle XI review)', () => {
    const remove = (target: PublishedForm, cookies: Record<string, string>, confirm: boolean) =>
      h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/forms/${target.detail.id}?expectedRevision=${target.detail.revision}${confirm ? '&confirmEntriesDeletion=true' : ''}`,
        cookies,
      });

    it('is refused 409 FORM_HAS_ENTRIES without the confirmation', async () => {
      const response = await remove(form, FORMS_ADMIN, false);
      expect(response.statusCode, response.body).toBe(409);
      expect((response.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
        code: 'FORM_HAS_ENTRIES',
        details: { entryCount: 3 },
      });
    });

    it('is refused 403 FORM_SCOPE_REQUIRED to a scoped administrator, and deletes nothing', async () => {
      const response = await remove(form, scoped.cookies, true);
      expect(response.statusCode, response.body).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe('FORM_SCOPE_REQUIRED');
      expect(await readEntryRow(h, entry.b)).toBeDefined();
    });

    it('needs forms:entries_write as well as forms:write', async () => {
      const response = await remove(form, formsWriterOnly.cookies, true);
      expect(response.statusCode, response.body).toBe(403);
      expect(await readEntryRow(h, entry.a)).toBeDefined();
    });

    it('deletes the form with every entry and note for an unrestricted administrator who confirms', async () => {
      await call('POST', `/${entry.b}/notes`, FORMS_ADMIN, { body: 'note' });
      const response = await remove(form, FORMS_ADMIN, true);
      expect(response.statusCode, response.body).toBe(204);
      for (const id of Object.values(entry)) expect(await readEntryRow(h, id)).toBeUndefined();
    });
  });
});
