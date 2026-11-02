import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FORMS_WEBHOOK_EVENT_TYPES,
  formDetailSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type FormDetail,
  type WebhookEventDescriptor,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { servedActions } from '../../contract/projects/palette-actions-shared.js';
import { deleteForms, entriesDefinition, FORMS_ADMIN, FORMS_LANGUAGE } from '../../helpers/seed-forms.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import type { Mailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
const NOTHING = '00000000-0000-4000-8000-0000000170f0';
const CHANNEL = { 'x-sales-channel': 'default' };

type Verb = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * `forms` off-state — Constitution XVII item 6, `specs/170-forms-module/` T107 (plan § Off-state
 * test plan, User Story 10, SC-008).
 *
 * **The probes are every forms path of the served OpenAPI document** — the document the baseline
 * fixture is recorded from (`test/contract/kernel/openapi-baseline.test.ts`), read live because the
 * fixture gains the forms paths only at T132. A route a later story adds is probed here without
 * anybody listing it; the list below only refuses a document that lost the module's paths. Path
 * parameters name nothing, and a write carries an empty body its schema refuses, so the "on"
 * phases write nothing.
 *
 * Measured beside the harness, on both axes, each followed by restoration: the palette actions,
 * the settings group (the CAPTCHA settings not editable, the activation control still writable),
 * the `forms.Form` block in the Page Builder descriptor, the webhook event type, the notification
 * job (left waiting, sent on return), and the stored forms, versions, entries, notes, settings and
 * a page holding the block — identical after the module comes back.
 *
 * **Not here, and why.** The maintenance tick and the anonymisation subscriber arrive with User
 * Story 9 (T117–T125), whose `retention.test.ts` and `anonymisation.test.ts` carry their off-state
 * halves; the storefront's absence (the `/forms/submit` handler's 404, the block rendering nothing)
 * is the storefront's to prove (`storefront/test/forms/forms-submit-route.test.ts`,
 * `storefront/test/ssr/module-blocks.test.tsx`), and the editor's missing-block note the cms
 * editor tests'.
 */
describe('forms off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const RECIPIENT = `shop-${RUN}@example.com`;
  const created: string[] = [];
  const pages: string[] = [];
  const jobs: Array<{ entryId: string; shopLanguage: string }> = [];
  const mails: EmailMailerSendInput[] = [];
  let address = 0;

  const mailer: Mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      mails.push(input);
      return { status: 'sent' };
    },
  };

  const nextIp = (): string => `10.170.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function admin(method: Verb, url: string, payload?: unknown): Promise<LightMyRequestResponse> {
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

  /** A published form that notifies {@link RECIPIENT}. */
  async function published(name: string): Promise<FormDetail> {
    const form = detailOf(await admin('POST', '/api/v1/admin/forms', { name: `${name} ${RUN}`, defaultLanguage: FORMS_LANGUAGE }));
    created.push(form.id);
    const saved = detailOf(
      await admin('PUT', `/api/v1/admin/forms/${form.id}`, {
        expectedRevision: form.revision,
        definition: entriesDefinition(form.definition.sections[0]!.id),
      }),
    );
    const live = detailOf(await admin('POST', `/api/v1/admin/forms/${saved.id}/publish`, { expectedRevision: saved.revision }));
    return detailOf(
      await admin('PUT', `/api/v1/admin/forms/${live.id}/notifications`, {
        expectedRevision: live.revision,
        recipients: [RECIPIENT],
        channelRecipients: {},
      }),
    );
  }

  async function submit(form: FormDetail): Promise<string> {
    const before = jobs.length;
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${form.id}/entries`,
      headers: CHANNEL,
      remoteAddress: nextIp(),
      payload: { values: { name: 'Ada', email: `ada-${RUN}@example.com`, privacy: 'on' }, pageUrl: '/contact' },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(jobs.length).toBe(before + 1);
    return jobs[jobs.length - 1]!.entryId;
  }

  type Processor = (job: {
    data: { entryId: string; shopLanguage: string };
    progress: unknown;
    updateProgress(progress: object): Promise<void>;
  }) => Promise<unknown>;

  /** The job the worker would take for `entryId`, run once by the processor it would run. */
  function processJob(entryId: string): Promise<unknown> {
    const job = jobs.find((candidate) => candidate.entryId === entryId)!;
    let progress: unknown = 0;
    return h.container.resolve<Processor>('formsNotificationProcessor')({
      data: job,
      get progress() {
        return progress;
      },
      async updateProgress(next) {
        progress = next;
      },
    });
  }

  /** Every forms path the platform serves, as a probe that names nothing. */
  async function servedProbes(): Promise<Array<{ method: Verb; url: string; cookies: Record<string, string>; headers: Record<string, string>; payload?: unknown }>> {
    const response = await admin('GET', '/api/v1/_openapi.json');
    expect(response.statusCode, response.body).toBe(200);
    const document = response.json() as { paths: Record<string, Record<string, unknown>> };
    const ours = (path: string): boolean =>
      ['/api/v1/admin/forms', '/api/v1/storefront/forms'].some((root) => path === root || path.startsWith(`${root}/`));
    return Object.entries(document.paths)
      .filter(([path]) => ours(path))
      .flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => {
          const verb = method.toUpperCase() as Verb;
          const url = path.replace(/\{number\}/g, '1').replace(/\{[A-Za-z]+\}/g, NOTHING);
          const base = { method: verb, url, cookies: FORMS_ADMIN, headers: CHANNEL };
          return verb === 'GET' || verb === 'DELETE' ? base : { ...base, payload: {} };
        }),
      );
  }

  async function offeredTypes(): Promise<string[]> {
    const response = await admin('GET', '/api/v1/admin/webhooks/event-types');
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: WebhookEventDescriptor[] }).data
      .filter((descriptor) => descriptor.ownerModuleId === 'forms')
      .map((descriptor) => descriptor.eventType);
  }

  async function descriptorNames(): Promise<string[]> {
    const response = await admin('GET', '/api/v1/admin/cms/page-builder/config');
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { components: Array<{ name: string }> } }).data.components.map((c) => c.name);
  }

  /** The `forms` settings group as the settings screen reads it: code → editable. */
  async function settingsGroup(): Promise<Record<string, { editable: boolean; activationControl: boolean }>> {
    const response = await admin('GET', '/api/v1/admin/settings?groupCode=forms');
    expect(response.statusCode, response.body).toBe(200);
    const groups = (response.json() as {
      groups: Array<{ code: string; settings: Array<{ code: string; editable: boolean; activationControl: boolean }> }>;
    }).groups;
    const group = groups.find((candidate) => candidate.code === 'forms');
    expect(group, 'the forms settings group').toBeDefined();
    return Object.fromEntries(group!.settings.map((s) => [s.code, { editable: s.editable, activationControl: s.activationControl }]));
  }

  beforeAll(async () => {
    h = await setupBackendServer({
      organizationsMailer: mailer,
      moduleOverrides: {
        formsNotificationProducer: {
          enqueue: async (data: { entryId: string; shopLanguage: string }) => {
            jobs.push(data);
            return true;
          },
          close: async () => {},
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await deleteForms(h, created);
    await admin('PUT', '/api/v1/admin/settings/forms.captcha_site_key/value', { scope: 'all', value: '' });
    for (const id of pages) await admin('DELETE', `/api/v1/admin/cms/pages/${id}`);
    await teardownBackendServer(h);
  });

  it('positive control: the forms list answers while the module is on', async () => {
    const response = await admin('GET', '/api/v1/admin/forms');
    expect(response.statusCode, response.body).toBe(200);
  });

  it('refuses every forms route while off, on both axes, and restores them (US10-3)', async () => {
    const probes = await servedProbes();
    const served = probes.map((probe) => `${probe.method} ${probe.url}`);
    // Every story's routes, so a document that lost the module's paths fails here rather than
    // probing nothing: forms (US1), the public read and the submission (US2), the preview (US3),
    // entries (US4), notifications (US5).
    for (const expected of [
      'GET /api/v1/admin/forms',
      'POST /api/v1/admin/forms',
      'GET /api/v1/admin/forms/languages',
      `PUT /api/v1/admin/forms/${NOTHING}`,
      `DELETE /api/v1/admin/forms/${NOTHING}`,
      `POST /api/v1/admin/forms/${NOTHING}/publish`,
      `PUT /api/v1/admin/forms/${NOTHING}/notifications`,
      `GET /api/v1/admin/forms/${NOTHING}/versions/1`,
      'GET /api/v1/admin/forms/entries',
      'GET /api/v1/admin/forms/entries/export',
      `POST /api/v1/admin/forms/entries/${NOTHING}/notes`,
      `GET /api/v1/storefront/forms/${NOTHING}`,
      `POST /api/v1/storefront/forms/${NOTHING}/entries`,
    ]) {
      expect(served).toContain(expected);
    }
    await expectModuleAbsent(h, 'forms', {
      routes: probes,
      adminPresence: { cookies: FORMS_ADMIN },
      // An ordinary setting of the module's: the CAPTCHA provider (research R-14).
      settingWrite: { code: 'forms.captcha_provider', value: 'turnstile', cookies: FORMS_ADMIN },
    });
  });

  it.each(AXES)('offers no palette action while %s, and all three after', async (axis) => {
    const ACTIONS = ['new-form', 'open-form-entries', 'open-forms'];
    expect(Object.keys(await servedActions(h, 'forms')).sort()).toEqual(ACTIONS);
    await withModuleOff('forms', axis, async () => {
      expect(await servedActions(h, 'forms')).toEqual({});
    });
    expect(Object.keys(await servedActions(h, 'forms')).sort()).toEqual(ACTIONS);
  });

  it.each(AXES)('keeps its CAPTCHA settings read-only while %s and the activation control writable', async (axis) => {
    const before = await settingsGroup();
    expect(before['forms.captcha_provider']).toEqual({ editable: true, activationControl: false });
    expect(before['forms.enabled']).toMatchObject({ activationControl: true });
    await withModuleOff('forms', axis, async () => {
      const group = await settingsGroup();
      for (const code of ['forms.captcha_provider', 'forms.captcha_site_key', 'forms.captcha_secret_key']) {
        expect(group[code]?.editable, `${code} editable while forms is ${axis}`).toBe(false);
        // A well-formed write, so the refusal is the module's absence and not the body's shape.
        const write = await admin('PUT', `/api/v1/admin/settings/${code}/value`, {
          scope: 'all',
          value: code === 'forms.captcha_provider' ? 'hcaptcha' : 'k',
        });
        // The refusal the settings service gives an absent owner, as the shared harness asserts it.
        expect(
          { status: write.statusCode, code: (write.json() as { error?: { code?: string } }).error?.code },
          `${code}: ${write.body}`,
        ).toEqual({ status: 400, code: 'MODULE_SETTING_READ_ONLY' });
      }
      if (axis === 'deactivated') {
        // The one control that must never gate on the module's own presence.
        const activation = await admin('POST', '/api/v1/admin/modules/forms/activation', { active: false });
        expect(activation.statusCode, activation.body).toBe(200);
      }
    });
    if (axis === 'deactivated') {
      const restored = await admin('POST', '/api/v1/admin/modules/forms/activation', { active: true });
      expect(restored.statusCode, restored.body).toBe(200);
    }
    expect(await settingsGroup()).toEqual(before);
  });

  it.each(AXES)('withdraws forms.Form from the Page Builder and its webhook type while %s (US10-4), and restores both', async (axis) => {
    expect(await descriptorNames()).toContain('forms.Form');
    expect(await offeredTypes()).toEqual([...FORMS_WEBHOOK_EVENT_TYPES]);
    await withModuleOff('forms', axis, async () => {
      expect(await descriptorNames()).not.toContain('forms.Form');
      expect(await offeredTypes()).toEqual([]);
    });
    expect(await descriptorNames()).toContain('forms.Form');
    expect(await offeredTypes()).toEqual([...FORMS_WEBHOOK_EVENT_TYPES]);
  });

  it.each(AXES)('leaves a notification job waiting while %s — nothing sent — and sends it on return', async (axis) => {
    const form = await published(`Queued ${axis}`);
    const entryId = await submit(form);
    const sentFor = () => mails.filter((mail) => mail.messageId.startsWith(`forms-${entryId}-`));
    await withModuleOff('forms', axis, async () => {
      // The work gate: the job taken while off is refused before anything is read, so the worker
      // seam puts it back on the queue (BullMQ's rate-limit idiom) instead of failing it.
      await expect(processJob(entryId)).rejects.toMatchObject({ name: 'ModuleDisabledError', moduleId: 'forms' });
      expect(sentFor()).toEqual([]);
    });
    await processJob(entryId);
    expect(sentFor().map((mail) => mail.to)).toEqual([RECIPIENT]);
  });

  it.each(AXES)('restores every form, version, entry, note, setting and a page holding the block after %s (US10-5, SC-008)', async (axis) => {
    const form = await published(`Restored ${axis}`);
    const entryId = await submit(form);
    const note = await admin('POST', `/api/v1/admin/forms/entries/${entryId}/notes`, { body: `Called back ${RUN}` });
    expect(note.statusCode, note.body).toBe(201);
    const provider = await admin('PUT', '/api/v1/admin/settings/forms.captcha_site_key/value', { scope: 'all', value: `site-${RUN}` });
    expect(provider.statusCode, provider.body).toBe(200);

    const slug = `forms-off-${axis}-${RUN}`;
    const [channel] = (await h.em().getConnection().execute(`select "id" from "sales_channels" where "code" = 'default'`)) as Array<{ id: string }>;
    const page = await admin('POST', '/api/v1/admin/cms/pages', {
      name: `Forms off ${RUN}`,
      slug,
      active: true,
      salesChannelIds: [channel!.id],
      languages: ['en-US'],
    });
    expect(page.statusCode, page.body).toBe(201);
    const { id: pageId, version } = (page.json() as { data: { id: string; version: number } }).data;
    pages.push(pageId);
    const content = await admin('PUT', `/api/v1/admin/cms/pages/${pageId}/content/en-US`, {
      data: { root: { props: {} }, content: [{ type: 'forms.Form', props: { id: 'block-1', formId: form.id } }] },
      version,
    });
    expect(content.statusCode, content.body).toBe(200);
    expect((await admin('POST', `/api/v1/admin/cms/pages/${pageId}/publish`)).statusCode).toBe(200);

    const snapshot = async (): Promise<unknown> => {
      const rows = await withSystemScope('forms off-state test: read what is stored', async () => {
        const connection = h.em().getConnection();
        return {
          form: await connection.execute(`select * from "forms" where "id" = ?`, [form.id]),
          versions: await connection.execute(`select * from "form_versions" where "form_id" = ? order by "number"`, [form.id]),
          entries: await connection.execute(`select * from "form_entries" where "form_id" = ?`, [form.id]),
          notes: await connection.execute(`select * from "form_entry_notes" where "entry_id" = ?`, [entryId]),
        };
      });
      const settings = await admin('GET', '/api/v1/admin/settings?groupCode=forms');
      const stored = await h.app.inject({
        method: 'GET',
        url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
        headers: CHANNEL,
      });
      expect(stored.statusCode, stored.body).toBe(200);
      const { requestId: _requestId, ...pageBody } = stored.json() as Record<string, unknown>;
      return { rows, settings: (settings.json() as { groups: unknown }).groups, page: pageBody };
    };

    const before = await snapshot();
    expect(JSON.stringify(before)).toContain(form.id);
    await withModuleOff('forms', axis, async () => {
      // Nothing to read through the module while it is off; the rows stay where they are.
      expect((await admin('GET', `/api/v1/admin/forms/${form.id}`)).statusCode).toBe(503);
    });
    expect(await snapshot()).toEqual(before);
    expect((await admin('GET', `/api/v1/admin/forms/entries/${entryId}`)).statusCode).toBe(200);
  });
});
