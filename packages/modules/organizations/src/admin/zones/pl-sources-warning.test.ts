import { describe, expect, it } from 'vitest';
import { PL_SOURCES_SETTING_CODE, credentialReferenceOf, showPlSourcesWarning } from './pl-sources-warning.js';

/**
 * Feature 173 (T047a; FR-026a) — when the Settings screen warns beside
 * `registry_lookup_pl_sources`: only for that setting, only while the draft is
 * `gus` and the stored GUS credential reference is empty.
 */

describe('showPlSourcesWarning', () => {
  it('warns for gus with an empty credential reference', () => {
    expect(showPlSourcesWarning({ settingCode: PL_SOURCES_SETTING_CODE, draftText: 'gus', credentialReference: '' })).toBe(true);
    expect(showPlSourcesWarning({ settingCode: PL_SOURCES_SETTING_CODE, draftText: ' gus ', credentialReference: '  ' })).toBe(
      true,
    );
  });

  it.each([
    ['gus_mf', ''],
    ['mf', ''],
    ['gus', 'organizations-gus'],
  ])('draft %s with reference %j ⇒ no warning', (draftText, credentialReference) => {
    expect(showPlSourcesWarning({ settingCode: PL_SOURCES_SETTING_CODE, draftText, credentialReference })).toBe(false);
  });

  it('never warns beside another setting', () => {
    expect(
      showPlSourcesWarning({ settingCode: 'organizations.moderation.mode', draftText: 'gus', credentialReference: '' }),
    ).toBe(false);
  });

  it('never warns while the reference is unreadable or not yet read', () => {
    expect(showPlSourcesWarning({ settingCode: PL_SOURCES_SETTING_CODE, draftText: 'gus', credentialReference: null })).toBe(
      false,
    );
  });
});

describe('credentialReferenceOf', () => {
  it('reads the stored value, falling back to the default', () => {
    expect(credentialReferenceOf({ globalValue: 'organizations-gus', defaultValue: '' })).toBe('organizations-gus');
    expect(credentialReferenceOf({ globalValue: null, defaultValue: '' })).toBe('');
    expect(credentialReferenceOf({ globalValue: null })).toBe('');
  });

  it('is unreadable (null) for anything that is not a settings answer', () => {
    expect(credentialReferenceOf(null)).toBeNull();
    expect(credentialReferenceOf({ globalValue: 42 })).toBeNull();
  });
});
