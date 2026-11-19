import { describe, expect, it } from 'vitest';
import { manifest, SEARCH_SETTING_CODES } from '../manifest.js';
import en from '../../i18n/en.json' with { type: 'json' };
import pl from '../../i18n/pl.json' with { type: 'json' };

// Issue #1335 — the description of `search.llm.enabled` named the three
// `embedder.*` settings that feature 058 replaced with one credential reference.
describe('search manifest — the LLM toggle description', () => {
  const declared = (manifest.settings?.settings ?? []).find(
    (s) => s.code === SEARCH_SETTING_CODES.LLM_ENABLED,
  );
  const key = `settingLabels.${SEARCH_SETTING_CODES.LLM_ENABLED}.description`;
  const descriptions = [
    ['manifest', declared?.description],
    ['en bundle', (en as Record<string, string>)[key]],
    ['pl bundle', (pl as Record<string, string>)[key]],
  ] as const;

  it.each(descriptions)('the %s description exists', (_where, text) => {
    expect(text).toBeTruthy();
  });

  it.each(descriptions)('the %s description names no removed embedder.* setting', (_where, text) => {
    expect(text).not.toMatch(/embedder\.\*|three embedder|trzy/i);
  });

  // Issue #1458 (UX audit CAT-13): the API and the admin show one English text.
  it('declares the same English description the bundle shows, without implementation words', () => {
    expect(declared?.description).toBe((en as Record<string, string>)[key]);
    expect(declared?.description).not.toMatch(/Meilisearch|hybrid lexical/);
  });

  it('points at the embedder credentials setting, in both languages', () => {
    expect(declared?.description).toMatch(/embedder credentials/);
    expect((en as Record<string, string>)[key]).toMatch(/embedder credentials/);
    expect((pl as Record<string, string>)[key]).toMatch(/dane uwierzytelniające embeddera/);
  });

  it('labels the toggle and the credential setting in both languages', () => {
    for (const code of [SEARCH_SETTING_CODES.LLM_ENABLED, SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS]) {
      for (const bundle of [en, pl] as Record<string, string>[]) {
        expect(bundle[`settingLabels.${code}.name`]).toBeTruthy();
        expect(bundle[`settingLabels.${code}.description`]).toBeTruthy();
      }
    }
  });
});
