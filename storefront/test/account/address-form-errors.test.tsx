import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import type { AddressPayload } from '../../lib/api/organization';
import { visibleText } from './i18n/text';

/**
 * Issue #792 (architect ruling of 2026-11-05, for `specs/173-b2c-address-book-merge/`
 * release 1) — the shared address form gives **specific** error copy for each
 * field: what is wrong with it and what to do (`ux-laws` §174, §290), in the
 * store's language. The field name plus the issue's code picks the sentence;
 * the validator's own `issue` text is never shown. One implementation serves
 * `/addresses` and `/organization/addresses`.
 *
 * The codes come from two places: the form's own parse of the published
 * schema, and the API's refusal (`VALIDATION_FAILED` details, or the
 * `dictionaries` code a refused country carries).
 */

let refusal: StorefrontApiError | null = null;
const created: AddressPayload[] = [];

vi.mock('../../lib/api/organization', () => ({
  createAddress: async (_session: string, payload: AddressPayload) => {
    if (refusal) throw refusal;
    created.push(payload);
    return { id: 'a1' };
  },
  updateAddress: async () => undefined,
  deleteAddress: async () => undefined,
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: Record<string, unknown>) => <select {...props} />,
}));

const { createAddressAction } = await import('../../lib/actions/addresses');
const { IDLE_ADDRESS_FORM, fieldErrorKey, ADDRESS_FIELDS } = await import('../../lib/account/address-errors');
const { AddressForm } = await import('../../components/account/AddressForm');
const { tForLocale } = await import('../../lib/i18n/messages');

const VALID = {
  returnTo: '/addresses',
  kind: 'delivery',
  recipientName: 'Anna Nowak',
  street: 'ul. Długa 5',
  city: 'Gdańsk',
  postalCode: '80-001',
  country: 'PL',
  phone: '',
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** The English sentences an issue's own text could be — none may reach the page. */
const VALIDATOR_TEXT = /too small|too big|expected string|Invalid input|String must/i;

beforeEach(() => {
  refusal = null;
  created.length = 0;
});

describe('the address form refuses a field with that field’s own sentence (#792)', () => {
  it('names each empty required field, and why, from the form’s own parse', async () => {
    const state = await createAddressAction(
      IDLE_ADDRESS_FORM,
      form({ ...VALID, recipientName: '', street: '', city: '', postalCode: '' }),
    );
    expect(created).toEqual([]);
    expect(state.error).toBe('VALIDATION_FAILED');
    expect(state.fields).toEqual([
      { field: 'recipientName', issue: 'required' },
      { field: 'street', issue: 'required' },
      { field: 'city', issue: 'required' },
      { field: 'postalCode', issue: 'required' },
    ]);
  });

  it('says a field is too long, from the form’s own parse', async () => {
    const state = await createAddressAction(IDLE_ADDRESS_FORM, form({ ...VALID, phone: '1'.repeat(40) }));
    expect(state.fields).toEqual([{ field: 'phone', issue: 'tooLong' }]);
  });

  it('reads a refused country as the dictionaries code it carries', async () => {
    refusal = new StorefrontApiError(409, 'DICTIONARY_ENTRY_INACTIVE', 'Country code YU is no longer available for new entries.', undefined, [
      { path: 'country', issue: 'DICTIONARY_ENTRY_INACTIVE' },
    ]);
    const state = await createAddressAction(IDLE_ADDRESS_FORM, form({ ...VALID, country: 'YU' }));
    expect(state.fields).toEqual([{ field: 'country', issue: 'countryUnavailable' }]);
  });

  it('keeps an API validation refusal to the field it names, and never reads the validator’s text', async () => {
    refusal = new StorefrontApiError(400, 'VALIDATION_FAILED', 'Validation failed.', undefined, [
      { path: 'street', issue: 'Too small: expected string to have >=1 characters' },
      { path: 'somethingElse', issue: 'Invalid input' },
    ]);
    const state = await createAddressAction(IDLE_ADDRESS_FORM, form(VALID));
    expect(state).toEqual({ error: 'VALIDATION_FAILED', fields: [{ field: 'street', issue: 'invalid' }] });
    expect(JSON.stringify(state)).not.toMatch(VALIDATOR_TEXT);
  });

  it('a refusal it cannot name is the form’s generic failure, with no field', async () => {
    refusal = new StorefrontApiError(500, 'INTERNAL', 'Database exploded at row 7 for Anna Nowak.');
    const state = await createAddressAction(IDLE_ADDRESS_FORM, form(VALID));
    expect(state).toEqual({ error: 'SAVE_FAILED', fields: [] });
  });

  it('a valid address is created and the page says so', async () => {
    await expect(createAddressAction(IDLE_ADDRESS_FORM, form(VALID))).rejects.toThrow(
      'redirect /addresses?status=created',
    );
    expect(created).toHaveLength(1);
  });
});

describe.each(['en-US', 'pl-PL'])('every field has its own copy for every issue it can meet (%s)', (locale) => {
  const t = tForLocale(locale);
  const ISSUES = ['required', 'tooLong', 'countryUnavailable', 'countryUnknown', 'invalid'] as const;

  it('no two fields share a sentence, and no sentence is the generic one', () => {
    const generic = t('account.addresses.error.VALIDATION_FAILED');
    const perField = ADDRESS_FIELDS.map((field) => new Set(ISSUES.map((issue) => t(fieldErrorKey({ field, issue })))));
    for (const sentences of perField) {
      for (const sentence of sentences) {
        expect(sentence).not.toBe(generic);
        expect(sentence).not.toMatch(/^account\./);
      }
    }
    for (let i = 0; i < perField.length; i += 1) {
      for (let j = i + 1; j < perField.length; j += 1) {
        for (const sentence of perField[i]!) expect(perField[j]!.has(sentence)).toBe(false);
      }
    }
  });

  it('a required field and an over-long one read differently', () => {
    for (const field of ['recipientName', 'street', 'city', 'postalCode'] as const) {
      expect(t(fieldErrorKey({ field, issue: 'required' }))).not.toBe(t(fieldErrorKey({ field, issue: 'tooLong' })));
    }
    expect(t(fieldErrorKey({ field: 'country', issue: 'countryUnavailable' }))).not.toBe(
      t(fieldErrorKey({ field: 'country', issue: 'countryUnknown' })),
    );
  });

  it('renders each field’s sentence under it, described and marked invalid, and no validator text', () => {
    const html = renderToString(
      <AddressForm
        action={async (s) => s}
        locale={locale}
        returnTo="/addresses"
        initialState={{
          error: 'VALIDATION_FAILED',
          fields: [
            { field: 'street', issue: 'required' },
            { field: 'country', issue: 'countryUnavailable' },
          ],
        }}
      />,
    );
    const text = visibleText(html);
    expect(text).toContain(t('account.addresses.field.street.required'));
    expect(text).toContain(t('account.addresses.field.country.unavailable'));
    expect(text).toContain(t('account.addresses.error.VALIDATION_FAILED'));
    const tag = (name: string): string => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
    expect(tag('street')).toContain('aria-invalid="true"');
    expect(tag('street')).toContain('aria-describedby="addr-street-error"');
    expect(html).toContain('id="addr-street-error"');
    expect(tag('city')).not.toBe('');
    expect(tag('city')).not.toContain('aria-invalid');
    if (locale === 'en-US') {
      expect(text).toContain('Enter the street and number.');
    } else {
      expect(text).toContain('Wpisz ulicę i numer.');
    }
  });
});

describe('one form serves both address pages (#792)', () => {
  it('both pages render the shared AddressForm', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const app = resolve(import.meta.dirname, '../../app/(account)');
    const book = readFileSync(resolve(import.meta.dirname, '../../components/account/AddressBook.tsx'), 'utf8');
    expect(book).toContain('<AddressForm');
    for (const page of ['addresses/page.tsx', 'organization/addresses/page.tsx']) {
      const source = readFileSync(resolve(app, page), 'utf8');
      expect(source).toContain('<AddressBook');
      expect(source).not.toContain('<form');
    }
  });
});
