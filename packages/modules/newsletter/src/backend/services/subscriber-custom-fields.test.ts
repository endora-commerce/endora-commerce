import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { NewsletterSubscriberService, mergeTypedCustomFields } from './subscriber.service.js';
import type { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';

/**
 * `specs/169-page-builder-contact-form/` US7, FR-026, research R-11 (T171) — a
 * subscriber keeps a custom-field value only when its key is defined **and**
 * the value matches the field's type. Before 169 the merge checked the key
 * alone, so a text landed in a number field. A mismatched value is dropped,
 * not refused: no caller of the shared merge (public subscribe, admin create,
 * self subscribe) gets a new 400.
 */

const DEFINED = [
  { key: 'age', type: 'number' as const },
  { key: 'vip', type: 'boolean' as const },
  { key: 'born', type: 'date' as const },
  { key: 'company', type: 'text' as const },
];

describe('mergeTypedCustomFields (T171)', () => {
  it('stores a valid value of every type', () => {
    expect(
      mergeTypedCustomFields(DEFINED, {}, { age: 42, vip: true, born: '1990-02-28', company: 'Acme' }),
    ).toEqual({ age: 42, vip: true, born: '1990-02-28', company: 'Acme' });
  });

  it('drops a value whose type does not match the field', () => {
    expect(mergeTypedCustomFields(DEFINED, {}, { age: 'abc' })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { age: Number.NaN })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { vip: 'yes' })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { born: '2026-13-40' })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { born: 'tomorrow' })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { born: '2026-02-30' })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { company: 'x'.repeat(501) })).toEqual({});
    expect(mergeTypedCustomFields(DEFINED, {}, { company: 7 })).toEqual({});
  });

  it('keeps a 500-character text', () => {
    expect(mergeTypedCustomFields(DEFINED, {}, { company: 'x'.repeat(500) })).toEqual({ company: 'x'.repeat(500) });
  });

  it('drops an unknown key, as before', () => {
    expect(mergeTypedCustomFields(DEFINED, {}, { shoeSize: 44 })).toEqual({});
  });

  it('null clears a defined field', () => {
    expect(mergeTypedCustomFields(DEFINED, { age: 42 }, { age: null })).toEqual({ age: null });
  });

  it('keeps the values already stored and leaves them alone when the new one is dropped', () => {
    expect(mergeTypedCustomFields(DEFINED, { age: 42, company: 'Acme' }, { age: 'abc', vip: false })).toEqual({
      age: 42,
      company: 'Acme',
      vip: false,
    });
  });
});

describe('the subscriber service applies the typed merge (T171)', () => {
  it('stores only the type-correct values of a sign-up', async () => {
    const em = {
      find: async () => DEFINED.map((field, index) => ({ id: String(index), label: field.key, ...field })),
    } as unknown as EntityManager;
    const service = new NewsletterSubscriberService({ emFactory: () => em } as never);
    const subscriber = { customFields: {} } as NewsletterSubscriber;
    await (
      service as unknown as {
        mergeCustomFields: (em: EntityManager, s: NewsletterSubscriber, v: Record<string, unknown>) => Promise<void>;
      }
    ).mergeCustomFields(em, subscriber, { age: 'abc', vip: true, born: 'tomorrow', company: 'Acme', other: 1 });
    expect(subscriber.customFields).toEqual({ vip: true, company: 'Acme' });
  });
});
