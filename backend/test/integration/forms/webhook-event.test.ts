import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FORMS_EVENTS,
  FormEntrySubmittedEventV1Schema,
  formDetailSchema,
  type FormDefinitionInput,
  type FormDetail,
  type WebhookEventDescriptor,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Webhook } from '../../helpers/package-entities.js';
import { seedCrmOrganization } from '../../helpers/seed-crm.js';
import { deleteForms, FORMS_ADMIN, FORMS_LANGUAGE } from '../../helpers/seed-forms.js';
import type { WebhookJobData } from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
const CHANNEL = { 'x-sales-channel': 'default' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const EVENT = FORMS_EVENTS.ENTRY_SUBMITTED;

/**
 * `specs/170-forms-module/` T112 — User Story 8: `forms.entry.submitted.v1` offered to outbound
 * webhooks (FR-064, FR-065, contracts/events-and-webhook.md §1).
 *
 * What is observed is the job the webhooks delivery bridge hands its queue — the queue's `add` is
 * replaced for the file (crm's `webhooks.test.ts` precedent), so nothing reaches Redis and nothing
 * is posted anywhere. The payload is the event, whole, and carries only the answers of the fields
 * the entry's version marks "Share with integrations" that were visible — never a note, a
 * recipient, a consent text or an unshared answer.
 */
describe('forms — the submitted event offered to webhooks (US8)', () => {
  let h: BackendServerHandle;
  let jobs: WebhookJobData[];
  let restoreQueue: () => void;
  let otherOrganizationId: string;
  const RUN = randomUUID().slice(0, 8);
  const RECIPIENT = `shop-${RUN}@example.com`;
  const UNSHARED = `Unshared message ${RUN}`;
  const CONSENT = `I accept the privacy policy ${RUN}`;
  const created: string[] = [];
  const webhooks: string[] = [];
  let address = 0;

  const nextIp = (): string => `10.173.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function admin(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
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

  /** `share` names the field keys this version marks "Share with integrations". */
  function definition(sectionId: string, share: readonly string[]): FormDefinitionInput {
    const shared = (key: string) => (share.includes(key) ? { shareWithIntegrations: true } : {});
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true, ...shared('name') },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true, ...shared('email') },
            {
              id: 'f_topic',
              type: 'select',
              key: 'topic',
              options: [
                { id: 'o_support', value: 'support' },
                { id: 'o_sales', value: 'sales' },
              ],
              ...shared('topic'),
            },
            {
              id: 'f_detail',
              type: 'text',
              key: 'detail',
              visibility: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'support' }]] },
              ...shared('detail'),
            },
            { id: 'f_msg', type: 'textarea', key: 'message', ...shared('message') },
            { id: 'f_privacy', type: 'privacy_consent', key: 'privacy', required: true },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        [FORMS_LANGUAGE]: {
          'fields.f_name.label': 'Name',
          'fields.f_mail.label': 'E-mail',
          'fields.f_topic.label': 'Topic',
          'fields.f_topic.options.o_support': 'Support',
          'fields.f_topic.options.o_sales': 'Sales',
          'fields.f_detail.label': 'Detail',
          'fields.f_msg.label': 'Message',
          'fields.f_privacy.content': `<p>${CONSENT}</p>`,
        },
      },
    };
  }

  /** Save `share`'s definition and publish it as the form's next version. */
  async function publishVersion(form: FormDetail, share: readonly string[]): Promise<FormDetail> {
    const saved = detailOf(
      await admin('PUT', `/api/v1/admin/forms/${form.id}`, {
        expectedRevision: form.revision,
        definition: definition(form.definition.sections[0]!.id, share),
      }),
    );
    return detailOf(await admin('POST', `/api/v1/admin/forms/${saved.id}/publish`, { expectedRevision: saved.revision }));
  }

  async function published(name: string, share: readonly string[]): Promise<FormDetail> {
    const form = detailOf(await admin('POST', '/api/v1/admin/forms', { name: `${name} ${RUN}`, defaultLanguage: FORMS_LANGUAGE }));
    created.push(form.id);
    const live = await publishVersion(form, share);
    // Recipients, so the payload can be shown not to carry them.
    return detailOf(
      await admin('PUT', `/api/v1/admin/forms/${live.id}/notifications`, {
        expectedRevision: live.revision,
        recipients: [RECIPIENT],
        channelRecipients: {},
      }),
    );
  }

  const VALUES = {
    name: 'Ada',
    email: `ada-${RUN}@example.com`,
    topic: 'sales',
    // Hidden for the sales topic: never stored, never shared, though its field is marked.
    detail: 'Hidden detail',
    message: UNSHARED,
    privacy: 'on',
  };

  async function submit(form: FormDetail, extra: { cookies?: Record<string, string>; hp?: string; values?: Record<string, unknown> } = {}) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${form.id}/entries?language=${FORMS_LANGUAGE}`,
      headers: CHANNEL,
      remoteAddress: nextIp(),
      ...(extra.cookies ? { cookies: extra.cookies } : {}),
      payload: { values: extra.values ?? VALUES, pageUrl: '/contact', ...(extra.hp === undefined ? {} : { hp: extra.hp }) },
    });
  }

  const jobsFor = (formId: string, webhookId?: string) =>
    jobs.filter(
      (job) =>
        job.eventType === EVENT &&
        (job.payload as { formId?: string }).formId === formId &&
        (webhookId === undefined || job.webhookId === webhookId),
    );

  async function subscribe(organizationId: string | null = null): Promise<string> {
    const em = h.em();
    const webhook = em.create(Webhook, {
      name: `Forms ${randomUUID().slice(0, 8)}`,
      url: `https://example.invalid/${randomUUID()}`,
      secret: 'shhh',
      eventTypes: [EVENT],
      status: 'active',
      organizationId,
    });
    await em.flush();
    webhooks.push(webhook.id as string);
    return webhook.id as string;
  }

  async function offeredTypes(): Promise<string[]> {
    const response = await admin('GET', '/api/v1/admin/webhooks/event-types');
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: WebhookEventDescriptor[] }).data
      .filter((descriptor) => descriptor.ownerModuleId === 'forms')
      .map((descriptor) => descriptor.eventType);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    otherOrganizationId = await seedCrmOrganization(h.em(), `Forms webhooks ${RUN}`);
    const queue = (h.container.cradle as unknown as { webhookQueue: { add: (...args: unknown[]) => Promise<unknown> } }).webhookQueue;
    const original = queue.add;
    jobs = [];
    queue.add = async (_name: unknown, data: unknown) => {
      jobs.push(data as WebhookJobData);
      return undefined;
    };
    restoreQueue = () => {
      queue.add = original;
    };
  }, 60_000);

  beforeEach(() => {
    jobs.length = 0;
  });

  afterAll(async () => {
    restoreQueue?.();
    if (!h) return;
    await deleteForms(h, created);
    if (webhooks.length > 0) await h.em().nativeDelete(Webhook, { id: { $in: webhooks } });
    await teardownBackendServer(h);
  });

  it('offers its event type, as its owner, while forms is present (US8-1)', async () => {
    expect(await offeredTypes()).toEqual([EVENT]);
  });

  it('delivers one event per accepted entry, carrying the visible shared answers of the entry’s version only (US8-2, FR-064)', async () => {
    const hook = await subscribe();
    const form = await published('Shared', ['name', 'topic', 'detail']);
    const response = await submit(form);
    expect(response.statusCode, response.body).toBe(201);

    const delivered = jobsFor(form.id, hook);
    expect(delivered).toHaveLength(1);
    const payload = FormEntrySubmittedEventV1Schema.parse(delivered[0]!.payload);
    expect(payload).toMatchObject({
      eventType: EVENT,
      formId: form.id,
      formKey: form.key,
      formVersion: 1,
      organizationId: null,
      language: FORMS_LANGUAGE,
      pageUrl: '/contact',
    });
    expect(payload.answers).toEqual({ name: 'Ada', topic: 'sales' });
    expect(delivered[0]!.eventId).toBe(payload.eventId);
    // What is posted is the JSON of the payload: it parses after the round trip too.
    FormEntrySubmittedEventV1Schema.parse(JSON.parse(JSON.stringify(delivered[0]!.payload)));
    const body = JSON.stringify(delivered[0]!.payload);
    for (const secret of [UNSHARED, CONSENT, RECIPIENT, VALUES.email, 'Hidden detail']) expect(body).not.toContain(secret);

    // A note written afterwards is never delivered: nothing is emitted for it.
    const entryId = payload.entryId;
    jobs.length = 0;
    const note = await admin('POST', `/api/v1/admin/forms/entries/${entryId}/notes`, { body: `Called back ${RUN}` });
    expect(note.statusCode, note.body).toBe(201);
    expect(jobs).toEqual([]);

    // A later version that shares nothing: the entries it takes carry `{}`.
    const current = detailOf(await admin('GET', `/api/v1/admin/forms/${form.id}`));
    await publishVersion(current, []);
    expect((await submit(form)).statusCode).toBe(201);
    const later = jobsFor(form.id, hook);
    expect(later).toHaveLength(1);
    expect(FormEntrySubmittedEventV1Schema.parse(later[0]!.payload)).toMatchObject({ formVersion: 2, answers: {} });
  });

  it('delivers nothing for a filled honeypot or a refused submission (US8-3)', async () => {
    const hook = await subscribe();
    const form = await published('Refused', ['name']);
    expect((await submit(form, { hp: 'https://spam.example' })).statusCode).toBe(201);
    const refused = await submit(form, { values: { ...VALUES, name: '' } });
    expect(refused.statusCode, refused.body).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('FORM_SUBMISSION_INVALID');
    expect(jobsFor(form.id, hook)).toEqual([]);
  });

  it('delivers to an organisation-bound subscription only its organisation’s entries', async () => {
    const unbound = await subscribe();
    const own = await subscribe(TEST_ORGANIZATION_ID);
    const foreign = await subscribe(otherOrganizationId);
    const form = await published('Bound', ['name']);

    expect((await submit(form, { cookies: CUSTOMER })).statusCode).toBe(201);
    expect((await submit(form)).statusCode).toBe(201);

    // Only this case's three subscriptions: the earlier cases' unbound ones receive these too.
    const ours = jobsFor(form.id).filter((job) => [unbound, own, foreign].includes(job.webhookId));
    const signedIn = ours.filter((job) => (job.payload as { organizationId: string | null }).organizationId === TEST_ORGANIZATION_ID);
    const anonymous = ours.filter((job) => (job.payload as { organizationId: string | null }).organizationId === null);
    expect(signedIn.map((job) => job.webhookId).sort()).toEqual([own, unbound].sort());
    expect(anonymous.map((job) => job.webhookId)).toEqual([unbound]);
    expect(jobsFor(form.id, foreign)).toEqual([]);
  });

  it.each(AXES)('neither offers nor delivers the type while forms is %s, and offers it again after (US8-4)', async (axis) => {
    const hook = await subscribe();
    const form = await published(`Off ${axis}`, ['name']);
    await withModuleOff('forms', axis, async () => {
      expect(await offeredTypes()).toEqual([]);
      expect((await submit(form)).statusCode).toBe(503);
      expect(jobsFor(form.id, hook)).toEqual([]);
    });
    expect(await offeredTypes()).toEqual([EVENT]);
    expect((await submit(form)).statusCode).toBe(201);
    expect(jobsFor(form.id, hook)).toHaveLength(1);
  });
});
