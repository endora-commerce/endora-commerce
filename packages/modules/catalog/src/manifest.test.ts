import { describe, expect, it } from 'vitest';
import { manifest } from './manifest.js';
import en from '../i18n/en.json' with { type: 'json' };

// Issue #1458 (UX audit CAT-13): the Settings screen reads the bundle, the API serves the
// manifest — both say the same English sentence.
describe('catalog manifest — the completeness-gate setting', () => {
  const declared = (manifest.settings?.settings ?? []).find((s) => s.code === 'catalog.scope_completeness_gate');

  it('declares the English description the bundle shows, at most 150 characters', () => {
    const shown = (en as Record<string, string>)['settingLabels.catalog.scope_completeness_gate.description'];
    expect(declared?.description).toBe(shown);
    expect(shown!.length).toBeLessThanOrEqual(150);
  });
});
