import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formEntriesDeleteResponseSchema,
  formEntryDetailSchema,
  formEntryListResponseSchema,
  formEntryNoteSchema,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  FORMS_ADMIN,
  deleteForms,
  insertFormEntry,
  publishEntriesForm,
  type PublishedForm,
} from '../../helpers/seed-forms.js';

/**
 * `specs/170-forms-module/` T070 — every row of `contracts/admin-api.md` §2: each gate answered
 * **before** validation (401 without a session, 403 without the code — `forms:entries_read`,
 * `forms:entries_write`, `forms:entries_export`), each request schema (400), each answer parsed
 * with the contracts schema, `FORM_ENTRY_NOT_FOUND` and `FORM_ENTRY_STATUS_CONFLICT`, and the CSV's
 * content type and disposition.
 *
 * The API lives under `/api/v1/admin/forms/entries` (lead decision, 2026-11-02), beside the
 * parametric `/api/v1/admin/forms/:id`: the static segment must win, which a `forms:read`-only
 * reader proves — refused 403 on the entries list, where the form-by-id handler would answer 404.
 */
describe('forms admin API (contract) — §2 Entries', () => {
  let h: BackendServerHandle;
  const API = '/api/v1/admin/forms/entries';
  const MISSING = '00000000-0000-4000-8000-0000000170e9';
  type Session = { cookies: { b2b_session: string }; undo: () => void };
  let nobody: Session;
  let formsReader: Session;
  let entriesReader: Session;
  let entriesWriter: Session;
  let form: PublishedForm;
  let channelId: string;
  let entryId: string;
  const created: string[] = [];

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  function call(
    method: Method,
    path: string,
    options: { payload?: unknown; cookies?: Record<string, string> | null } = {},
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      ...(options.cookies === null ? {} : { cookies: options.cookies ?? FORMS_ADMIN }),
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });
  }

  const errorOf = (response: LightMyRequestResponse) =>
    (response.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  const dataOf = (response: LightMyRequestResponse) => (response.json() as { data: unknown }).data;

  async function seedEntry(overrides: { status?: 'new' | 'read' | 'closed' | 'spam' } = {}): Promise<string> {
    return insertFormEntry(h, {
      form,
      salesChannelId: channelId,
      submittedAt: new Date(),
      answers: { name: 'Ada', email: 'ada@example.com', privacy: true },
      consents: [{ fieldKey: 'privacy', kind: 'privacy', given: true, text: '<p>I accept the privacy policy</p>' }],
      submitterEmail: 'ada@example.com',
      searchText: 'ada\nada@example.com',
      pageUrl: '/contact',
      ...overrides,
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    nobody = await seedCrmAdmin(h.em(), 'forms-entries-nobody', ['orders:read']);
    formsReader = await seedCrmAdmin(h.em(), 'forms-only-reader', ['forms:read']);
    entriesReader = await seedCrmAdmin(h.em(), 'forms-entries-reader', ['forms:entries_read']);
    entriesWriter = await seedCrmAdmin(h.em(), 'forms-entries-writer', ['forms:entries_read', 'forms:entries_write']);
    channelId = (await h.em().fork().findOneOrFail(SalesChannel, { code: 'default' })).id;
    form = await publishEntriesForm(h, `Entries contract ${randomUUID().slice(0, 8)}`);
    created.push(form.detail.id);
    entryId = await seedEntry();
  }, 60_000);

  afterAll(async () => {
    for (const session of [nobody, formsReader, entriesReader, entriesWriter]) session?.undo();
    if (h) await deleteForms(h, created);
    await teardownBackendServer(h);
  });

  describe('gates (before validation)', () => {
    const reads: Array<[Method, string]> = [
      ['GET', ''],
      ['GET', `/${MISSING}`],
      ['POST', `/${MISSING}/mark-read`],
    ];
    const writes: Array<[Method, string]> = [
      ['PATCH', `/${MISSING}/status`],
      ['POST', `/${MISSING}/notes`],
      ['DELETE', `/${MISSING}`],
      ['POST', '/delete'],
    ];
    const all = [...reads, ...writes, ['GET', '/export'] as [Method, string]];

    it.each(all)('%s %s answers 401 without a session', async (method, path) => {
      const response = await call(method, path, { cookies: null, payload: { not: 'valid' } });
      expect(response.statusCode, response.body).toBe(401);
    });

    it.each(all)('%s %s answers 403 without the code', async (method, path) => {
      const response = await call(method, path, { cookies: nobody.cookies, payload: { not: 'valid' } });
      expect(response.statusCode, response.body).toBe(403);
    });

    it.each(writes)('%s %s needs forms:entries_write, not only forms:entries_read', async (method, path) => {
      const response = await call(method, path, { cookies: entriesReader.cookies, payload: { not: 'valid' } });
      expect(response.statusCode, response.body).toBe(403);
    });

    it('the export needs forms:entries_export, not only the read and write codes', async () => {
      const response = await call('GET', `/export?formId=${form.detail.id}`, { cookies: entriesWriter.cookies });
      expect(response.statusCode, response.body).toBe(403);
    });

    it('GET /forms/entries is the entries list, never the form-by-id handler (static before parametric)', async () => {
      const refused = await call('GET', '', { cookies: formsReader.cookies });
      expect(refused.statusCode, refused.body).toBe(403);
      const listed = await call('GET', '', { cookies: entriesReader.cookies });
      expect(listed.statusCode, listed.body).toBe(200);
      formEntryListResponseSchema.parse(dataOf(listed));
      // And `/forms/:id` still answers for a form.
      const byId = await h.app.inject({ method: 'GET', url: `/api/v1/admin/forms/${form.detail.id}`, cookies: FORMS_ADMIN });
      expect(byId.statusCode, byId.body).toBe(200);
    });
  });

  describe('requests and answers', () => {
    it('GET lists entries in the contracts shape', async () => {
      const response = await call('GET', `?formId=${form.detail.id}&status=new&status=read&limit=10`);
      expect(response.statusCode, response.body).toBe(200);
      const list = formEntryListResponseSchema.parse(dataOf(response));
      expect(list.items.map((item) => item.id)).toContain(entryId);
      expect(list.items.find((item) => item.id === entryId)).toMatchObject({
        formId: form.detail.id,
        formName: form.detail.name,
        formVersion: 1,
        attributed: false,
      });
    });

    it.each([
      ['a page size over 100', '?limit=101'],
      ['an unknown status', '?status=archived'],
      ['a malformed form id', '?formId=nope'],
      ['an unknown query key', '?colour=red'],
      ['a malformed cursor', '?cursor=%%%'],
    ])('GET refuses %s with 400', async (_name, query) => {
      const response = await call('GET', query);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('GET /:id answers the detail in the contracts shape', async () => {
      const response = await call('GET', `/${entryId}`);
      expect(response.statusCode, response.body).toBe(200);
      const detail = formEntryDetailSchema.parse(dataOf(response));
      expect(detail).toMatchObject({ id: entryId, status: 'new', pageUrl: '/contact', customerAccountId: null, notes: [] });
    });

    it.each([
      ['a missing id', `/${MISSING}`],
      ['a malformed id', '/not-a-uuid'],
    ])('GET answers 404 FORM_ENTRY_NOT_FOUND for %s', async (_name, path) => {
      const response = await call('GET', path);
      expect(response.statusCode, response.body).toBe(404);
      expect(errorOf(response).code).toBe('FORM_ENTRY_NOT_FOUND');
    });

    it('POST /:id/mark-read answers the detail', async () => {
      const id = await seedEntry();
      const response = await call('POST', `/${id}/mark-read`);
      expect(response.statusCode, response.body).toBe(200);
      expect(formEntryDetailSchema.parse(dataOf(response)).status).toBe('read');
    });

    it('PATCH /:id/status answers the detail, and 409 FORM_ENTRY_STATUS_CONFLICT when the entry moved', async () => {
      const id = await seedEntry();
      const moved = await call('PATCH', `/${id}/status`, { payload: { status: 'closed', expectedStatus: 'new' } });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(formEntryDetailSchema.parse(dataOf(moved)).status).toBe('closed');
      const stale = await call('PATCH', `/${id}/status`, { payload: { status: 'spam', expectedStatus: 'new' } });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(errorOf(stale)).toMatchObject({ code: 'FORM_ENTRY_STATUS_CONFLICT', details: { status: 'closed' } });
    });

    it.each([
      ['an unknown status', { status: 'archived', expectedStatus: 'new' }],
      ['no expected status', { status: 'read' }],
      ['an unknown key', { status: 'read', expectedStatus: 'new', note: 'x' }],
    ])('PATCH /:id/status refuses %s with 400', async (_name, payload) => {
      const response = await call('PATCH', `/${entryId}/status`, { payload });
      expect(response.statusCode, response.body).toBe(400);
    });

    it('POST /:id/notes answers 201 with the note, and refuses an empty or over-long body', async () => {
      const response = await call('POST', `/${entryId}/notes`, { payload: { body: 'Called back.' } });
      expect(response.statusCode, response.body).toBe(201);
      expect(formEntryNoteSchema.parse(dataOf(response))).toMatchObject({ body: 'Called back.' });
      expect((await call('POST', `/${entryId}/notes`, { payload: { body: '   ' } })).statusCode).toBe(400);
      expect((await call('POST', `/${entryId}/notes`, { payload: { body: 'x'.repeat(5001) } })).statusCode).toBe(400);
      const missing = await call('POST', `/${MISSING}/notes`, { payload: { body: 'Hello' } });
      expect(missing.statusCode, missing.body).toBe(404);
      expect(errorOf(missing).code).toBe('FORM_ENTRY_NOT_FOUND');
    });

    it('DELETE /:id answers 204, and 404 FORM_ENTRY_NOT_FOUND once gone', async () => {
      const id = await seedEntry();
      const response = await call('DELETE', `/${id}`);
      expect(response.statusCode, response.body).toBe(204);
      const again = await call('DELETE', `/${id}`);
      expect(again.statusCode).toBe(404);
      expect(errorOf(again).code).toBe('FORM_ENTRY_NOT_FOUND');
    });

    it('POST /delete answers the count, skipping a missing id; refuses an empty or oversized list', async () => {
      const id = await seedEntry();
      const response = await call('POST', '/delete', { payload: { ids: [id, MISSING] } });
      expect(response.statusCode, response.body).toBe(200);
      expect(formEntriesDeleteResponseSchema.parse(dataOf(response))).toEqual({ deleted: 1 });
      expect((await call('POST', '/delete', { payload: { ids: [] } })).statusCode).toBe(400);
      const tooMany = Array.from({ length: 201 }, () => randomUUID());
      expect((await call('POST', '/delete', { payload: { ids: tooMany } })).statusCode).toBe(400);
    });

    it('GET /export streams CSV with its disposition, and requires the form', async () => {
      const response = await call('GET', `/export?formId=${form.detail.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(`attachment; filename="form-${form.detail.key}-entries.csv"`);
      expect(response.body.startsWith('﻿entry_id,form_key,form_version,status,sales_channel,language,submitted_at,page_url')).toBe(
        true,
      );
      const withoutForm = await call('GET', '/export');
      expect(withoutForm.statusCode, withoutForm.body).toBe(400);
    });
  });
});
