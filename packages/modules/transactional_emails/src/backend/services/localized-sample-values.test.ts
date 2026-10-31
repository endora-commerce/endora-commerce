// Issue #560 — a template variable's sample value in the language being edited.
//
// A manifest's `sampleValue` is English; a `sampleValueKey` names an entry in
// the declaring module's own bundle that carries the sample in every shipped
// language. The preview renders the e-mail *in* a language, so the sample it
// substitutes — and the one the editor's variable list and live preview read
// off the detail — is that language's, resolved the way a palette action's
// `labelKey` is. English, and then the manifest's own literal, are the fallback.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, EmailVariableDescriptor } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import type { TransactionalEmail } from '../entities/transactional-email.entity.js';
import type { BrandingService } from './branding.service.js';
import type { ContentResolver } from './content-resolver.js';
import { EmailDefaultsRegistry } from './email-defaults-registry.js';
import type { EmbedResolver } from './embed-resolver.js';
import { TransactionalEmailService } from './transactional-email.service.js';

const STATUS_LABEL: EmailVariableDescriptor = {
  key: 'statusLabel',
  label: 'Status',
  sampleValue: 'Awaiting verification',
  sampleValueKey: 'emails.newOrgRegistration.sample.statusLabel',
};

const BUNDLES: Record<string, Record<string, string>> = {
  en: { 'organizations.emails.newOrgRegistration.sample.statusLabel': 'Awaiting verification' },
  pl: { 'organizations.emails.newOrgRegistration.sample.statusLabel': 'Oczekuje na weryfikację' },
};

/** The `_i18n` resolver's contract: requested language, English, placeholder. */
const translator: AdminI18nTranslatePort = {
  translate: async (moduleId, key, language) =>
    BUNDLES[language]?.[`${moduleId}.${key}`] ??
    BUNDLES['en']?.[`${moduleId}.${key}`] ??
    `${moduleId}.${key}`,
};

function email(variables: EmailVariableDescriptor[]): TransactionalEmail {
  return {
    id: 'e-1',
    code: 'new_org_registration',
    name: 'New organization registration (admin)',
    ownerModule: 'organizations',
    description: null,
    groupCode: 'organizations',
    variables,
    languages: ['en-US', 'pl-PL'],
    defaultSubject: {},
    defaultContent: {},
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TransactionalEmail;
}

function serviceOver(
  row: TransactionalEmail,
  i18n: AdminI18nTranslatePort | null = translator,
): TransactionalEmailService {
  const em = {
    findOne: async () => row,
    count: async () => 0,
  } as unknown as EntityManager;
  const contentResolver = {
    resolve: async (_em: unknown, _email: unknown, opts: { language: string }) => ({
      subject: 'Status: {{var statusLabel}}',
      content: { root: { props: {} }, content: [] },
      source: 'default',
      version: null,
      language: opts.language,
    }),
  } as unknown as ContentResolver;
  return new TransactionalEmailService({
    emFactory: () => em,
    contentResolver,
    branding: { resolve: async () => ({ logoUrl: '', accentColor: '#000000' }) } as unknown as BrandingService,
    embeds: { resolve: async () => ({ blocks: {}, templates: {} }) } as unknown as EmbedResolver,
    defaults: new EmailDefaultsRegistry(),
    ...(i18n ? { translator: i18n } : {}),
  });
}

describe('transactional_emails — per-language sample values (issue #560)', () => {
  it('previews a Polish e-mail with the Polish sample value', async () => {
    const out = await serviceOver(email([STATUS_LABEL])).preview('new_org_registration', {
      salesChannelId: null,
      language: 'pl-PL',
    });
    expect(out.subject).toBe('Status: Oczekuje na weryfikację');
  });

  it('previews an English e-mail with the English sample value', async () => {
    const out = await serviceOver(email([STATUS_LABEL])).preview('new_org_registration', {
      salesChannelId: null,
      language: 'en-US',
    });
    expect(out.subject).toBe('Status: Awaiting verification');
  });

  it('hands the editor the sample value of the language it is editing', async () => {
    const service = serviceOver(email([STATUS_LABEL]));
    const pl = await service.getDetail('new_org_registration', null, 'pl-PL');
    const en = await service.getDetail('new_org_registration', null, 'en-US');
    expect(pl.variables[0]?.sampleValue).toBe('Oczekuje na weryfikację');
    expect(en.variables[0]?.sampleValue).toBe('Awaiting verification');
  });

  it('falls back to English for a content language the platform ships no bundle for', async () => {
    const out = await serviceOver(email([STATUS_LABEL])).preview('new_org_registration', {
      salesChannelId: null,
      language: 'de-DE',
    });
    expect(out.subject).toBe('Status: Awaiting verification');
  });

  it('keeps the manifest literal when the key resolves to nothing or no resolver is wired', async () => {
    const unresolved = { ...STATUS_LABEL, sampleValueKey: 'emails.missing.sample' };
    const viaPlaceholder = await serviceOver(email([unresolved])).preview('new_org_registration', {
      salesChannelId: null,
      language: 'pl-PL',
    });
    expect(viaPlaceholder.subject).toBe('Status: Awaiting verification');

    const unwired = await serviceOver(email([STATUS_LABEL]), null).preview('new_org_registration', {
      salesChannelId: null,
      language: 'pl-PL',
    });
    expect(unwired.subject).toBe('Status: Awaiting verification');
  });

  it('keeps the manifest literal when the resolver refuses', async () => {
    const refusing: AdminI18nTranslatePort = {
      translate: async () => {
        throw new Error('_i18n is not answering');
      },
    };
    const out = await serviceOver(email([STATUS_LABEL]), refusing).preview('new_org_registration', {
      salesChannelId: null,
      language: 'pl-PL',
    });
    expect(out.subject).toBe('Status: Awaiting verification');
  });
});
