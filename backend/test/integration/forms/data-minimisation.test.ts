import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FORMS_EVENTS,
  formDetailSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { EmailDelivery, Webhook } from '../../helpers/package-entities.js';
import { deleteForms, FORMS_ADMIN, FORMS_LANGUAGE } from '../../helpers/seed-forms.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import type { Mailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { RecordingMailer } from '../../../../packages/modules/email/src/backend/services/recording-mailer.js';
import { PersistentEmailDeliveryRecorder } from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';
import type { WebhookJobData } from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

/**
 * `specs/170-forms-module/` T129 — SC-007, data minimisation (FR-053, FR-055, FR-057, FR-064).
 *
 * One entry is taken through its whole life — submitted, notified (shop message and confirmation
 * with a summary), exported, deleted — carrying two sentinels: `PRIVATE` in a field that is not
 * shared with integrations and `SHARED` in one that is. Neither may reach `audit_log_entries`,
 * `email_deliveries`, the notification job (its data or its progress), a line the server logged or
 * a public response; after the deletion neither is left in any `forms` table. The one place an
 * answer may live outside the entry is the webhook delivery, and only the shared one.
 *
 * **Where the webhook delivery is measured**: `webhook_deliveries.payload` is written by the
 * webhooks delivery worker from the job's `payload`, and the shared harness runs no worker — so the
 * job the bridge hands its queue (replaced for the file, as in `webhook-event.test.ts`) is the
 * payload that row would hold. The table itself is asserted to hold neither sentinel.
 *
 * **Logs**: every line the root pino logger and its request children serialise, read off the stream
 * they share, plus anything written to `console` while the entry is in flight.
 */
describe('forms — data minimisation (SC-007)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const PRIVATE = `PrivateSentinel${RUN}`;
  const SHARED = `SharedSentinel${RUN}`;
  const SENTINELS = [PRIVATE, SHARED] as const;
  const RECIPIENT = `shop-${RUN}@example.com`;
  const SUBMITTER = `shopper-${RUN}@example.com`;
  const created: string[] = [];
  const webhooks: string[] = [];
  const jobs: Array<{ entryId: string; shopLanguage: string }> = [];
  const webhookJobs: WebhookJobData[] = [];
  const mails: EmailMailerSendInput[] = [];
  const publicBodies: string[] = [];
  const logged: string[] = [];
  let recording: Mailer | null = null;
  let restore: Array<() => void> = [];

  const mailer: Mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      if (!recording) throw new Error('the recording mailer is set up in beforeAll');
      return recording.send(input);
    },
  };

  function admin(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url,
      cookies: FORMS_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function storefront(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    const response = await h.app.inject({
      method,
      url,
      headers: { 'x-sales-channel': 'default' },
      remoteAddress: '10.174.0.1',
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    publicBodies.push(JSON.stringify(response.headers), response.body);
    return response;
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function definition(sectionId: string): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true, shareWithIntegrations: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
            { id: 'f_msg', type: 'textarea', key: 'message' },
            { id: 'f_privacy', type: 'privacy_consent', key: 'privacy', required: true },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: true, includeSummary: true },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        [FORMS_LANGUAGE]: {
          'fields.f_name.label': 'Name',
          'fields.f_mail.label': 'E-mail',
          'fields.f_msg.label': 'Message',
          'fields.f_privacy.content': '<p>I accept the privacy policy</p>',
          'email.confirmation.subject': `Thanks ${RUN}`,
          'email.confirmation.body': '<p>We will reply soon.</p>',
        },
      },
    };
  }

  /** How many rows of `table` hold `needle` anywhere in their text form. */
  async function rowsHolding(table: string, needle: string): Promise<number> {
    return withSystemScope('forms data-minimisation test: read a table as stored', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as "n" from "${table}" t where t::text like ?`, [`%${needle}%`])) as Array<{ n: number }>;
      return rows[0]!.n;
    });
  }

  /** Every table the forms module owns (its migration creates `forms` and `form_*`). */
  async function formsTables(): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select "table_name" from information_schema.tables
          where "table_schema" = current_schema() and ("table_name" = 'forms' or "table_name" like 'form\\_%')
          order by "table_name"`,
      )) as Array<{ table_name: string }>;
    return rows.map((row) => row.table_name);
  }

  /** Capture what the server logs: the pino stream the root logger and its children share. */
  function captureLogs(): void {
    const log = h.app.log as unknown as Record<symbol, unknown>;
    const streamSymbol = Object.getOwnPropertySymbols(Object.getPrototypeOf(log) as object)
      .concat(Object.getOwnPropertySymbols(log))
      .find((symbol) => symbol.description === 'pino.stream');
    expect(streamSymbol, 'the harness logger is a pino logger with a stream').toBeDefined();
    const stream = log[streamSymbol!] as { write: (chunk: string) => unknown };
    const write = stream.write;
    stream.write = function (this: unknown, chunk: string) {
      logged.push(String(chunk));
      return write.call(this, chunk);
    };
    restore.push(() => {
      stream.write = write;
    });
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      // Kept, not echoed: what the module would print is read here instead.
      const spy = vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
      restore.push(() => spy.mockRestore());
    }
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
    recording = new RecordingMailer(
      {
        async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
          mails.push(input);
          return { status: 'sent' };
        },
      },
      new PersistentEmailDeliveryRecorder(h.em),
    );
    const queue = (h.container.cradle as unknown as { webhookQueue: { add: (...args: unknown[]) => Promise<unknown> } }).webhookQueue;
    const add = queue.add;
    queue.add = async (_name: unknown, data: unknown) => {
      webhookJobs.push(data as WebhookJobData);
      return undefined;
    };
    restore.push(() => {
      queue.add = add;
    });
    const em = h.em();
    const webhook = em.create(Webhook, {
      name: `Forms minimisation ${RUN}`,
      url: `https://example.invalid/${randomUUID()}`,
      secret: 'shhh',
      eventTypes: [FORMS_EVENTS.ENTRY_SUBMITTED],
      status: 'active',
      organizationId: null,
    });
    await em.flush();
    webhooks.push(webhook.id as string);
  }, 60_000);

  afterAll(async () => {
    for (const undo of restore.reverse()) undo();
    restore = [];
    if (!h) return;
    await deleteForms(h, created);
    const em = h.em();
    await em.nativeDelete(EmailDelivery, { messageId: { $like: 'forms-%' }, recipient: { $like: `%${RUN}%` } });
    if (webhooks.length > 0) await em.nativeDelete(Webhook, { id: { $in: webhooks } });
    await teardownBackendServer(h);
  });

  it('keeps the answers out of audit, deliveries, the job, the logs and public responses, and out of every forms table once deleted', async () => {
    // A published form with a recipient and a confirmation carrying the summary.
    let form = detailOf(await admin('POST', '/api/v1/admin/forms', { name: `Minimisation ${RUN}`, defaultLanguage: FORMS_LANGUAGE }));
    created.push(form.id);
    form = detailOf(
      await admin('PUT', `/api/v1/admin/forms/${form.id}`, {
        expectedRevision: form.revision,
        definition: definition(form.definition.sections[0]!.id),
      }),
    );
    form = detailOf(await admin('POST', `/api/v1/admin/forms/${form.id}/publish`, { expectedRevision: form.revision }));
    form = detailOf(
      await admin('PUT', `/api/v1/admin/forms/${form.id}/notifications`, {
        expectedRevision: form.revision,
        recipients: [RECIPIENT],
        channelRecipients: {},
      }),
    );

    captureLogs();

    // Submit.
    expect((await storefront('GET', `/api/v1/storefront/forms/${form.id}?language=${FORMS_LANGUAGE}`)).statusCode).toBe(200);
    const submitted = await storefront('POST', `/api/v1/storefront/forms/${form.id}/entries?language=${FORMS_LANGUAGE}`, {
      values: { name: SHARED, email: SUBMITTER, message: PRIVATE, privacy: 'on' },
      pageUrl: '/contact',
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(jobs).toHaveLength(1);
    const entryId = jobs[0]!.entryId;
    expect((await storefront('GET', `/api/v1/storefront/forms/${form.id}?language=${FORMS_LANGUAGE}`)).statusCode).toBe(200);

    // Process the notification job as the worker would.
    let progress: unknown = 0;
    const processor = h.container.resolve<
      (job: { data: { entryId: string; shopLanguage: string }; progress: unknown; updateProgress(next: object): Promise<void> }) => Promise<unknown>
    >('formsNotificationProcessor');
    await processor({
      data: jobs[0]!,
      get progress() {
        return progress;
      },
      async updateProgress(next) {
        progress = next;
      },
    });
    const sent = mails.filter((mail) => mail.messageId.startsWith(`forms-${entryId}-`));
    expect(sent.map((mail) => mail.kind).sort()).toEqual(['forms.entry_confirmation', 'forms.entry_notification']);
    // The messages themselves carry the answers — that is their purpose; their records do not.
    for (const mail of sent) expect(mail.text).toContain(PRIVATE);

    // Export: the operator's CSV carries the answers; nothing the export leaves behind does.
    const csv = await admin('GET', `/api/v1/admin/forms/entries/export?formId=${form.id}`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain(PRIVATE);

    // A note, so the deletion is shown to take it as well.
    const note = await admin('POST', `/api/v1/admin/forms/entries/${entryId}/notes`, { body: `Note about ${PRIVATE}` });
    expect(note.statusCode, note.body).toBe(201);

    // While the entry exists, the answers are in its row and nowhere else of the module's tables.
    const tables = await formsTables();
    expect(tables).toEqual(expect.arrayContaining(['forms', 'form_versions', 'form_entries', 'form_entry_notes']));
    expect(await rowsHolding('form_entries', PRIVATE)).toBe(1);

    // Delete.
    expect((await admin('DELETE', `/api/v1/admin/forms/entries/${entryId}`)).statusCode).toBe(204);

    for (const sentinel of SENTINELS) {
      expect(await rowsHolding('audit_log_entries', sentinel), `audit_log_entries holds ${sentinel}`).toBe(0);
      expect(await rowsHolding('email_deliveries', sentinel), `email_deliveries holds ${sentinel}`).toBe(0);
      expect(await rowsHolding('webhook_deliveries', sentinel), `webhook_deliveries holds ${sentinel}`).toBe(0);
      for (const table of tables) expect(await rowsHolding(table, sentinel), `${table} holds ${sentinel}`).toBe(0);
      expect(JSON.stringify(jobs), 'the notification job data').not.toContain(sentinel);
      expect(JSON.stringify(progress), 'the notification job progress').not.toContain(sentinel);
      for (const body of publicBodies) expect(body, 'a public response').not.toContain(sentinel);
      for (const line of logged) expect(line, 'a logged line').not.toContain(sentinel);
    }
    // The job's progress holds no address either.
    expect(JSON.stringify(progress)).not.toContain('@');
    // The email delivery records exist — the absence above is not an absence of rows.
    const deliveries = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "email_deliveries" where "message_id" like ?`, [`forms-${entryId}-%`])) as Array<{ n: number }>;
    expect(deliveries[0]!.n).toBe(2);
    // Logging was captured at all: the requests above were logged.
    expect(logged.length).toBeGreaterThan(0);

    // The webhook delivery carries the shared answer and never the unshared one.
    const delivered = webhookJobs.filter((job) => (job.payload as { entryId?: string }).entryId === entryId);
    expect(delivered).toHaveLength(1);
    const payload = JSON.stringify(delivered[0]!.payload);
    expect(payload).toContain(SHARED);
    expect(payload).not.toContain(PRIVATE);
    expect(payload).not.toContain(SUBMITTER);
  });
});
