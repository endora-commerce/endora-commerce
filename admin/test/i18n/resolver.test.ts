import { describe, expect, it } from 'vitest';
import { resolve } from '../../../packages/admin-shell/src/i18n/resolver';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';

/**
 * T021 / T051 / FR-013 — admin-side resolver fallback chain.
 *
 * Three steps: requested-language entry → English entry → `${scope}.${key}`
 * placeholder. Plus interpolation when params are supplied. Pure
 * function; no React, no jsdom needed.
 */
describe('admin resolver', () => {
  const plBundle: Bundle = {
    settings: { 'actions.save': 'Zapisz' },
  };
  const enBundle: Bundle = {
    settings: { 'actions.save': 'Save', 'actions.cancel': 'Cancel' },
  };

  it('returns the requested-language value when present', () => {
    const out = resolve({
      scope: 'settings',
      key: 'actions.save',
      language: 'pl',
      bundle: plBundle,
      fallbackBundle: enBundle,
    });
    expect(out).toEqual({ value: 'Zapisz', outcome: 'requested' });
  });

  it('falls back to English when the requested-language entry is missing', () => {
    const out = resolve({
      scope: 'settings',
      key: 'actions.cancel',
      language: 'pl',
      bundle: plBundle,
      fallbackBundle: enBundle,
    });
    expect(out).toEqual({ value: 'Cancel', outcome: 'en' });
  });

  it('returns the placeholder when both languages are missing', () => {
    const out = resolve({
      scope: 'settings',
      key: 'actions.unknown',
      language: 'pl',
      bundle: plBundle,
      fallbackBundle: enBundle,
    });
    expect(out).toEqual({
      value: 'settings.actions.unknown',
      outcome: 'placeholder',
    });
  });

  it('returns the placeholder when the scope itself is absent', () => {
    const out = resolve({
      scope: 'foreign_module',
      key: 'whatever',
      language: 'en',
      bundle: enBundle,
    });
    expect(out).toEqual({
      value: 'foreign_module.whatever',
      outcome: 'placeholder',
    });
  });

  it('does not consult the fallback bundle when the requested language IS English', () => {
    const out = resolve({
      scope: 'settings',
      key: 'actions.unknown',
      language: 'en',
      bundle: enBundle,
      fallbackBundle: enBundle,
    });
    expect(out.outcome).toBe('placeholder');
  });

  it('interpolates {name} placeholders from the params map', () => {
    const out = resolve({
      scope: 'orders',
      key: 'toast.created',
      language: 'pl',
      bundle: { orders: { 'toast.created': 'Zamówienie {id} utworzone' } },
      params: { id: '12345' },
    });
    expect(out.value).toBe('Zamówienie 12345 utworzone');
  });

  it('leaves unfilled placeholders visible (no silent elision)', () => {
    const out = resolve({
      scope: 'orders',
      key: 'toast.created',
      language: 'pl',
      bundle: { orders: { 'toast.created': 'Zamówienie {id} utworzone' } },
      params: {},
    });
    expect(out.value).toBe('Zamówienie {id} utworzone');
  });

  it('does not attempt fallback when no fallback bundle is supplied (degraded path)', () => {
    const out = resolve({
      scope: 'settings',
      key: 'actions.cancel',
      language: 'pl',
      bundle: plBundle,
      // no fallbackBundle
    });
    expect(out).toEqual({
      value: 'settings.actions.cancel',
      outcome: 'placeholder',
    });
  });
});
