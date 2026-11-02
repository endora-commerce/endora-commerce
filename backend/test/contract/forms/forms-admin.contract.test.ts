import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formDetailSchema,
  formListResponseSchema,
  formPreviewResponseSchema,
  formVersionResponseSchema,
  formVersionsResponseSchema,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T027 — every row of `contracts/admin-api.md` §1 but the retention rows
 * (User Story 9; the notifications row is T083's, User Story 5): each gate answered **before** validation (401 without a
 * session, 403 without the code), each request schema (400), each answer parsed with the contracts
 * schema, and each refusal by its code.
 */
describe('forms admin API (contract) — §1 Forms', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  let nobody: { cookies: { b2b_session: string }; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/forms';
  const LANGUAGE = 'en-US';
  const created: string[] = [];

  type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
  function call(
    method: Method,
    path: string,
    options: { payload?: unknown; cookies?: Record<string, string> | null } = {},
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      ...(options.cookies === null ? {} : { cookies: options.cookies ?? admin }),
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });
  }

  function errorOf(response: LightMyRequestResponse): { code: string; details?: Record<string, unknown> } {
    return (response.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  async function create(name: string, key?: string): Promise<FormDetail> {
    const response = await call('POST', '', { payload: { name, defaultLanguage: LANGUAGE, ...(key ? { key } : {}) } });
    expect(response.statusCode, response.body).toBe(201);
    const detail = detailOf(response);
    created.push(detail.id);
    return detail;
  }

  /** A definition `definitionIssues` accepts: one labelled text field. */
  function publishable(sectionId: string): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [{ id: sectionId, columns: 1, fields: [{ id: 'name_field', type: 'text', key: 'name' }] }],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: { [LANGUAGE]: { 'fields.name_field.label': 'Name' } },
    };
  }

  async function save(form: FormDetail, definition: FormDefinitionInput): Promise<FormDetail> {
    const response = await call('PUT', `/${form.id}`, { payload: { expectedRevision: form.revision, definition } });
    expect(response.statusCode, response.body).toBe(200);
    return detailOf(response);
  }

  async function published(name: string): Promise<FormDetail> {
    const draft = await create(name);
    const saved = await save(draft, publishable(draft.definition.sections[0]!.id));
    const response = await call('POST', `/${saved.id}/publish`, { payload: { expectedRevision: saved.revision } });
    expect(response.statusCode, response.body).toBe(200);
    return detailOf(response);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), 'forms-reader', ['forms:read']);
    nobody = await seedCrmAdmin(h.em(), 'forms-nobody', ['orders:read']);
  });

  afterAll(async () => {
    reader?.undo();
    nobody?.undo();
    if (created.length > 0) {
      await withSystemScope('forms contract test: clean up', async () => {
        await h
          .em()
          .getConnection()
          .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
      });
    }
    await teardownBackendServer(h);
  });

  describe('gates (before validation)', () => {
    const ID = '00000000-0000-4000-8000-0000000170f1';
    const reads = ['', `/${ID}`, `/${ID}/versions`, `/${ID}/versions/1`, `/${ID}/preview`];
    const writes: Array<[Method, string]> = [
      ['POST', ''],
      ['PUT', `/${ID}`],
      ['POST', `/${ID}/publish`],
      ['POST', `/${ID}/close`],
      ['POST', `/${ID}/reopen`],
      ['POST', `/${ID}/duplicate`],
      ['DELETE', `/${ID}?expectedRevision=1`],
      ['PUT', `/${ID}/notifications`],
    ];

    it('every route answers 401 without a session', async () => {
      for (const path of reads) {
        expect((await call('GET', path, { cookies: null })).statusCode, `GET ${path}`).toBe(401);
      }
      for (const [method, path] of writes) {
        const payload = method === 'DELETE' ? undefined : { nonsense: true };
        expect((await call(method, path, { cookies: null, payload })).statusCode, `${method} ${path}`).toBe(401);
      }
    });

    it('reads need forms:read, writes forms:write — 403 before the body is looked at', async () => {
      for (const path of reads) {
        expect((await call('GET', path, { cookies: nobody.cookies })).statusCode, `GET ${path}`).toBe(403);
      }
      for (const [method, path] of writes) {
        const payload = method === 'DELETE' ? undefined : { nonsense: true };
        const response = await call(method, path, { cookies: reader.cookies, payload });
        expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(403);
      }
    });
  });

  describe('GET / and POST /', () => {
    it('creates a draft with a derived key, the default language and one empty one-column section', async () => {
      const detail = await create('Contact the shop');
      expect(detail).toMatchObject({ status: 'draft', key: 'contact_the_shop', defaultLanguage: LANGUAGE, revision: 1 });
      expect(detail.publishedVersionNumber).toBe(0);
      expect(detail.publishedDefinition).toBeNull();
      expect(detail.definition.sections).toHaveLength(1);
      expect(detail.definition.sections[0]).toMatchObject({ columns: 1, fields: [] });
    });

    it('suffixes a derived key that is taken, and refuses a chosen key that is taken (409 FORM_KEY_TAKEN)', async () => {
      const first = await create('Quote request');
      const second = await create('Quote request');
      expect(second.key).not.toBe(first.key);
      expect(second.key.startsWith(first.key)).toBe(true);
      const response = await call('POST', '', { payload: { name: 'Other', key: first.key, defaultLanguage: LANGUAGE } });
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('FORM_KEY_TAKEN');
    });

    it('refuses a malformed body (400) and a language no storefront serves (400)', async () => {
      expect((await call('POST', '', { payload: { name: '' } })).statusCode).toBe(400);
      expect((await call('POST', '', { payload: { name: 'X', defaultLanguage: LANGUAGE, extra: 1 } })).statusCode).toBe(400);
      const response = await call('POST', '', { payload: { name: 'X', defaultLanguage: 'xx-XX' } });
      expect(response.statusCode).toBe(400);
    });

    it('lists forms with their summary, filtered by status and text, paged', async () => {
      const form = await create('Listed form');
      const response = await call('GET', `?q=${encodeURIComponent('Listed form')}&status=draft&page=1&pageSize=5`);
      expect(response.statusCode, response.body).toBe(200);
      const list = formListResponseSchema.parse((response.json() as { data: unknown }).data);
      expect(list.items.map((item) => item.id)).toContain(form.id);
      expect(list.items.every((item) => item.status === 'draft')).toBe(true);
      expect((await call('GET', '?pageSize=500')).statusCode).toBe(400);
      expect((await call('GET', '', { cookies: reader.cookies })).statusCode).toBe(200);
    });
  });

  describe('GET /:id and PUT /:id', () => {
    it('404 FORM_NOT_FOUND for an unknown or malformed id', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const response = await call('GET', `/${id}`);
        expect(response.statusCode).toBe(404);
        expect(errorOf(response).code).toBe('FORM_NOT_FOUND');
      }
    });

    it('saves a shape-valid working copy, bumping the revision; a stale revision is 409 FORM_REVISION_CONFLICT', async () => {
      const form = await create('Saved form');
      const read = await call('GET', `/${form.id}`, { cookies: reader.cookies });
      expect(read.statusCode).toBe(200);
      detailOf(read);
      const saved = await save(form, publishable(form.definition.sections[0]!.id));
      expect(saved.revision).toBe(form.revision + 1);
      const stale = await call('PUT', `/${form.id}`, { payload: { expectedRevision: form.revision, name: 'Late' } });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe('FORM_REVISION_CONFLICT');
    });

    it('refuses an ill-shaped definition (400) and a key another form holds (409 FORM_KEY_TAKEN)', async () => {
      const form = await create('Shape form');
      const other = await create('Other shape form');
      const bad = await call('PUT', `/${form.id}`, {
        payload: { expectedRevision: form.revision, definition: { schemaVersion: 1, sections: [], recipients: [] } },
      });
      expect(bad.statusCode).toBe(400);
      const taken = await call('PUT', `/${form.id}`, { payload: { expectedRevision: form.revision, key: other.key } });
      expect(taken.statusCode).toBe(409);
      expect(errorOf(taken).code).toBe('FORM_KEY_TAKEN');
    });
  });

  describe('publish, close, reopen, duplicate, delete', () => {
    it('refuses to publish a definition that breaks a rule — 400 FORM_DEFINITION_INVALID with details.issues', async () => {
      const form = await create('Unlabelled');
      const definition = publishable(form.definition.sections[0]!.id);
      definition.texts = {};
      const saved = await save(form, definition);
      const response = await call('POST', `/${form.id}/publish`, { payload: { expectedRevision: saved.revision } });
      expect(response.statusCode).toBe(400);
      const error = errorOf(response);
      expect(error.code).toBe('FORM_DEFINITION_INVALID');
      expect(error.details?.['issues']).toEqual([
        { code: 'missing_default_language_label', elementId: 'name_field', path: expect.any(String) },
      ]);
    });

    it('publishes version 1, closes, reopens — each answering the detail', async () => {
      const form = await published('Lifecycle');
      expect(form).toMatchObject({ status: 'published', publishedVersionNumber: 1 });
      expect(form.publishedDefinition).not.toBeNull();
      const closed = await call('POST', `/${form.id}/close`, { payload: { expectedRevision: form.revision } });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(detailOf(closed).status).toBe('closed');
      const reopened = await call('POST', `/${form.id}/reopen`, { payload: { expectedRevision: detailOf(closed).revision } });
      expect(reopened.statusCode, reopened.body).toBe(200);
      expect(detailOf(reopened).status).toBe('published');
      expect((await call('POST', `/${form.id}/publish`, { payload: {} })).statusCode).toBe(400);
    });

    it('lists versions and reads one; an unknown number is 404 FORM_NOT_FOUND', async () => {
      const form = await published('Versioned');
      const versions = await call('GET', `/${form.id}/versions`, { cookies: reader.cookies });
      expect(versions.statusCode).toBe(200);
      expect(formVersionsResponseSchema.parse((versions.json() as { data: unknown }).data).items.map((v) => v.number)).toEqual([1]);
      const version = await call('GET', `/${form.id}/versions/1`, { cookies: reader.cookies });
      expect(version.statusCode).toBe(200);
      expect(formVersionResponseSchema.parse((version.json() as { data: unknown }).data)).toMatchObject({
        number: 1,
        defaultLanguage: LANGUAGE,
      });
      const missing = await call('GET', `/${form.id}/versions/9`);
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('FORM_NOT_FOUND');
    });

    it('previews the working or the published copy with the status', async () => {
      const form = await published('Previewed');
      for (const sourceName of ['working', 'published']) {
        const response = await call('GET', `/${form.id}/preview?source=${sourceName}&language=${LANGUAGE}`, {
          cookies: reader.cookies,
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(formPreviewResponseSchema.parse((response.json() as { data: unknown }).data)).toMatchObject({
          formId: form.id,
          status: 'published',
          availability: 'open',
        });
      }
      const draft = await create('Previewed draft');
      const unpublished = await call('GET', `/${draft.id}/preview?source=published`);
      expect(formPreviewResponseSchema.parse((unpublished.json() as { data: unknown }).data)).toEqual({
        formId: draft.id,
        availability: 'unavailable',
        status: 'draft',
      });
      expect((await call('GET', `/${draft.id}/preview?source=elsewhere`)).statusCode).toBe(400);
    });

    it('duplicates into a new draft with a suffixed key (201)', async () => {
      const form = await published('Duplicated');
      const response = await call('POST', `/${form.id}/duplicate`, { payload: {} });
      expect(response.statusCode, response.body).toBe(201);
      const copy = detailOf(response);
      created.push(copy.id);
      expect(copy).toMatchObject({ status: 'draft', publishedVersionNumber: 0 });
      expect(copy.key).not.toBe(form.key);
      expect(copy.key.startsWith(form.key)).toBe(true);
    });

    it('deletes a form without entries (204); a stale revision is 409; then it is 404', async () => {
      const form = await create('Deleted');
      const stale = await call('DELETE', `/${form.id}?expectedRevision=${form.revision + 1}`);
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe('FORM_REVISION_CONFLICT');
      expect((await call('DELETE', `/${form.id}`)).statusCode).toBe(400);
      expect((await call('DELETE', `/${form.id}?expectedRevision=${form.revision}`)).statusCode).toBe(204);
      expect((await call('GET', `/${form.id}`)).statusCode).toBe(404);
    });
  });

  describe('PUT /:id/notifications (User Story 5, T083)', () => {
    const CHANNEL_A = '00000000-0000-4000-8000-0000000170a1';
    const list = (n: number, prefix = 'shop'): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);

    it('saves the default list and the per-channel lists, answering the detail with a new revision', async () => {
      const form = await create('Notified');
      expect(form.warnings).toContainEqual({ code: 'no_recipients' });
      const response = await call('PUT', `/${form.id}/notifications`, {
        payload: {
          expectedRevision: form.revision,
          recipients: list(10),
          channelRecipients: { [CHANNEL_A]: ['eu@example.com'] },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const detail = detailOf(response);
      expect(detail.recipients).toEqual(list(10));
      expect(detail.channelRecipients).toEqual({ [CHANNEL_A]: ['eu@example.com'] });
      expect(detail.revision).toBe(form.revision + 1);
      // The working copy is not touched by a recipients change (research R-3: recipients are live).
      expect(detail.definition).toEqual(form.definition);
      const read = detailOf(await call('GET', `/${form.id}`, { cookies: reader.cookies }));
      expect(read.recipients).toEqual(list(10));
    });

    it('refuses more than 10 addresses in a list, an invalid address, a non-uuid channel and more than 50 overrides (400)', async () => {
      const form = await create('Notified badly');
      const overrides = Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ['a@example.com']]),
      );
      const bodies: unknown[] = [
        { expectedRevision: form.revision, recipients: list(11), channelRecipients: {} },
        { expectedRevision: form.revision, recipients: [], channelRecipients: { [CHANNEL_A]: list(11, 'eu') } },
        { expectedRevision: form.revision, recipients: ['not-an-address'], channelRecipients: {} },
        { expectedRevision: form.revision, recipients: [], channelRecipients: { default: ['a@example.com'] } },
        { expectedRevision: form.revision, recipients: [], channelRecipients: overrides },
        { expectedRevision: form.revision, recipients: [] },
        { expectedRevision: form.revision, recipients: [], channelRecipients: {}, definition: {} },
      ];
      for (const payload of bodies) {
        const response = await call('PUT', `/${form.id}/notifications`, { payload });
        expect(response.statusCode, JSON.stringify(payload).slice(0, 120)).toBe(400);
      }
      const unchanged = detailOf(await call('GET', `/${form.id}`));
      expect(unchanged.revision).toBe(form.revision);
      expect(unchanged.recipients).toEqual([]);
    });

    it('accepts exactly 50 overrides', async () => {
      const form = await create('Notified widely');
      const overrides = Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ['a@example.com']]),
      );
      const response = await call('PUT', `/${form.id}/notifications`, {
        payload: { expectedRevision: form.revision, recipients: [], channelRecipients: overrides },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(detailOf(response).channelRecipients)).toHaveLength(50);
    });

    it('names the revision it acts on: a stale one is 409 FORM_REVISION_CONFLICT, an unknown form 404', async () => {
      const form = await create('Notified twice');
      const payload = { expectedRevision: form.revision, recipients: ['a@example.com'], channelRecipients: {} };
      expect((await call('PUT', `/${form.id}/notifications`, { payload })).statusCode).toBe(200);
      const stale = await call('PUT', `/${form.id}/notifications`, { payload });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).code).toBe('FORM_REVISION_CONFLICT');
      const missing = await call('PUT', '/00000000-0000-4000-8000-0000000170f9/notifications', { payload });
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('FORM_NOT_FOUND');
    });

    it('is audited as forms.form.recipients_update with counts and channel ids, never an address', async () => {
      const form = await create('Notified audited');
      const response = await call('PUT', `/${form.id}/notifications`, {
        payload: {
          expectedRevision: form.revision,
          recipients: ['audited-default@example.com'],
          channelRecipients: { [CHANNEL_A]: ['audited-eu@example.com', 'audited-eu2@example.com'] },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const rows = await h.auditLogService.query({ objectType: 'form', objectId: form.id, action: 'forms.form.recipients_update' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateAfter).toMatchObject({ recipientCount: 1, channelRecipientCounts: { [CHANNEL_A]: 2 } });
      expect(JSON.stringify(rows[0])).not.toContain('audited-');
    });
  });
});
