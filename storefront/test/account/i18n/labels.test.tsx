import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { codeLabel, pluralKey, quoteRequestEventLabel, quoteRequestStatusLabel, richText } from '../../../lib/account/labels';
import { tForLocale } from '../../../lib/i18n/messages';

/** Issue #85 — the account area's catalogue helpers. */
describe('pluralKey', () => {
  it('picks the Polish form: 1 / 2–4 / 5+, with 12–14 taking the 5+ form', () => {
    const form = (n: number): string => pluralKey('account.shoppingList.cartAdded', n, 'pl-PL');
    expect(form(1)).toBe('account.shoppingList.cartAdded.one');
    expect(form(2)).toBe('account.shoppingList.cartAdded.few');
    expect(form(4)).toBe('account.shoppingList.cartAdded.few');
    expect(form(5)).toBe('account.shoppingList.cartAdded.many');
    expect(form(12)).toBe('account.shoppingList.cartAdded.many');
    expect(form(14)).toBe('account.shoppingList.cartAdded.many');
    expect(form(22)).toBe('account.shoppingList.cartAdded.few');
    expect(form(0)).toBe('account.shoppingList.cartAdded.many');
  });

  it('picks the English form: one, else other', () => {
    expect(pluralKey('account.shoppingList.cartAdded', 1, 'en-US')).toBe('account.shoppingList.cartAdded.one');
    expect(pluralKey('account.shoppingList.cartAdded', 3, 'en-US')).toBe('account.shoppingList.cartAdded.other');
  });
});

describe('codeLabel', () => {
  it('labels a known code in the page language', () => {
    expect(codeLabel(tForLocale('en-US'), 'account.paymentStatus', 'paid')).toBe('Paid');
    expect(codeLabel(tForLocale('pl-PL'), 'account.paymentStatus', 'paid')).toBe('Opłacona');
  });

  it('shows a code the catalogue does not know as itself, never as a key', () => {
    expect(codeLabel(tForLocale('pl-PL'), 'account.paymentStatus', 'chargeback')).toBe('chargeback');
  });
});

describe('quote-request labels', () => {
  it('labels the API statuses and events, and passes an unknown one through', () => {
    const pl = tForLocale('pl-PL');
    expect(quoteRequestStatusLabel(pl, 'Created from admin')).toBe('Od opiekuna');
    expect(quoteRequestStatusLabel(tForLocale('en-US'), 'Canceled')).toBe('Cancelled');
    expect(quoteRequestStatusLabel(pl, 'Archived')).toBe('Archived');
    expect(quoteRequestEventLabel(pl, 're-submitted')).toBe('Złożono ponownie');
    expect(quoteRequestEventLabel(pl, 'merged')).toBe('merged');
  });
});

describe('richText', () => {
  it('places markup where the sentence puts it, and inserts values verbatim', () => {
    const html = renderToString(<p>{richText('Order {number} has been received.', { number: <strong>{'{x} $&'}</strong> })}</p>);
    expect(html).toBe('<p>Order <strong>{x} $&amp;</strong> has been received.</p>');
  });

  it('leaves a placeholder with no value as written', () => {
    expect(renderToString(<p>{richText('Hello {name}', {})}</p>)).toBe('<p>Hello <!-- -->{name}</p>');
  });
});
