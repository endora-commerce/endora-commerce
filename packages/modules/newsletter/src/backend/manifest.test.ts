import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

/**
 * The operator's switches for campaign engagement tracking.
 *
 * Under `backend/` rather than beside `manifest.ts`: only the manifest is
 * published at the package's root subpath, and `manifests:generate` refuses a
 * sibling file there.
 */
const SWITCHES = [
  NEWSLETTER_SETTING_CODES.TRACKING_OPENS_ENABLED,
  NEWSLETTER_SETTING_CODES.TRACKING_CLICKS_ENABLED,
];

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;
}

describe('newsletter manifest — engagement tracking switches', () => {
  it.each(SWITCHES)('declares %s as a visible boolean in the newsletter group, off by default', (code) => {
    const setting = manifest.settings?.settings.find((s) => s.code === code);
    expect(setting).toBeDefined();
    expect(setting?.groupCode).toBe('newsletter');
    expect(setting?.valueType).toBe('boolean');
    // Off until an operator switches it on: nothing is tracked on an untouched instance.
    expect(setting?.defaultValue).toBe(false);
    expect(setting?.hidden).not.toBe(true);
    expect(setting?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(['en', 'pl'] as const)('names and describes both switches in the %s bundle', (language) => {
    const strings = bundle(language);
    for (const code of SWITCHES) {
      expect(strings[`settingLabels.${code}.name`]?.length ?? 0).toBeGreaterThan(0);
      expect(strings[`settingLabels.${code}.description`]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps the activation control as it was', () => {
    expect(manifest.activation).toEqual({ settingCode: 'newsletter.enabled', default: true });
  });
});

/**
 * `specs/169-page-builder-contact-form/` US7, data-model §4 (T184) — the
 * prose `newsletter.Signup` gained with its subscriber attributes is
 * translatable with the rest of the block: an attribute's label and
 * placeholder, and the message for a required attribute left empty. The key,
 * the type and the snapshotted field label are data, not prose.
 */
describe('newsletter.Signup translatable paths (T184)', () => {
  const block = manifest.blocks?.find((entry) => entry.name === 'newsletter.Signup');
  const paths = (block?.translatable ?? []).map((entry) => entry.path);

  it('declares the attributes’ label and placeholder and the fields message', () => {
    expect(paths).toEqual(expect.arrayContaining(['attributes[].label', 'attributes[].placeholder', 'messages.fields']));
  });

  it('keeps every path it declared before', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'heading',
        'text',
        'emailLabel',
        'placeholder',
        'buttonLabel',
        'topicsLegend',
        'topics[].label',
        'consentLabel',
        'messages.pending',
        'messages.active',
        'messages.consent',
        'messages.email',
        'messages.topics',
        'messages.unavailable',
      ]),
    );
  });

  it('declares no data path as prose', () => {
    for (const path of ['attributes[].key', 'attributes[].type', 'attributes[].fieldLabel', 'topics[].tagCode']) {
      expect(paths).not.toContain(path);
    }
  });
});
