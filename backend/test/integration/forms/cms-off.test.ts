import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formDetailSchema, type FormDetail } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { deleteForms, entriesDefinition, FORMS_ADMIN, FORMS_LANGUAGE } from '../../helpers/seed-forms.js';

const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
const CHANNEL = { 'x-sales-channel': 'default' };

/**
 * `specs/170-forms-module/` T110 — User Story 10, scenario 6 (FR-002): with `cms` off and `forms`
 * on, the forms and entries APIs work, and a form whose confirmation is "show a CMS page" answers
 * its confirmation message instead — in the public read and in the submission's answer — without
 * asking `cms` (the manifest's `degrades-without` edge). On both axes, and the page is the answer
 * again once `cms` is back.
 */
describe('forms with cms off (US10-6)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const created: string[] = [];
  const pages: string[] = [];
  let form: FormDetail;
  let address = 0;

  const nextIp = (): string => `10.171.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function admin(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url,
      cookies: FORMS_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  async function submit(): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${form.id}/entries?language=${FORMS_LANGUAGE}`,
      headers: CHANNEL,
      remoteAddress: nextIp(),
      payload: { values: { name: 'Ada', email: `ada-${RUN}@example.com`, privacy: 'on' }, pageUrl: '/contact' },
    });
  }

  async function publicConfirmation(): Promise<unknown> {
    const read = await h.app.inject({ method: 'GET', url: `/api/v1/storefront/forms/${form.id}?language=${FORMS_LANGUAGE}`, headers: CHANNEL });
    expect(read.statusCode, read.body).toBe(200);
    return (read.json() as { data: { confirmation: unknown } }).data.confirmation;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // A published CMS page on the default channel: the confirmation the form leads to.
    const [channel] = (await h.em().getConnection().execute(`select "id" from "sales_channels" where "code" = 'default'`)) as Array<{ id: string }>;
    const slug = `forms-thanks-${RUN}`;
    const page = await admin('POST', '/api/v1/admin/cms/pages', {
      name: `Forms thanks ${RUN}`,
      slug,
      active: true,
      salesChannelIds: [channel!.id],
      languages: [FORMS_LANGUAGE],
    });
    expect(page.statusCode, page.body).toBe(201);
    const pageId = (page.json() as { data: { id: string } }).data.id;
    pages.push(pageId);
    expect((await admin('POST', `/api/v1/admin/cms/pages/${pageId}/publish`)).statusCode).toBe(200);

    const draft = detailOf(await admin('POST', '/api/v1/admin/forms', { name: `Cms off ${RUN}`, defaultLanguage: FORMS_LANGUAGE }));
    created.push(draft.id);
    const definition = entriesDefinition(draft.definition.sections[0]!.id);
    const saved = detailOf(
      await admin('PUT', `/api/v1/admin/forms/${draft.id}`, {
        expectedRevision: draft.revision,
        definition: {
          ...definition,
          behaviour: { ...definition.behaviour, confirmation: { type: 'page', cmsPageId: pageId } },
          texts: { [FORMS_LANGUAGE]: { ...definition.texts[FORMS_LANGUAGE], 'messages.success': `Thanks ${RUN}` } },
        },
      }),
    );
    form = detailOf(await admin('POST', `/api/v1/admin/forms/${saved.id}/publish`, { expectedRevision: saved.revision }));
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await deleteForms(h, created);
    for (const id of pages) await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${id}`, cookies: FORMS_ADMIN });
    await teardownBackendServer(h);
  });

  it('positive control: the confirmation is the CMS page while cms is on', async () => {
    expect(await publicConfirmation()).toMatchObject({ type: 'page' });
    const response = await submit();
    expect(response.statusCode, response.body).toBe(201);
    expect((response.json() as { data: { confirmation: unknown } }).data.confirmation).toMatchObject({ type: 'page' });
  });

  it.each(AXES)('keeps the forms and entries APIs working while cms is %s', async (axis) => {
    await withModuleOff('cms', axis, async () => {
      expect((await admin('GET', '/api/v1/admin/forms')).statusCode).toBe(200);
      const detail = detailOf(await admin('GET', `/api/v1/admin/forms/${form.id}`));
      const copy = await admin('POST', `/api/v1/admin/forms/${detail.id}/duplicate`, {});
      expect(copy.statusCode, copy.body).toBe(201);
      created.push((copy.json() as { data: { id: string } }).data.id);

      const submitted = await submit();
      expect(submitted.statusCode, submitted.body).toBe(201);
      const entryId = (submitted.json() as { data: { entryId?: string } }).data.entryId;
      const list = await admin('GET', `/api/v1/admin/forms/entries?formId=${form.id}`);
      expect(list.statusCode, list.body).toBe(200);
      const rows = (list.json() as { data: { items: Array<{ id: string }> } }).data.items;
      expect(rows.length).toBeGreaterThan(0);
      const id = entryId ?? rows[0]!.id;
      expect((await admin('GET', `/api/v1/admin/forms/entries/${id}`)).statusCode).toBe(200);
      const note = await admin('POST', `/api/v1/admin/forms/entries/${id}/notes`, { body: `Noted while cms is ${axis}` });
      expect(note.statusCode, note.body).toBe(201);
      const exported = await admin('GET', `/api/v1/admin/forms/entries/export?formId=${form.id}`);
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.headers['content-type']).toContain('text/csv');
    });
  });

  it.each(AXES)('answers the confirmation message instead of the page while cms is %s, and the page once back', async (axis) => {
    await withModuleOff('cms', axis, async () => {
      // The public read names the kind (its text is the form's `messages.success`); the submission
      // answers the text itself.
      expect(await publicConfirmation()).toEqual({ type: 'message' });
      const response = await submit();
      expect(response.statusCode, response.body).toBe(201);
      expect((response.json() as { data: { confirmation: unknown } }).data.confirmation).toEqual({
        type: 'message',
        message: `Thanks ${RUN}`,
      });
    });
    expect(await publicConfirmation()).toMatchObject({ type: 'page' });
  });
});
