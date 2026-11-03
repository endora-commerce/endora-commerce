import { describe, expect, it, vi } from 'vitest';
import {
  formDefinitionSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type FormDefinition,
  type FormEntrySubmittedEventV1,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  NotificationDispatch,
  recipientKey,
  type NotificationStore,
  type NotificationSubject,
} from '../services/notification-dispatch.js';
import {
  FORMS_NOTIFICATIONS_QUEUE,
  enqueueEntryNotification,
  formsNotificationProcessor,
  type FormsNotificationJobData,
  type FormsNotificationProducer,
} from './forms-notifications-worker.js';

/**
 * `specs/170-forms-module/` T085 — the notification queue (research R-13, FR-057 – FR-059, US5-6).
 *
 * The subscriber puts an id and a language on the queue and nothing else (FR-055); the processor
 * reads the entry, skips one that is gone or spam, sends one message per recipient of the entry's
 * channel and at most one confirmation, and rethrows a transport failure so BullMQ tries again —
 * without re-sending what already went out.
 */

const ENTRY_ID = '0b0e5a8e-0000-4000-8000-000000000170';
const CHANNEL = '11111111-0000-4000-8000-000000000001';
const OTHER_CHANNEL = '11111111-0000-4000-8000-000000000002';

function definition(confirmationEmail = { enabled: true, includeSummary: false }): FormDefinition {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    sections: [
      {
        id: 's1',
        columns: 1,
        fields: [
          { id: 'f_name', type: 'text', key: 'name' },
          { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
        ],
      },
    ],
    behaviour: { confirmation: { type: 'message' }, captchaRequired: false, confirmationEmail },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: { 'en-US': { 'fields.f_name.label': 'Name', 'fields.f_mail.label': 'E-mail' } },
  });
}

function subject(overrides: {
  status?: NotificationSubject['entry']['status'];
  submitterEmail?: string | null;
  recipients?: string[];
  channelRecipients?: Record<string, string[]>;
  salesChannelId?: string;
  confirmationEmail?: { enabled: boolean; includeSummary: boolean };
} = {}): NotificationSubject {
  return {
    entry: {
      id: ENTRY_ID,
      status: overrides.status ?? 'new',
      salesChannelId: overrides.salesChannelId ?? CHANNEL,
      language: 'pl-PL',
      pageUrl: '/contact',
      answers: { name: 'Ada', email: 'ada@example.com' },
      submitterEmail: overrides.submitterEmail === undefined ? 'ada@example.com' : overrides.submitterEmail,
    },
    form: {
      name: 'Contact',
      recipients: overrides.recipients ?? ['shop@example.com', 'sales@example.com'],
      channelRecipients: overrides.channelRecipients ?? {},
    },
    version: { definition: definition(overrides.confirmationEmail), defaultLanguage: 'en-US' },
  };
}

class FakeStore implements NotificationStore {
  claimed = false;
  readonly calls: string[] = [];
  constructor(private readonly found: NotificationSubject | null) {}
  async load(entryId: string): Promise<NotificationSubject | null> {
    this.calls.push(`load:${entryId}`);
    return this.found;
  }
  async claimConfirmation(entryId: string): Promise<boolean> {
    this.calls.push(`claim:${entryId}`);
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }
  async releaseConfirmation(entryId: string): Promise<void> {
    this.calls.push(`release:${entryId}`);
    this.claimed = false;
  }
}

function mailer(fail: (input: EmailMailerSendInput) => boolean = () => false) {
  const sent: EmailMailerSendInput[] = [];
  return {
    sent,
    port: {
      async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
        if (fail(input)) throw new Error(`smtp down for ${input.to}`);
        sent.push(input);
        return { status: 'sent' };
      },
    },
  };
}

function dispatchOf(store: NotificationStore, port: { send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> }, present = true) {
  return new NotificationDispatch({
    isPresent: () => present,
    store,
    mailer: port,
    translate: async (_language, key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  });
}

const JOB: FormsNotificationJobData = { entryId: ENTRY_ID, shopLanguage: 'en-US' };

describe('the forms.entry.submitted.v1 subscriber', () => {
  it('enqueues the entry id and the channel default language, and nothing else', async () => {
    const jobs: FormsNotificationJobData[] = [];
    const producer: FormsNotificationProducer = {
      enqueue: async (data) => {
        jobs.push(data);
        return true;
      },
      close: async () => {},
    };
    const event: FormEntrySubmittedEventV1 = {
      eventId: 'e1',
      occurredAt: new Date().toISOString(),
      eventType: 'forms.entry.submitted.v1',
      entryId: ENTRY_ID,
      formId: '22222222-0000-4000-8000-000000000001',
      formKey: 'contact',
      formVersion: 1,
      salesChannelId: CHANNEL,
      organizationId: null,
      language: 'pl-PL',
      pageUrl: '/contact',
      submittedAt: new Date().toISOString(),
      answers: { email: 'ada@example.com' },
    };
    await enqueueEntryNotification(
      { producer, channelDefaultLanguage: async (id) => (id === CHANNEL ? 'de-DE' : null) },
      event,
    );
    expect(jobs).toEqual([{ entryId: ENTRY_ID, shopLanguage: 'de-DE' }]);
    expect(Object.keys(jobs[0]!).sort()).toEqual(['entryId', 'shopLanguage']);
    expect(FORMS_NOTIFICATIONS_QUEUE).toBe('forms-notifications');
  });

  it("falls back to the submission's language when the channel is unknown", async () => {
    const jobs: FormsNotificationJobData[] = [];
    const producer: FormsNotificationProducer = { enqueue: async (data) => (jobs.push(data), true), close: async () => {} };
    await enqueueEntryNotification(
      { producer, channelDefaultLanguage: async () => null },
      { entryId: ENTRY_ID, salesChannelId: OTHER_CHANNEL, language: 'pl-PL' } as FormEntrySubmittedEventV1,
    );
    expect(jobs).toEqual([{ entryId: ENTRY_ID, shopLanguage: 'pl-PL' }]);
  });
});

describe('NotificationDispatch — the processor', () => {
  it('asks whether the module is present before any work, and leaves the job for later when it is not', async () => {
    const store = new FakeStore(subject());
    const mail = mailer();
    await expect(dispatchOf(store, mail.port, false).dispatch(JOB)).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(store.calls).toEqual([]);
    expect(mail.sent).toEqual([]);
  });

  it('skips an entry that is gone (deleted) or spam (US5-6)', async () => {
    for (const found of [null, subject({ status: 'spam' })]) {
      const store = new FakeStore(found);
      const mail = mailer();
      const report = await dispatchOf(store, mail.port).dispatch(JOB);
      expect(report.skipped).toBe(found === null ? 'gone' : 'spam');
      expect(mail.sent).toEqual([]);
      expect(store.calls.filter((call) => call.startsWith('claim'))).toEqual([]);
    }
  });

  it("sends one message per recipient of the entry's channel, with Reply-To the submitter", async () => {
    const store = new FakeStore(subject({ confirmationEmail: { enabled: false, includeSummary: false } }));
    const mail = mailer();
    await dispatchOf(store, mail.port).dispatch(JOB);
    expect(mail.sent.map((m) => [m.messageId, m.to])).toEqual([
      [`forms-${ENTRY_ID}-shop-${recipientKey(ENTRY_ID, 'shop@example.com')}`, 'shop@example.com'],
      [`forms-${ENTRY_ID}-shop-${recipientKey(ENTRY_ID, 'sales@example.com')}`, 'sales@example.com'],
    ]);
    for (const message of mail.sent) {
      expect(message).toMatchObject({ kind: 'forms.entry_notification', salesChannelId: CHANNEL, replyTo: 'ada@example.com' });
      expect(message.meta).toBeUndefined();
      expect(message.subject).toBe('mail.notification.subject:{"form":"Contact"}');
    }
  });

  it('uses the channel list instead of the default one, an empty list sending nothing (A-2)', async () => {
    const overridden = new FakeStore(
      subject({ channelRecipients: { [CHANNEL]: ['eu@example.com', 'EU@example.com'] }, confirmationEmail: { enabled: false, includeSummary: false } }),
    );
    const mail = mailer();
    await dispatchOf(overridden, mail.port).dispatch(JOB);
    expect(mail.sent.map((m) => m.to)).toEqual(['eu@example.com']);

    const silenced = new FakeStore(subject({ channelRecipients: { [CHANNEL]: [] }, confirmationEmail: { enabled: false, includeSummary: false } }));
    const quiet = mailer();
    const report = await dispatchOf(silenced, quiet.port).dispatch(JOB);
    expect(quiet.sent).toEqual([]);
    expect(report.shopSent).toBe(0);

    const elsewhere = new FakeStore(
      subject({ salesChannelId: OTHER_CHANNEL, channelRecipients: { [CHANNEL]: ['eu@example.com'] }, confirmationEmail: { enabled: false, includeSummary: false } }),
    );
    const defaults = mailer();
    await dispatchOf(elsewhere, defaults.port).dispatch(JOB);
    expect(defaults.sent.map((m) => m.to)).toEqual(['shop@example.com', 'sales@example.com']);
  });

  it('has no Reply-To and sends no confirmation when the submitter e-mail is hidden or absent', async () => {
    const store = new FakeStore(subject({ submitterEmail: null }));
    const mail = mailer();
    const report = await dispatchOf(store, mail.port).dispatch(JOB);
    expect(mail.sent).toHaveLength(2);
    for (const message of mail.sent) expect(message.replyTo).toBeUndefined();
    expect(report.confirmation).toBe('not_wanted');
    expect(store.calls.filter((call) => call.startsWith('claim'))).toEqual([]);
  });

  it('sends the confirmation once, to the submitter, in the submission language', async () => {
    const store = new FakeStore(subject({ recipients: [] }));
    const mail = mailer();
    const first = await dispatchOf(store, mail.port).dispatch(JOB);
    expect(first.confirmation).toBe('sent');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      messageId: `forms-${ENTRY_ID}-confirmation`,
      to: 'ada@example.com',
      kind: 'forms.entry_confirmation',
      salesChannelId: CHANNEL,
    });
    expect(mail.sent[0]!.replyTo).toBeUndefined();

    const again = await dispatchOf(store, mail.port).dispatch(JOB);
    expect(again.confirmation).toBe('already_sent');
    expect(mail.sent).toHaveLength(1);
  });

  it('sends no confirmation when the version does not ask for one', async () => {
    const store = new FakeStore(subject({ recipients: [], confirmationEmail: { enabled: false, includeSummary: true } }));
    const mail = mailer();
    expect((await dispatchOf(store, mail.port).dispatch(JOB)).confirmation).toBe('not_wanted');
    expect(mail.sent).toEqual([]);
  });

  it('rethrows a transport failure after trying every message, and a retry sends only what did not go', async () => {
    const store = new FakeStore(subject());
    let down = true;
    const mail = mailer((input) => down && (input.to === 'shop@example.com' || input.messageId.endsWith('confirmation')));
    const progress: { shopSent: string[] } = { shopSent: [] };
    const attempt = {
      get sent() {
        return progress.shopSent;
      },
      record: vi.fn(async (sent: readonly string[]) => {
        progress.shopSent = [...sent];
      }),
    };
    const SHOP = `forms-${ENTRY_ID}-shop-${recipientKey(ENTRY_ID, 'shop@example.com')}`;
    const SALES = `forms-${ENTRY_ID}-shop-${recipientKey(ENTRY_ID, 'sales@example.com')}`;
    await expect(dispatchOf(store, mail.port).dispatch(JOB, attempt)).rejects.toThrow(/smtp down for shop@example.com/);
    expect(mail.sent.map((m) => m.to)).toEqual(['sales@example.com']);
    expect(progress.shopSent).toEqual([recipientKey(ENTRY_ID, 'sales@example.com')]);
    // The confirmation's claim was given back, so the retry may send it.
    expect(store.claimed).toBe(false);

    down = false;
    await dispatchOf(store, mail.port).dispatch(JOB, attempt);
    expect(mail.sent.map((m) => m.messageId)).toEqual([SALES, SHOP, `forms-${ENTRY_ID}-confirmation`]);
    expect([...progress.shopSent].sort()).toEqual(
      [recipientKey(ENTRY_ID, 'shop@example.com'), recipientKey(ENTRY_ID, 'sales@example.com')].sort(),
    );
  });

  it('keys what was sent by recipient, not by position: a list edited between attempts re-sends nothing and sends the new address', async () => {
    let current = subject({ recipients: ['shop@example.com', 'sales@example.com'], confirmationEmail: { enabled: false, includeSummary: false } });
    const store: NotificationStore = {
      load: async () => current,
      claimConfirmation: async () => true,
      releaseConfirmation: async () => {},
    };
    let down = true;
    const mail = mailer((input) => down && input.to === 'shop@example.com');
    let progress: unknown = 0;
    const job = {
      data: JOB,
      get progress() {
        return progress;
      },
      async updateProgress(next: object) {
        progress = next;
      },
    };
    const process = formsNotificationProcessor(dispatchOf(store, mail.port));

    await expect(process(job)).rejects.toThrow(/smtp down for shop@example.com/);
    expect(mail.sent.map((m) => m.to)).toEqual(['sales@example.com']);

    // Between the attempts the operator reorders the list, changes the case of the address that
    // already went out and adds one — the sent address now sits at index 0, the new one at index 1.
    current = subject({
      recipients: ['Sales@Example.com', 'new@example.com', 'shop@example.com'],
      confirmationEmail: { enabled: false, includeSummary: false },
    });
    down = false;
    await process(job);

    expect(mail.sent.map((m) => m.to)).toEqual(['sales@example.com', 'new@example.com', 'shop@example.com']);
    const ids = mail.sent.map((m) => m.messageId);
    expect(new Set(ids).size).toBe(ids.length);
    // The job's progress holds neither an address nor an answer.
    const stored = JSON.stringify(progress);
    expect(stored).not.toMatch(/@|example|Ada/i);
    expect((progress as { shopSent: unknown[] }).shopSent).toHaveLength(3);
    for (const key of (progress as { shopSent: unknown[] }).shopSent) expect(key).toMatch(/^[0-9a-f]{16}$/);
  });
});
