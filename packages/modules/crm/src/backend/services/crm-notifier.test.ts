import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AdminNotificationMessage } from '@endora-commerce/contracts';
import { crmNotificationText, opportunityLinkPath, type CrmNotificationText } from './crm-notifier.js';

/**
 * A bell entry of this module is translatable
 * (`specs/143-crm-sales-opportunities/spec.md` FR-085, research N-T1).
 *
 * An entry is read by several administrators in different languages, so it is
 * recorded twice over: the finished English sentence, and the address of its
 * template in this module's bundle with the params that fill it. Three things
 * hold the two together, and nothing else in the tree can — the key is read by
 * the Admin UI's bell, which knows nothing of this module:
 *
 *  - every sentence this module records has a key in **both** bundles;
 *  - the English template, filled with the params, **is** the finished
 *    sentence. So the fallback and the translation cannot drift apart, and the
 *    params provably carry nothing the sentence did not already say — which is
 *    the privacy rule a bell entry is held to (it is read outside the tenant
 *    scope: a number and a name, never a title or a text);
 *  - the bundle ships no `notifications.` key this module does not record.
 */

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

const en = bundle('en');
const pl = bundle('pl');

const fill = (template: string, message: AdminNotificationMessage): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    message.params && name in message.params ? String(message.params[name]) : whole,
  );

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

/** Every sentence the module records, by the function that composes it. */
const SENTENCES: Record<string, CrmNotificationText> = {
  assigned: crmNotificationText.assigned('OPP-000042'),
  message: crmNotificationText.message('OPP-000042'),
  'mention, the author known': crmNotificationText.mention('OPP-000042', 'Ada Author'),
  'mention, the author unknown': crmNotificationText.mention('OPP-000042', null),
  'event reminder, timed': crmNotificationText.eventReminder({
    name: 'Demo at the warehouse',
    when: '2026-10-12 10:00 Europe/Warsaw',
    number: 'OPP-000042',
    allDay: false,
  }),
  'event reminder, all day': crmNotificationText.eventReminder({
    name: 'Offer deadline',
    when: '2026-10-12',
    number: 'OPP-000042',
    allDay: true,
  }),
};

describe('crmNotificationText', () => {
  it('composes the sentences the bell has always shown', () => {
    expect(Object.fromEntries(Object.entries(SENTENCES).map(([name, text]) => [name, text.title]))).toEqual({
      assigned: 'Opportunity OPP-000042 was assigned to you',
      message: 'New message on opportunity OPP-000042',
      'mention, the author known': 'Ada Author mentioned you in opportunity OPP-000042',
      'mention, the author unknown': 'You were mentioned in opportunity OPP-000042',
      'event reminder, timed': 'Reminder: Demo at the warehouse, 2026-10-12 10:00 Europe/Warsaw — opportunity OPP-000042',
      'event reminder, all day': 'Reminder: Offer deadline, all day on 2026-10-12 — opportunity OPP-000042',
    });
  });

  it.each(Object.entries(SENTENCES))('%s — addresses a key of this module’s bundle, in both languages', (_name, text) => {
    expect(text.titleMessage.scope).toBe('crm');
    expect(text.titleMessage.key).toMatch(/^notifications\.[a-zA-Z]+\.title$/);
    expect(en[text.titleMessage.key], `en ${text.titleMessage.key}`).toBeTypeOf('string');
    expect(pl[text.titleMessage.key], `pl ${text.titleMessage.key}`).toBeTypeOf('string');
  });

  it.each(Object.entries(SENTENCES))('%s — the English template filled with the params is the finished sentence', (_name, text) => {
    expect(fill(en[text.titleMessage.key] as string, text.titleMessage)).toBe(text.title);
  });

  it.each(Object.entries(SENTENCES))('%s — carries exactly the params both templates name', (_name, text) => {
    const given = Object.keys(text.titleMessage.params ?? {}).sort();
    expect(placeholders(en[text.titleMessage.key] as string)).toEqual(given);
    expect(placeholders(pl[text.titleMessage.key] as string)).toEqual(given);
    const filled = fill(pl[text.titleMessage.key] as string, text.titleMessage);
    expect(filled).not.toContain('{');
    expect(filled).toContain('OPP-000042');
  });

  it('gives each sentence a key of its own', () => {
    const keys = Object.values(SENTENCES).map((text) => text.titleMessage.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the only reader of the bundle’s notifications.* keys', () => {
    const recorded = Object.values(SENTENCES)
      .map((text) => text.titleMessage.key)
      .sort();
    for (const [language, entries] of [
      ['en', en],
      ['pl', pl],
    ] as const) {
      expect(
        Object.keys(entries)
          .filter((key) => key.startsWith('notifications.'))
          .sort(),
        language,
      ).toEqual(recorded);
    }
  });

  it('a reminder names the Event and its time beside the number — and nothing else (research N-CAL7)', () => {
    // The stated departure from "a number and a name": a reminder has to say
    // of what. It is the Event's name and when it starts; never its
    // description and never the Opportunity's title — the function takes
    // neither, so there is nothing to leak.
    for (const name of ['event reminder, timed', 'event reminder, all day']) {
      expect(Object.keys(SENTENCES[name]?.titleMessage.params ?? {}).sort(), name).toEqual(['name', 'number', 'when']);
    }
  });

  it('leads to the Opportunity, and to the Event on its Events tab when it is about one', () => {
    const id = '00000000-0000-4000-8000-00000000c0de';
    const eventId = '00000000-0000-4000-8000-00000000e0e0';
    expect(opportunityLinkPath(id)).toBe(`/crm/opportunities/${id}`);
    expect(opportunityLinkPath(id, { eventId })).toBe(`/crm/opportunities/${id}?tab=events&event=${eventId}`);
  });

  it('translates: the Polish sentence is not the English one', () => {
    for (const text of Object.values(SENTENCES)) {
      expect(pl[text.titleMessage.key]).not.toBe(en[text.titleMessage.key]);
    }
  });
});
