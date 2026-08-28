import { describe, expect, it } from 'vitest';
import { resolveLabel } from '../../../../packages/modules/catalog/src/backend/services/label-resolver.js';

/**
 * T011 — per-locale label resolver unit tests.
 *
 * `resolveLabel(label, labelDefault, locale)` returns:
 *   1. exact-match value from `label[locale]` when present and non-empty
 *   2. `labelDefault` otherwise
 *
 * The resolver handles BCP-47 normalisation (e.g. `pl-PL` matches a
 * map keyed `pl_PL`) and is null-safe — empty `label`, missing locale,
 * and undefined `labelDefault` all degrade gracefully.
 */
describe('resolveLabel (catalog/label-resolver)', () => {
  it('returns the exact-locale value when present', () => {
    expect(resolveLabel({ 'en-US': 'Gear ratio', 'pl-PL': 'Przełożenie' }, 'Gear ratio', 'pl-PL'))
      .toBe('Przełożenie');
  });

  it('falls back to labelDefault when the active locale is missing', () => {
    expect(resolveLabel({ 'en-US': 'Gear ratio' }, 'Gear ratio', 'de-DE'))
      .toBe('Gear ratio');
  });

  it('falls back to labelDefault when the label map is empty', () => {
    expect(resolveLabel({}, 'Material', 'pl-PL')).toBe('Material');
  });

  it('falls back to labelDefault when the locale value is empty string', () => {
    expect(resolveLabel({ 'pl-PL': '' }, 'Color', 'pl-PL')).toBe('Color');
  });

  it('normalises pl_PL ↔ pl-PL', () => {
    expect(resolveLabel({ pl_PL: 'Kolor' }, 'Color', 'pl-PL')).toBe('Kolor');
    expect(resolveLabel({ 'pl-PL': 'Kolor' }, 'Color', 'pl_PL')).toBe('Kolor');
  });

  it('matches case-insensitively on the BCP-47 region tag', () => {
    expect(resolveLabel({ 'en-us': 'Color' }, 'Default', 'en-US')).toBe('Color');
  });

  it('returns the empty string when both label and labelDefault are missing', () => {
    expect(resolveLabel({}, '', 'en-US')).toBe('');
  });
});
