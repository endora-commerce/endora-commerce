import { describe, expect, it } from 'vitest';
import { deliveryMethodName, localizedText, returnStatusName } from './labels.js';

describe('returns admin labels (#1472, SALES-07)', () => {
  it('reads a text in the operator language, then English, then the first, then the fallback', () => {
    expect(localizedText({ en: 'Courier', pl: 'Kurier' }, 'pl', 'x')).toBe('Kurier');
    expect(localizedText({ en: 'Courier' }, 'pl', 'x')).toBe('Courier');
    expect(localizedText({ de: 'Kurier DE' }, 'pl', 'x')).toBe('Kurier DE');
    expect(localizedText({}, 'pl', 'courier')).toBe('courier');
    expect(localizedText(null, 'pl', 'courier')).toBe('courier');
  });

  it('names a status in the operator language, then by its default name, then by its code', () => {
    expect(returnStatusName({ code: 'received', name: { en: 'Received', pl: 'Odebrany' }, defaultName: 'Received' }, 'pl')).toBe('Odebrany');
    expect(returnStatusName({ code: 'inspecting', name: { en: 'Inspecting' }, defaultName: 'Inspecting' }, 'pl')).toBe('Inspecting');
    // The backend's order: never another language (`resolveReturnStatusName`).
    expect(returnStatusName({ code: 'inspecting', name: { en: 'In inspection' }, defaultName: '' }, 'pl')).toBe('inspecting');
    expect(returnStatusName({ code: 'inspecting', name: {}, defaultName: '' }, 'pl')).toBe('inspecting');
  });

  it('names a delivery method from the list, and answers null for an id the list does not hold', () => {
    const methods = [{ id: 'dm-1', code: 'courier', name: { en: 'Courier', pl: 'Kurier' } }];
    expect(deliveryMethodName('dm-1', methods, 'pl')).toBe('Kurier');
    expect(deliveryMethodName('dm-2', methods, 'pl')).toBeNull();
    expect(deliveryMethodName('dm-1', null, 'pl')).toBeNull();
  });
});
