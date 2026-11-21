import { describe, expect, it } from 'vitest';
import { deliveryMethodName, localizedText, mergeNames, missingLanguages, nameDraft, primaryName, returnStatusName } from './labels.js';

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

describe('per-language names of reasons and statuses (owner decision 2026-11-21)', () => {
  it('drafts one field per shipped language from a stored map', () => {
    expect(nameDraft({ en: 'New', pl: 'Nowe', de: 'Neu' })).toEqual({ en: 'New', pl: 'Nowe' });
    expect(nameDraft({ pl: 'Nowe' })).toEqual({ en: '', pl: 'Nowe' });
    expect(nameDraft(undefined)).toEqual({ en: '', pl: '' });
  });

  it('merges a draft into the stored map: trims, drops a cleared language, keeps languages it does not edit', () => {
    expect(mergeNames({ en: 'New', de: 'Neu' }, { en: ' Fresh ', pl: 'Nowe ' })).toEqual({ en: 'Fresh', pl: 'Nowe', de: 'Neu' });
    expect(mergeNames({ en: 'New', pl: 'Nowe' }, { en: '', pl: 'Nowe' })).toEqual({ pl: 'Nowe' });
    expect(mergeNames(undefined, { en: '  ', pl: 'Uszkodzony' })).toEqual({ pl: 'Uszkodzony' });
  });

  it('takes the English name as the primary one, else the Polish one', () => {
    expect(primaryName({ en: ' Damaged ', pl: 'Uszkodzony' })).toBe('Damaged');
    expect(primaryName({ en: ' ', pl: ' Uszkodzony ' })).toBe('Uszkodzony');
    expect(primaryName({ en: '', pl: '' })).toBe('');
  });

  it('lists the shipped languages a stored map has no name in', () => {
    expect(missingLanguages({ en: 'New' })).toEqual(['pl']);
    expect(missingLanguages({ en: 'New', pl: ' ' })).toEqual(['pl']);
    expect(missingLanguages({ en: 'New', pl: 'Nowe' })).toEqual([]);
    expect(missingLanguages(undefined)).toEqual(['en', 'pl']);
  });
});
