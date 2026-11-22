// Issue #1809 — an e-mail's name, description and "why it cannot be switched
// off" reason were English in a Polish admin.
//
// All three are platform prose the sending module wrote: the name and the
// description in its manifest, the reason in its registered defaults. The
// response is an HTTP answer whose reader's language the backend resolves, so
// the backend translates (`specs/conventions/module-i18n.md`, case 1), from the
// sending module's bundle under `transactionalEmails.<code>.<field>`, and keeps
// the declared English when the bundle has no entry or the resolver refuses.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import type { TransactionalEmail } from '../entities/transactional-email.entity.js';
import type { BrandingService } from './branding.service.js';
import type { ContentResolver } from './content-resolver.js';
import { EmailDefaultsRegistry } from './email-defaults-registry.js';
import type { EmbedResolver } from './embed-resolver.js';
import { TransactionalEmailService } from './transactional-email.service.js';

const REASON = "The guest's only lasting way back to the case.";

const BUNDLES: Record<string, Record<string, string>> = {
  en: {
    'returns.transactionalEmails.return_guest_submitted.name': 'Complaint received (to a guest)',
    'returns.transactionalEmails.return_guest_submitted.description': 'Sent to a guest who filed a complaint.',
    'returns.transactionalEmails.return_guest_submitted.reason': REASON,
  },
  pl: {
    'returns.transactionalEmails.return_guest_submitted.name': 'Przyjęcie reklamacji (do gościa)',
    'returns.transactionalEmails.return_guest_submitted.description': 'Wysyłany do gościa, który złożył reklamację.',
    'returns.transactionalEmails.return_guest_submitted.reason': 'Jedyny trwały sposób, by gość wrócił do sprawy.',
  },
};

const translator: AdminI18nTranslatePort = {
  translate: async (moduleId, key, language) =>
    BUNDLES[language]?.[`${moduleId}.${key}`] ?? BUNDLES['en']?.[`${moduleId}.${key}`] ?? `${moduleId}.${key}`,
};

const row = {
  id: 'e-1',
  code: 'return_guest_submitted',
  name: 'Complaint received (to a guest)',
  ownerModule: 'returns',
  description: 'Sent to a guest who filed a complaint.',
  groupCode: 'returns',
  variables: [],
  languages: ['en-US', 'pl-PL'],
  defaultSubject: {},
  defaultContent: {},
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as TransactionalEmail;

function serviceOver(i18n: AdminI18nTranslatePort | null = translator, email = row): TransactionalEmailService {
  const em = {
    find: async () => [email],
    findOne: async () => email,
    count: async () => 0,
  } as unknown as EntityManager;
  const contentResolver = {
    resolve: async (_em: unknown, _email: unknown, opts: { language: string }) => ({
      subject: 'S',
      content: { root: { props: {} }, content: [] },
      source: 'default',
      version: null,
      language: opts.language,
    }),
  } as unknown as ContentResolver;
  const defaults = new EmailDefaultsRegistry();
  defaults.register(
    'return_guest_submitted',
    { defaultSubject: {}, defaultContent: {}, languages: ['en-US'], nonDeactivatable: { reason: REASON } },
    'returns',
  );
  return new TransactionalEmailService({
    emFactory: () => em,
    contentResolver,
    branding: { resolve: async () => ({ logoUrl: '', accentColor: '#000000' }) } as unknown as BrandingService,
    embeds: { resolve: async () => ({ blocks: {}, templates: {} }) } as unknown as EmbedResolver,
    defaults,
    ...(i18n ? { translator: i18n } : {}),
  });
}

describe('transactional_emails — the declared text in the reader’s language (issue #1809)', () => {
  it('lists an e-mail by its Polish name and reason for a Polish reader', async () => {
    const [email] = await serviceOver().list('pl');
    expect(email?.name).toBe('Przyjęcie reklamacji (do gościa)');
    expect(email?.nonDeactivatableReason).toBe('Jedyny trwały sposób, by gość wrócił do sprawy.');
  });

  it('answers the summary after a switch in the reader’s language too', async () => {
    const email = await serviceOver().summary('return_guest_submitted', 'pl');
    expect(email.nonDeactivatableReason).toBe('Jedyny trwały sposób, by gość wrócił do sprawy.');
  });

  it('names and describes the e-mail in the reader’s language on the detail, whatever language is edited', async () => {
    const detail = await serviceOver().getDetail('return_guest_submitted', null, 'en-US', 'pl');
    expect(detail.name).toBe('Przyjęcie reklamacji (do gościa)');
    expect(detail.description).toBe('Wysyłany do gościa, który złożył reklamację.');
    expect(detail.nonDeactivatableReason).toBe('Jedyny trwały sposób, by gość wrócił do sprawy.');
  });

  it('answers the declared English for an English reader, with no reader, unwired or refusing', async () => {
    expect((await serviceOver().list('en'))[0]?.nonDeactivatableReason).toBe(REASON);
    expect((await serviceOver().list())[0]?.name).toBe('Complaint received (to a guest)');
    expect((await serviceOver(null).list('pl'))[0]?.nonDeactivatableReason).toBe(REASON);
    const refusing: AdminI18nTranslatePort = {
      translate: async () => {
        throw new Error('_i18n is not answering');
      },
    };
    expect((await serviceOver(refusing).list('pl'))[0]?.nonDeactivatableReason).toBe(REASON);
  });

  it('keeps the declared English when the bundle holds no entry', async () => {
    const other = { ...row, code: 'return_other', name: 'Other' } as unknown as TransactionalEmail;
    expect((await serviceOver(translator, other).list('pl'))[0]?.name).toBe('Other');
  });
});
