import { readFileSync } from 'node:fs';

import type { RecordAdminNotificationInput, SupportedLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { OrgRegistrationNotifier } from './org-registration-notifier.js';

/**
 * Issue #94 — the notifier's in-code tier was Polish. The language is a
 * parameter now: the bell entry carries a key for its reader's language beside
 * an English sentence, and the fallback e-mail is composed from this module's
 * bundle in the deployment's language, English when the bundle cannot answer.
 *
 * The Polish e-mail is asserted byte for byte against what the notifier sent
 * before the move, because it is what a Polish deployment's recipients read.
 */

const bundle = (language: SupportedLanguage): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

/** `adminI18nService.translate` over this module's real bundles, English fallback included. */
function bundleTranslate(key: string, language: SupportedLanguage, params?: Record<string, string | number>) {
  const template = bundle(language)[key] ?? bundle('en')[key];
  if (template === undefined) return Promise.resolve(`organizations.${key}`);
  return Promise.resolve(
    template.replace(/\{(\w+)\}/g, (_, name: string) =>
      params?.[name] != null ? String(params[name]) : `{${name}}`,
    ),
  );
}

interface Sent {
  readonly notifications: RecordAdminNotificationInput[];
  readonly mails: { subject: string; text: string }[];
  readonly templateVariables: Record<string, unknown>[];
}

function notifier(options: {
  status: 'pending_verification' | 'active';
  language?: SupportedLanguage;
  translate?: typeof bundleTranslate;
}): { subject: OrgRegistrationNotifier; sent: Sent } {
  const sent: Sent = { notifications: [], mails: [], templateVariables: [] };
  const org = { id: 'org-1', name: 'Acme Sp. z o.o.', taxId: 'PL5260001246', status: options.status };
  const subject = new OrgRegistrationNotifier({
    emFactory: () => ({ findOne: async () => org }) as never,
    adminNotificationService: {
      record: async (input: RecordAdminNotificationInput) => {
        sent.notifications.push(input);
      },
    } as never,
    mailer: {
      send: async (input: { subject: string; text: string }) => {
        sent.mails.push({ subject: input.subject, text: input.text });
        return { status: 'sent' };
      },
    } as never,
    resolveRecipients: async () => ['ops@example.com'],
    templateEmail: {
      trySend: async (input) => {
        sent.templateVariables.push(input.variables);
        return false;
      },
    },
    ...(options.language ? { resolveLanguage: async () => options.language! } : {}),
    ...(options.translate ? { translate: options.translate } : {}),
    onError: (err) => {
      throw err;
    },
  });
  return { subject, sent };
}

describe('OrgRegistrationNotifier — the language is a parameter (issue #94)', () => {
  it('sends the Polish fallback e-mail byte for byte as before, from the Polish bundle', async () => {
    const { subject, sent } = notifier({
      status: 'pending_verification',
      language: 'pl',
      translate: bundleTranslate,
    });
    await subject.handleRegistered('org-1');

    expect(sent.mails).toEqual([
      {
        subject: 'Nowa Organizacja: Acme Sp. z o.o.',
        text: [
          'Zarejestrowała się nowa Organizacja na platformie B2B.',
          '',
          '  Nazwa:   Acme Sp. z o.o.',
          '  NIP/VAT: PL5260001246',
          '  Status:  Oczekuje na weryfikację',
          '',
          'Otwórz w Panelu Administracyjnym: /organizations/org-1',
        ].join('\n'),
      },
    ]);
    expect(sent.templateVariables[0]?.['statusLabel']).toBe('Oczekuje na weryfikację');
  });

  it('labels an active organization in Polish as before', async () => {
    const { subject, sent } = notifier({ status: 'active', language: 'pl', translate: bundleTranslate });
    await subject.handleRegistered('org-1');

    expect(sent.mails[0]?.text).toContain('\n  Status:  Aktywna\n');
    expect(sent.templateVariables[0]?.['statusLabel']).toBe('Aktywna');
  });

  it('sends the English fallback e-mail from the English bundle', async () => {
    const { subject, sent } = notifier({
      status: 'pending_verification',
      language: 'en',
      translate: bundleTranslate,
    });
    await subject.handleRegistered('org-1');

    expect(sent.mails).toEqual([
      {
        subject: 'New organization: Acme Sp. z o.o.',
        text: [
          'A new organization has registered on the B2B platform.',
          '',
          '  Name:    Acme Sp. z o.o.',
          '  Tax ID:  PL5260001246',
          '  Status:  Awaiting verification',
          '',
          'Open in the admin panel: /organizations/org-1',
        ].join('\n'),
      },
    ]);
    expect(sent.templateVariables[0]?.['statusLabel']).toBe('Awaiting verification');
  });

  it('falls back to English in code when no bundle can answer, whatever the language', async () => {
    const { subject, sent } = notifier({
      status: 'active',
      language: 'pl',
      translate: async (key) => `organizations.${key}`,
    });
    await subject.handleRegistered('org-1');

    expect(sent.mails[0]?.subject).toBe('New organization: Acme Sp. z o.o.');
    expect(sent.mails[0]?.text).toContain('\n  Status:  Active\n');
  });

  it('defaults to English when nothing says which language to write in', async () => {
    const { subject, sent } = notifier({ status: 'active' });
    await subject.handleRegistered('org-1');

    expect(sent.mails[0]?.subject).toBe('New organization: Acme Sp. z o.o.');
  });

  it('writes the bell entry in English with a key its reader translates', async () => {
    const { subject, sent } = notifier({ status: 'pending_verification', language: 'pl', translate: bundleTranslate });
    await subject.handleRegistered('org-1');

    const [entry] = sent.notifications;
    expect(entry).toMatchObject({
      title: 'New organization: Acme Sp. z o.o.',
      body: 'Awaiting verification.',
      titleMessage: {
        scope: 'organizations',
        key: 'notifications.newRegistration.title',
        params: { name: 'Acme Sp. z o.o.' },
      },
      bodyMessage: { scope: 'organizations', key: 'notifications.newRegistration.body.pending' },
    });
    // The reader in Polish sees what the bell showed before.
    expect(await bundleTranslate(entry!.titleMessage!.key, 'pl', entry!.titleMessage!.params)).toBe(
      'Nowa Organizacja: Acme Sp. z o.o.',
    );
    expect(await bundleTranslate(entry!.bodyMessage!.key, 'pl')).toBe('Oczekuje na weryfikację.');
  });
});
