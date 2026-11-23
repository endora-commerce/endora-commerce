import { describe, expect, it } from 'vitest';
import { orderStatusName } from './status-name.js';

/**
 * Issue #1809 — an order status's name is stored per language
 * (`order_statuses.name`, seeded `{ en: 'New', pl: 'Nowy' }`), and every admin
 * screen read the English entry whatever the admin's language was.
 */
describe('orderStatusName', () => {
  const seeded = { code: 'new', name: { en: 'New', pl: 'Nowy' }, defaultName: 'New' };

  it("answers the admin's language", () => {
    expect(orderStatusName(seeded, 'pl')).toBe('Nowy');
    expect(orderStatusName(seeded, 'en')).toBe('New');
  });

  it('reads a regional entry when only that was recorded', () => {
    expect(orderStatusName({ code: 'paid', name: { 'pl-PL': 'Zapłacone', en: 'Paid' } }, 'pl')).toBe('Zapłacone');
  });

  it('falls back to the default name, then English, then any entry, then the code', () => {
    expect(orderStatusName({ code: 'x', name: { de: 'Neu' }, defaultName: 'Fresh' }, 'pl')).toBe('Fresh');
    expect(orderStatusName({ code: 'x', name: { en: 'New', de: 'Neu' } }, 'pl')).toBe('New');
    expect(orderStatusName({ code: 'x', name: { de: 'Neu' } }, 'pl')).toBe('Neu');
    expect(orderStatusName({ code: 'x', name: {} }, 'pl')).toBe('x');
    expect(orderStatusName(undefined, 'pl', 'gone')).toBe('gone');
  });

  it('skips an empty entry rather than rendering a blank badge', () => {
    expect(orderStatusName({ code: 'new', name: { pl: '', en: 'New' } }, 'pl')).toBe('New');
  });
});
