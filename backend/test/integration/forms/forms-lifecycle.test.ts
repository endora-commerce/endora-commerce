import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FORMS_EVENTS,
  FORMS_STOREFRONT_CACHE_TAGS,
  formDetailSchema,
  formVersionResponseSchema,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import type { StorefrontRevalidator } from '@endora-commerce/platform/http';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T028 (+ T037) — User Story 1: build a form and publish it.
 *
 * Create → a draft with a key, a default language and one empty section (US1-1); saving checks the
 * shape only; publishing freezes version 1; editing leaves it untouched (US1-5); publishing again
 * freezes version 2 and leaves version 1's row byte-identical (FR-009, FR-010); a definition that
 * breaks a rule is refused naming its elements (US1-4, a cycle — US3-7); close and reopen (US1-7);
 * duplicate is a new draft with a suffixed key (FR-014); a form without entries is deleted (FR-013);
 * a concurrent save is refused (R-26). Every write is one audited Command whose state names ids,
 * status and version numbers and no operator text; `forms.form.changed` is dispatched on the commit
 * of publish, close, reopen and delete — and drops the form's storefront tag (FR-063) — never on a
 * rolled-back write.
 */
describe('forms — build a form and publish it (US1)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/forms';
  const LANGUAGE = 'en-US';
  const SENTINEL = 'Sentinel label 7c1f';
  const created: string[] = [];
  const changed: string[] = [];
  let offChanged: () => void = () => {};
  let revalidated: string[][] = [];

  function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies: admin,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function definitionWith(sectionId: string, label: string, extra: FormDefinitionInput['sections'] = []): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 3,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', width: 2, required: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
          ],
        },
        ...extra,
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: { [LANGUAGE]: { 'fields.f_name.label': label, 'fields.f_mail.label': 'E-mail' } },
    };
  }

  async function create(name: string): Promise<FormDetail> {
    const detail = detailOf(await call('POST', '', { name, defaultLanguage: LANGUAGE }));
    created.push(detail.id);
    return detail;
  }

  const save = async (form: FormDetail, definition: FormDefinitionInput) =>
    detailOf(await call('PUT', `/${form.id}`, { expectedRevision: form.revision, definition }));

  const publish = async (form: FormDetail) =>
    detailOf(await call('POST', `/${form.id}/publish`, { expectedRevision: form.revision }));

  const audit = async (formId: string) =>
    (await h.auditLogService.query({ objectType: 'form', objectId: formId })).reverse();

  const versionRow = async (formId: string, number: number) =>
    withSystemScope('forms lifecycle test: read a version row as stored', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(
          `select "id", "definition"::text as "definition", "default_language", "published_at"::text as "published_at"
             from "form_versions" where "form_id" = ? and "number" = ?`,
          [formId, number],
        )) as Array<Record<string, string>>;
      return rows[0];
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    offChanged = h.eventBus.on(FORMS_EVENTS.FORM_CHANGED as never, (payload: unknown) => {
      changed.push((payload as { formId: string }).formId);
    });
    const revalidator = h.container.resolve<StorefrontRevalidator>('formsStorefrontRevalidator');
    vi.spyOn(revalidator, 'revalidate').mockImplementation(async (tags: string[]) => {
      revalidated.push(tags);
    });
  });

  afterAll(async () => {
    offChanged();
    vi.restoreAllMocks();
    if (created.length > 0) {
      await withSystemScope('forms lifecycle test: clean up', async () => {
        await h
          .em()
          .getConnection()
          .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
      });
    }
    await teardownBackendServer(h);
  });

  it('creates a draft with a key, the default language and one empty section (US1-1)', async () => {
    const form = await create('Ask about racking');
    expect(form).toMatchObject({ status: 'draft', key: 'ask_about_racking', defaultLanguage: LANGUAGE });
    expect(form.definition.sections).toEqual([{ id: expect.any(String), columns: 1, fields: [] }]);
    expect((await audit(form.id)).map((row) => row.action)).toEqual(['forms.form.create']);
  });

  it('saving checks the shape only, so a half-built form can be saved', async () => {
    const form = await create('Half built');
    const definition = definitionWith(form.definition.sections[0]!.id, SENTINEL);
    definition.texts = {}; // unlabelled: a publish would refuse it
    const saved = await save(form, definition);
    expect(saved.revision).toBe(2);
    expect(saved.definition.sections[0]!.fields).toHaveLength(2);
  });

  it('publishes version 1, keeps it while the working copy changes, and freezes version 2 beside it (US1-5, FR-009, FR-010)', async () => {
    const form = await create('Versioned form');
    const sectionId = form.definition.sections[0]!.id;
    const first = await publish(await save(form, definitionWith(sectionId, SENTINEL)));
    expect(first).toMatchObject({ status: 'published', publishedVersionNumber: 1 });
    const versionOneBefore = await versionRow(form.id, 1);

    const edited = await save(first, definitionWith(sectionId, 'Full name'));
    expect(edited.publishedDefinition?.texts[LANGUAGE]?.['fields.f_name.label']).toBe(SENTINEL);
    expect(edited.definition.texts[LANGUAGE]?.['fields.f_name.label']).toBe('Full name');
    const preview = await call('GET', `/${form.id}/preview?source=published&language=${LANGUAGE}`);
    expect(JSON.stringify(preview.json())).toContain(SENTINEL);

    const second = await publish(edited);
    expect(second.publishedVersionNumber).toBe(2);
    expect(await versionRow(form.id, 1)).toEqual(versionOneBefore);
    const v2 = formVersionResponseSchema.parse(((await call('GET', `/${form.id}/versions/2`)).json() as { data: unknown }).data);
    expect(v2.definition.texts[LANGUAGE]?.['fields.f_name.label']).toBe('Full name');
    const versions = (await call('GET', `/${form.id}/versions`)).json() as { data: { items: Array<{ number: number }> } };
    expect(versions.data.items.map((v) => v.number)).toEqual([2, 1]);
  });

  it('refuses an invalid definition with element ids, a visibility cycle included (US1-4, US3-7)', async () => {
    const form = await create('Cyclic form');
    const sectionId = form.definition.sections[0]!.id;
    const definition = definitionWith(sectionId, 'Name', [
      {
        id: 's_cycle',
        columns: 1,
        fields: [
          {
            id: 'f_a',
            type: 'text',
            key: 'a',
            visibility: { connective: 'and', groups: [[{ fieldId: 'f_b', operator: 'is_not_empty' }]] },
          },
          {
            id: 'f_b',
            type: 'text',
            key: 'b',
            visibility: { connective: 'and', groups: [[{ fieldId: 'f_a', operator: 'is_not_empty' }]] },
          },
        ],
      },
    ]);
    definition.texts[LANGUAGE] = { ...definition.texts[LANGUAGE], 'fields.f_a.label': 'A', 'fields.f_b.label': 'B' };
    const saved = await save(form, definition);
    const before = changed.length;
    const response = await call('POST', `/${form.id}/publish`, { expectedRevision: saved.revision });
    expect(response.statusCode).toBe(400);
    const error = (response.json() as { error: { code: string; details: { issues: Array<{ code: string; elementId: string }> } } }).error;
    expect(error.code).toBe('FORM_DEFINITION_INVALID');
    expect(error.details.issues.filter((issue) => issue.code === 'cyclic_visibility').map((issue) => issue.elementId).sort()).toEqual([
      'f_a',
      'f_b',
    ]);
    // A refused publish is a rolled-back Command: no version, no event, no audit row.
    expect(changed.length).toBe(before);
    expect(await versionRow(form.id, 1)).toBeUndefined();
    expect((await audit(form.id)).map((row) => row.action)).toEqual(['forms.form.create', 'forms.form.update']);
  });

  it('closes and reopens a published form (US1-7)', async () => {
    const form = await create('Seasonal form');
    const live = await publish(await save(form, definitionWith(form.definition.sections[0]!.id, 'Name')));
    const closed = detailOf(await call('POST', `/${form.id}/close`, { expectedRevision: live.revision }));
    expect(closed.status).toBe('closed');
    const closedPublic = await call('GET', `/${form.id}/preview?source=published`);
    expect((closedPublic.json() as { data: { availability: string } }).data.availability).toBe('closed');
    const reopened = detailOf(await call('POST', `/${form.id}/reopen`, { expectedRevision: closed.revision }));
    expect(reopened.status).toBe('published');
    // Close from a draft is not a move the form can make.
    const draft = await create('Never published');
    expect((await call('POST', `/${draft.id}/close`, { expectedRevision: draft.revision })).statusCode).toBe(409);
  });

  it('duplicates the working copy into a new draft with a suffixed key and no versions (FR-014)', async () => {
    const form = await create('Original form');
    const live = await publish(await save(form, definitionWith(form.definition.sections[0]!.id, 'Name')));
    const response = await call('POST', `/${form.id}/duplicate`, { name: 'Copy of the original' });
    expect(response.statusCode, response.body).toBe(201);
    const copy = detailOf(response);
    created.push(copy.id);
    expect(copy).toMatchObject({ status: 'draft', name: 'Copy of the original', publishedVersionNumber: 0 });
    expect(copy.key).toMatch(new RegExp(`^${live.key}_`));
    expect(copy.definition).toEqual(live.definition);
    expect(((await call('GET', `/${copy.id}/versions`)).json() as { data: { items: unknown[] } }).data.items).toEqual([]);
  });

  it('refuses the second of two concurrent saves of one revision (R-26)', async () => {
    const form = await create('Contended form');
    const [a, b] = await Promise.all([
      call('PUT', `/${form.id}`, { expectedRevision: form.revision, name: 'First writer' }),
      call('PUT', `/${form.id}`, { expectedRevision: form.revision, name: 'Second writer' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('deletes a form without entries, with its versions (FR-013)', async () => {
    const form = await create('Short-lived form');
    const live = await publish(await save(form, definitionWith(form.definition.sections[0]!.id, 'Name')));
    const response = await call('DELETE', `/${form.id}?expectedRevision=${live.revision}`);
    expect(response.statusCode, response.body).toBe(204);
    expect((await call('GET', `/${form.id}`)).statusCode).toBe(404);
    expect(await versionRow(form.id, 1)).toBeUndefined();
  });

  it('audits every write as one Command naming ids, status and versions — never an operator text (Principle XIII)', async () => {
    const form = await create('Audited form');
    const live = await publish(await save(form, definitionWith(form.definition.sections[0]!.id, SENTINEL)));
    const closed = detailOf(await call('POST', `/${form.id}/close`, { expectedRevision: live.revision }));
    const reopened = detailOf(await call('POST', `/${form.id}/reopen`, { expectedRevision: closed.revision }));
    await call('DELETE', `/${form.id}?expectedRevision=${reopened.revision}`);
    const rows = await audit(form.id);
    expect(rows.map((row) => row.action)).toEqual([
      'forms.form.create',
      'forms.form.update',
      'forms.form.publish',
      'forms.form.close',
      'forms.form.reopen',
      'forms.form.delete',
    ]);
    const states = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    expect(states).not.toContain(SENTINEL);
    expect(states).not.toContain('Audited form');
    expect(rows.find((row) => row.action === 'forms.form.publish')?.stateAfter).toMatchObject({
      status: 'published',
      publishedVersionNumber: 1,
    });
  });

  it('dispatches forms.form.changed on the commit of publish, close, reopen and delete, and drops the storefront tag (FR-063)', async () => {
    const form = await create('Announced form');
    const saved = await save(form, definitionWith(form.definition.sections[0]!.id, 'Name'));
    changed.length = 0;
    revalidated = [];
    const live = await publish(saved);
    const closed = detailOf(await call('POST', `/${form.id}/close`, { expectedRevision: live.revision }));
    const reopened = detailOf(await call('POST', `/${form.id}/reopen`, { expectedRevision: closed.revision }));
    // A save and a create change nothing the public read answers.
    const edited = await save(reopened, definitionWith(form.definition.sections[0]!.id, 'Renamed'));
    await call('DELETE', `/${form.id}?expectedRevision=${edited.revision}`);
    expect(changed).toEqual([form.id, form.id, form.id, form.id]);
    expect(revalidated).toEqual(Array.from({ length: 4 }, () => [FORMS_STOREFRONT_CACHE_TAGS.form(form.id)]));
  });
});
