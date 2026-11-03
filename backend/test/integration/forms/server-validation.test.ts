import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formDetailSchema,
  formSubmissionInvalidDetailsSchema,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T064 — User Story 3: the server applies the rules of the served version
 * to whatever it receives, bypassing the storefront (SC-003, FR-032, FR-034, FR-036).
 *
 * Every refusal is `400 FORM_SUBMISSION_INVALID` with `details.fields[{ fieldKey, code, message }]`,
 * the message in the submission language — the operator's override when the version has one, else
 * the module's built-in sentence — and stores nothing. A value posted for a hidden field is dropped,
 * a hidden field is never required, a hidden field counts as empty in the conditions that name it,
 * and a hidden section hides every field in it.
 */
describe('forms — server-side validation and conditional logic (US3)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const LANGUAGE = 'en-US';
  const RUN = randomUUID().slice(0, 8);
  const created: string[] = [];
  let bilingual: { id: string; code: string };
  let form: FormDetail;
  let address = 0;

  const nextIp = (): string => `10.172.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function adminCall(method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) {
    return h.app.inject({
      method,
      url: `${ADMIN_API}${path}`,
      cookies: admin,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function submit(values: Record<string, string | string[]>, channel = 'default'): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${form.id}/entries`,
      headers: { 'x-sales-channel': channel },
      remoteAddress: nextIp(),
      payload: { values },
    });
  }

  function refusal(response: LightMyRequestResponse) {
    expect(response.statusCode, response.body).toBe(400);
    const error = (response.json() as { error: { code: string; details: unknown } }).error;
    expect(error.code).toBe('FORM_SUBMISSION_INVALID');
    return formSubmissionInvalidDetailsSchema.parse(error.details).fields;
  }

  async function storedAnswers(): Promise<Array<Record<string, unknown>>> {
    return withSystemScope('forms server-validation test: read the entries as stored', async () =>
      (
        (await h
          .em()
          .getConnection()
          .execute(`select "answers" from "form_entries" where "form_id" = ? order by "submitted_at", "id"`, [
            form.id,
          ])) as Array<{ answers: Record<string, unknown> }>
      ).map((row) => row.answers),
    );
  }

  /**
   * One form holding every rule the matrix exercises. `detail` shows only for the support topic and
   * is required; `follow_up` shows only when `detail` is not empty; the second section shows only
   * for the sales topic and holds a required `company`.
   */
  function definition(firstSectionId: string): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: firstSectionId,
          columns: 2,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true, maxLength: 20 },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
            { id: 'f_phone', type: 'phone', key: 'phone' },
            { id: 'f_qty', type: 'number', key: 'qty', min: 0, max: 10, step: 2 },
            { id: 'f_date', type: 'datetime', key: 'visit', mode: 'date', earliest: '2026-01-01', latest: '2026-12-31' },
            { id: 'f_code', type: 'text', key: 'code', pattern: 'digits' },
            {
              id: 'f_topic',
              type: 'select',
              key: 'topic',
              required: true,
              options: [
                { id: 'o_support', value: 'support' },
                { id: 'o_sales', value: 'sales' },
              ],
            },
            { id: 'f_country', type: 'country', key: 'country' },
            {
              id: 'f_detail',
              type: 'text',
              key: 'detail',
              required: true,
              visibility: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'support' }]] },
            },
            {
              id: 'f_follow',
              type: 'text',
              key: 'follow_up',
              required: true,
              visibility: { connective: 'and', groups: [[{ fieldId: 'f_detail', operator: 'is_not_empty' }]] },
            },
          ],
        },
        {
          id: 'sales',
          columns: 1,
          visibility: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'sales' }]] },
          fields: [{ id: 'f_company', type: 'text', key: 'company', required: true }],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        [LANGUAGE]: {
          'fields.f_name.label': 'Name',
          ...Object.fromEntries(
            ['f_mail', 'f_phone', 'f_qty', 'f_date', 'f_code', 'f_topic', 'f_country', 'f_detail', 'f_follow', 'f_company'].map(
              (id) => [`fields.${id}.label`, id.slice(2)],
            ),
          ),
          // The operator's own sentence for one built-in message (R-24).
          'fields.f_name.errors.required': 'Tell us your name, please.',
        },
        'pl-PL': { 'fields.f_name.label': 'Imię' },
      },
    };
  }

  /** A submission every rule accepts: the support topic, so the sales section is hidden. */
  const VALID: Record<string, string> = { name: 'Ada', topic: 'support', detail: 'Broken', follow_up: 'Soon' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    const channel = em.create(SalesChannel, {
      code: `forms-validation-${RUN}`,
      name: { 'en-US': `Forms validation ${RUN}` },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    bilingual = { id: channel.id, code: channel.code };

    const draft = detailOf(await adminCall('POST', '', { name: `Validation ${RUN}`, defaultLanguage: LANGUAGE }));
    created.push(draft.id);
    const saved = detailOf(
      await adminCall('PUT', `/${draft.id}`, {
        expectedRevision: draft.revision,
        definition: definition(draft.definition.sections[0]!.id),
      }),
    );
    form = detailOf(await adminCall('POST', `/${saved.id}/publish`, { expectedRevision: saved.revision }));
  }, 60_000);

  afterAll(async () => {
    if (h) {
      if (created.length > 0) {
        await withSystemScope('forms server-validation test: clean up', async () => {
          await h
            .em()
            .getConnection()
            .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
        });
      }
      if (bilingual) await h.em().fork().nativeDelete(SalesChannel, { id: bilingual.id });
    }
    await teardownBackendServer(h);
  });

  it.each<[string, Record<string, string | string[]>, string, string]>([
    ['a missing required visible field', { name: '' }, 'name', 'required'],
    ['an unknown option', { topic: 'billing' }, 'topic', 'unknown_option'],
    ['a number above the maximum', { qty: '12' }, 'qty', 'above_max'],
    ['a number below the minimum', { qty: '-2' }, 'qty', 'below_min'],
    ['a number off the step', { qty: '3' }, 'qty', 'step_mismatch'],
    ['a date before the earliest', { visit: '2025-12-31' }, 'visit', 'too_early'],
    ['a date after the latest', { visit: '2027-01-01' }, 'visit', 'too_late'],
    ['an answer over the maximum length', { name: 'x'.repeat(21) }, 'name', 'too_long'],
    ['a pattern preset mismatch', { code: '12a' }, 'code', 'pattern'],
    ['a line break in a single-line answer', { name: 'Ada\nLovelace' }, 'name', 'single_line'],
    ['an invalid e-mail address', { email: 'not-an-address' }, 'email', 'invalid_email'],
    ['an invalid phone number', { phone: 'call me' }, 'phone', 'invalid_phone'],
    ['a country the dictionary does not know', { country: 'ZZ' }, 'country', 'invalid_country'],
  ])('refuses %s with its code and a message, and stores nothing (SC-003)', async (_name, patch, fieldKey, code) => {
    const before = (await storedAnswers()).length;
    const fields = refusal(await submit({ ...VALID, ...patch }));
    expect(fields.map((field) => [field.fieldKey, field.code])).toEqual([[fieldKey, code]]);
    expect(fields[0]!.message.trim()).not.toBe('');
    expect((await storedAnswers()).length).toBe(before);
  });

  it('accepts a country the dictionary knows', async () => {
    expect((await submit({ ...VALID, country: 'PL' })).statusCode).toBe(201);
  });

  it('applies the operator’s override of a built-in message, and the built-in sentence otherwise (R-24)', async () => {
    const fields = refusal(await submit({ ...VALID, name: '', email: 'nope' }));
    const byKey = new Map(fields.map((field) => [field.fieldKey, field.message]));
    expect(byKey.get('name')).toBe('Tell us your name, please.');
    expect(byKey.get('email')).toBe('Enter a valid e-mail address.');
  });

  it('words the messages in the submission language (FR-034)', async () => {
    // The channel's default is Polish; the version has no Polish override, so the built-in applies.
    const fields = refusal(await submit({ ...VALID, name: '', email: 'nope' }, bilingual.code));
    const byKey = new Map(fields.map((field) => [field.fieldKey, field.message]));
    expect(byKey.get('name')).toBe('Tell us your name, please.');
    expect(byKey.get('email')).toBe('Podaj poprawny adres e-mail.');
  });

  it('drops a value posted for a hidden field and never stores it (US3-3)', async () => {
    // The sales section is hidden for the support topic; `company` is posted anyway.
    expect((await submit({ ...VALID, company: 'Hidden Ltd' })).statusCode).toBe(201);
    const last = (await storedAnswers()).at(-1)!;
    expect(last).not.toHaveProperty('company');
    expect(last).toMatchObject({ name: 'Ada', topic: 'support', detail: 'Broken', follow_up: 'Soon' });
  });

  it('does not require a required field while it is hidden (US3-1)', async () => {
    // Sales topic: `detail` (required) is hidden, the sales section (required `company`) shows.
    const response = await submit({ name: 'Ada', topic: 'sales', company: 'Acme' });
    expect(response.statusCode, response.body).toBe(201);
    expect((await storedAnswers()).at(-1)).toEqual({ name: 'Ada', topic: 'sales', company: 'Acme' });
  });

  it('counts a hidden field as empty in a condition that names it (US3-6)', async () => {
    // `detail` is posted but hidden (sales topic), so `follow_up` — shown only when `detail` is not
    // empty — stays hidden and its `required` does not bind.
    const response = await submit({ name: 'Ada', topic: 'sales', company: 'Acme', detail: 'typed before switching' });
    expect(response.statusCode, response.body).toBe(201);
    const last = (await storedAnswers()).at(-1)!;
    expect(last).not.toHaveProperty('detail');
    expect(last).not.toHaveProperty('follow_up');
  });

  it('hides every field of a hidden section, and requires them once it shows (US3-2)', async () => {
    const fields = refusal(await submit({ name: 'Ada', topic: 'sales' }));
    expect(fields.map((field) => [field.fieldKey, field.code])).toEqual([['company', 'required']]);
    // Support topic: the same missing company is not asked for.
    expect((await submit(VALID)).statusCode).toBe(201);
  });

  it('ignores a key the version does not know (US3-5)', async () => {
    expect((await submit({ ...VALID, injected: 'value' })).statusCode).toBe(201);
    expect((await storedAnswers()).at(-1)).not.toHaveProperty('injected');
  });

  it('refuses every invalid field at once, each with its own code', async () => {
    const fields = refusal(await submit({ ...VALID, name: '', qty: '3', country: 'ZZ' }));
    expect(fields.map((field) => [field.fieldKey, field.code])).toEqual([
      ['name', 'required'],
      ['qty', 'step_mismatch'],
      ['country', 'invalid_country'],
    ]);
  });
});
