import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formDetailSchema,
  formSubmitResponseSchema,
  publicFormDefinitionSchema,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as formsManifest } from '../../../../packages/modules/forms/src/manifest.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T045 — the public form API over HTTP (`contracts/public-api.md` §1–§2,
 * research R-11, R-15).
 *
 * The definition read is **always `200`** for a well-formed id — a draft, a deleted form and an id
 * that never existed answer one identical `unavailable` body — and carries nothing an operator
 * keeps to themselves. The submission is strict, refused with `409 FORM_NOT_ACCEPTING` while the
 * form does not take entries, `413` over its body limit, `429` on the eleventh post of one address
 * in the window, and a filled honeypot is answered exactly as an acceptance.
 *
 * This file's app registers the rate limiter (`enableRateLimit`), so every request but the
 * rate-limit case comes from an address of its own.
 */
describe('forms public API (contract) — §1 definition, §2 submit', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const PUBLIC_API = '/api/v1/storefront/forms';
  const LANGUAGE = 'en-US';
  const RUN = randomUUID().slice(0, 8);
  const RECIPIENT = `inbox-${RUN}@example.com`;
  const SECRET = `secret-${RUN}`;
  const created: string[] = [];
  let address = 0;
  let open: FormDetail;
  let draft: FormDetail;
  let closed: FormDetail;
  let deletedId: string;
  let captchaForm: FormDetail;

  /** A fresh client address per request, so the per-address limit is the rate-limit case's alone. */
  const nextIp = (): string => `10.170.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function adminCall(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) {
    return h.app.inject({
      method,
      url: `${ADMIN_API}${path}`,
      cookies: admin,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function read(formId: string, ip = nextIp()): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'GET',
      url: `${PUBLIC_API}/${formId}`,
      headers: { 'x-sales-channel': 'default' },
      remoteAddress: ip,
    });
  }

  function submit(formId: string, payload: unknown, ip = nextIp()): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `${PUBLIC_API}/${formId}/entries`,
      headers: { 'x-sales-channel': 'default' },
      remoteAddress: ip,
      payload: payload as Record<string, unknown>,
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function errorOf(response: LightMyRequestResponse): { code: string; details?: Record<string, unknown> } {
    return (response.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  }

  function definition(sectionId: string, options: { captcha?: boolean } = {}): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true, shareWithIntegrations: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: options.captcha === true,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        [LANGUAGE]: {
          'form.title': 'Ask us',
          'fields.f_name.label': 'Name',
          'fields.f_mail.label': 'E-mail',
          'messages.success': 'Thanks — we will be in touch.',
        },
      },
    };
  }

  async function create(name: string): Promise<FormDetail> {
    const detail = detailOf(await adminCall('POST', '', { name: `${name} ${RUN}`, defaultLanguage: LANGUAGE }));
    created.push(detail.id);
    return detail;
  }

  async function saved(name: string, options: { captcha?: boolean } = {}): Promise<FormDetail> {
    const form = await create(name);
    return detailOf(
      await adminCall('PUT', `/${form.id}`, {
        expectedRevision: form.revision,
        definition: definition(form.definition.sections[0]!.id, options),
      }),
    );
  }

  async function published(name: string, options: { captcha?: boolean } = {}): Promise<FormDetail> {
    const form = await saved(name, options);
    return detailOf(await adminCall('POST', `/${form.id}/publish`, { expectedRevision: form.revision }));
  }

  async function setSetting(code: string, value: string): Promise<void> {
    const response = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: admin,
      payload: { scope: 'all', value },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function entryCount(formId: string): Promise<number> {
    return withSystemScope('forms public contract test: count the entries as stored', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as "n" from "form_entries" where "form_id" = ?`, [formId])) as Array<{ n: number }>;
      return rows[0]!.n;
    });
  }

  const VALID = { values: { name: 'Ada', email: 'ada@example.com' }, pageUrl: '/contact?ref=a' };

  beforeAll(async () => {
    h = await setupBackendServer({ enableRateLimit: true });
    await new ManifestReconciler(h.em()).apply([formsManifest.settings!]);
    open = await published('Open');
    draft = await saved('Draft');
    const toClose = await published('Closed');
    closed = detailOf(await adminCall('POST', `/${toClose.id}/close`, { expectedRevision: toClose.revision }));
    const toDelete = await published('Deleted');
    expect((await adminCall('DELETE', `/${toDelete.id}?expectedRevision=${toDelete.revision}`)).statusCode).toBe(204);
    deletedId = toDelete.id;
    captchaForm = await published('Captcha', { captcha: true });
    // What an operator keeps to themselves, written where the read could leak it.
    await withSystemScope('forms public contract test: give a form recipients and retention', async () => {
      await h
        .em()
        .getConnection()
        .execute(`update "forms" set "recipients" = ?::jsonb, "retention_days" = 30 where "id" = any(?::uuid[])`, [
          JSON.stringify([RECIPIENT]),
          `{${open.id},${captchaForm.id}}`,
        ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setSetting('forms.captcha_provider', 'none').catch(() => {});
      await setSetting('forms.captcha_site_key', '').catch(() => {});
      await setSetting('forms.captcha_secret_key', '').catch(() => {});
      if (created.length > 0) {
        await withSystemScope('forms public contract test: clean up', async () => {
          await h
            .em()
            .getConnection()
            .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
        });
      }
    }
    await teardownBackendServer(h);
  });

  describe('§1 GET /api/v1/storefront/forms/:formId', () => {
    it('answers a published form with 200, its public read and a shared-cache header', async () => {
      const response = await read(open.id);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
      const body = publicFormDefinitionSchema.parse((response.json() as { data: unknown }).data);
      expect(body).toMatchObject({ formId: open.id, availability: 'open', version: 1, language: LANGUAGE });
    });

    it('answers a draft, a deleted form and an id that never existed with one identical unavailable body', async () => {
      const never = randomUUID();
      const bodies = await Promise.all([draft.id, deletedId, never].map(async (id) => {
        const response = await read(id);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
        return { id, body: response.json() as { data: Record<string, unknown> } };
      }));
      for (const { id, body } of bodies) {
        expect(body).toEqual({ data: { formId: id, availability: 'unavailable' } });
      }
    });

    it('answers a closed form with 200 and its closed availability', async () => {
      const response = await read(closed.id);
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: { availability: string } }).data.availability).toBe('closed');
    });

    it('refuses a malformed id with 400', async () => {
      const response = await read('not-a-uuid');
      expect(response.statusCode, response.body).toBe(400);
    });

    it('carries no recipient, retention, count, share flag, submitter marker or CAPTCHA secret', async () => {
      await setSetting('forms.captcha_provider', 'turnstile');
      await setSetting('forms.captcha_site_key', `site-${RUN}`);
      await setSetting('forms.captcha_secret_key', SECRET);
      const response = await read(captchaForm.id);
      expect(response.statusCode).toBe(200);
      const body = publicFormDefinitionSchema.parse((response.json() as { data: unknown }).data);
      // Required and configured: the provider and its public key, and nothing else.
      expect(body).toMatchObject({ captcha: { provider: 'turnstile', siteKey: `site-${RUN}` } });
      for (const absent of [
        RECIPIENT,
        SECRET,
        'recipients',
        'channelRecipients',
        'retentionDays',
        'acceptedEntryCount',
        'entryCount',
        'shareWithIntegrations',
        'submitterEmail',
        'secretKey',
      ]) {
        expect(response.body, absent).not.toContain(absent);
      }
      await setSetting('forms.captcha_provider', 'none');
    });
  });

  describe('§2 POST /api/v1/storefront/forms/:formId/entries', () => {
    it('accepts a valid submission with 201 and the form’s confirmation', async () => {
      const before = await entryCount(open.id);
      const response = await submit(open.id, VALID);
      expect(response.statusCode, response.body).toBe(201);
      const body = formSubmitResponseSchema.parse((response.json() as { data: unknown }).data);
      expect(body).toEqual({ status: 'accepted', confirmation: { type: 'message', message: 'Thanks — we will be in touch.' } });
      expect(await entryCount(open.id)).toBe(before + 1);
    });

    it.each([
      ['an attribution field', { customerAccountId: '00000000-0000-4000-8000-0000000000a1' }],
      ['an organisation field', { organizationId: '00000000-0000-4000-8000-0000000000aa' }],
      ['any unknown key', { recipients: ['attacker@example.com'] }],
      ['a page address that leaves the shop', { pageUrl: '//evil.example/path' }],
    ])('refuses a body with %s (strict) and stores nothing', async (_name, patch) => {
      const before = await entryCount(open.id);
      const response = await submit(open.id, { ...VALID, ...patch });
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
      expect(await entryCount(open.id)).toBe(before);
    });

    it.each([
      ['a draft', () => draft.id, 'unavailable'],
      ['a closed form', () => closed.id, 'closed'],
      ['a deleted form', () => deletedId, 'unavailable'],
      ['an id that never existed', () => '00000000-0000-4000-8000-0000000170ff', 'unavailable'],
    ])('refuses a submission to %s with 409 FORM_NOT_ACCEPTING', async (_name, id, token) => {
      const response = await submit(id(), VALID);
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response)).toMatchObject({ code: 'FORM_NOT_ACCEPTING', details: { code: token } });
    });

    it('refuses a body over 256 KiB with 413 FORM_SUBMISSION_TOO_LARGE and stores nothing', async () => {
      const before = await entryCount(open.id);
      const response = await submit(open.id, { values: { name: 'x'.repeat(262_200) } });
      expect(response.statusCode, response.body).toBe(413);
      expect(errorOf(response).code).toBe('FORM_SUBMISSION_TOO_LARGE');
      expect(await entryCount(open.id)).toBe(before);
    });

    it('answers a filled honeypot exactly as an acceptance and stores nothing', async () => {
      const before = await entryCount(open.id);
      const accepted = await submit(open.id, VALID);
      const trapped = await submit(open.id, { ...VALID, hp: 'https://spam.example' });
      expect(trapped.statusCode).toBe(accepted.statusCode);
      expect(trapped.json()).toEqual(accepted.json());
      expect(await entryCount(open.id)).toBe(before + 1);
    });

    it('limits one client address to ten submissions in ten minutes', async () => {
      const ip = nextIp();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        statuses.push((await submit(open.id, { ...VALID, hp: 'bot' }, ip)).statusCode);
      }
      expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 201));
      expect(statuses[10]).toBe(429);
      // Another address is not affected.
      expect((await submit(open.id, { ...VALID, hp: 'bot' })).statusCode).toBe(201);
    });
  });
});
