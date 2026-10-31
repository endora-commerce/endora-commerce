import { readFileSync } from 'node:fs';

import type { SupportedLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { describeCheckoutRefusal, describeModerationStatus } from './moderation-message.js';

/**
 * Issue #95 (`organizations`) — the customer-safe sentence explaining why an
 * Organization cannot transact was Polish whatever the request's language. It
 * is now written in the language the response is answered in, from this
 * module's bundle; the Polish sentences are the ones the storefront showed.
 */

const bundle = (language: SupportedLanguage): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

function bundleTranslate(key: string, language: SupportedLanguage): Promise<string> {
  return Promise.resolve(bundle(language)[key] ?? bundle('en')[key] ?? `organizations.${key}`);
}

describe('describeModerationStatus — GET /api/v1/me', () => {
  it('answers nothing for an active organization', async () => {
    await expect(describeModerationStatus(bundleTranslate, 'active', 'pl')).resolves.toBeNull();
  });

  it('answers the Polish sentences as before', async () => {
    await expect(describeModerationStatus(bundleTranslate, 'pending_verification', 'pl')).resolves.toBe(
      'Twoja Organizacja oczekuje na weryfikację. Zamówienia i Zapytania Ofertowe będą dostępne po jej zakończeniu.',
    );
    await expect(describeModerationStatus(bundleTranslate, 'blocked', 'pl')).resolves.toBe(
      'Składanie Zamówień i Zapytań Ofertowych jest obecnie wstrzymane. Prosimy o kontakt z opiekunem konta.',
    );
    await expect(describeModerationStatus(bundleTranslate, 'rejected', 'pl')).resolves.toBe(
      'Rejestracja Twojej Organizacji została odrzucona. Prosimy o kontakt z administracją platformy.',
    );
  });

  it('answers English for an English request', async () => {
    await expect(describeModerationStatus(bundleTranslate, 'pending_verification', 'en')).resolves.toBe(
      'Your organization is awaiting verification. Orders and requests for quotation will be available once it is complete.',
    );
    await expect(describeModerationStatus(bundleTranslate, 'blocked', 'en')).resolves.toBe(
      'Placing orders and requests for quotation is currently suspended. Please contact your account manager.',
    );
  });

  it('answers English in code when no translator is wired', async () => {
    await expect(describeModerationStatus(undefined, 'rejected', 'pl')).resolves.toBe(
      "Your organization's registration was rejected. Please contact the platform administration.",
    );
  });
});

describe('describeCheckoutRefusal — POST /api/v1/storefront/checkout/preflight', () => {
  it('answers the Polish sentences as before', async () => {
    await expect(describeCheckoutRefusal(bundleTranslate, 'pending_verification', 'pl')).resolves.toBe(
      'Twoja Organizacja oczekuje na weryfikację. Zamówienia będą dostępne po jej zakończeniu.',
    );
    await expect(describeCheckoutRefusal(bundleTranslate, 'blocked', 'pl')).resolves.toBe(
      'Składanie Zamówień jest obecnie wstrzymane. Prosimy o kontakt z opiekunem konta.',
    );
    await expect(describeCheckoutRefusal(bundleTranslate, 'rejected', 'pl')).resolves.toBe(
      'Rejestracja Twojej Organizacji została odrzucona. Prosimy o kontakt z administracją platformy.',
    );
    await expect(describeCheckoutRefusal(bundleTranslate, 'archived', 'pl')).resolves.toBe(
      'Składanie Zamówień obecnie niedostępne.',
    );
  });

  it('answers English for an English request', async () => {
    await expect(describeCheckoutRefusal(bundleTranslate, 'pending_verification', 'en')).resolves.toBe(
      'Your organization is awaiting verification. Orders will be available once it is complete.',
    );
    await expect(describeCheckoutRefusal(bundleTranslate, 'archived', 'en')).resolves.toBe(
      'Placing orders is currently unavailable.',
    );
  });
});
