import { describe, expect, it } from 'vitest';
import {
  BundleLoadError,
  loadModuleBundles,
} from '../../../src/modules/_i18n/services/bundle-loader.js';

/**
 * T039 / FR-008 / FR-016 — `loadModuleBundles` is the gatekeeper for
 * every bundle landing in `translation_bundles`. Tests verify the four
 * `BundleLoadError.reason` paths plus the happy path, all without
 * touching a real filesystem (the loader exposes injection seams for
 * `readFile` / `readDir` / `fileExists`).
 */
describe('loadModuleBundles', () => {
  it('returns an empty map when the bundles directory does not exist', () => {
    const out = loadModuleBundles('settings', '/fake/modules/settings', 'i18n', {
      fileExists: () => false,
      readDir: () => {
        throw new Error('readdir should not run when fileExists is false');
      },
      readFile: () => {
        throw new Error('readFile should not run');
      },
    });
    expect(out.byLanguage.size).toBe(0);
  });

  it('parses a well-formed en + pl pair', () => {
    const out = loadModuleBundles('settings', '/m/settings', 'i18n', {
      fileExists: () => true,
      readDir: () => ['en.json', 'pl.json'],
      readFile: (p) =>
        p.endsWith('en.json')
          ? '{"actions.save":"Save"}'
          : '{"actions.save":"Zapisz"}',
    });
    expect(out.byLanguage.get('en')).toEqual({ 'actions.save': 'Save' });
    expect(out.byLanguage.get('pl')).toEqual({ 'actions.save': 'Zapisz' });
  });

  it('accepts an EN-only bundle (Polish optional per FR-016)', () => {
    const out = loadModuleBundles('settings', '/m/settings', 'i18n', {
      fileExists: () => true,
      readDir: () => ['en.json'],
      readFile: () => '{"actions.save":"Save"}',
    });
    expect(out.byLanguage.size).toBe(1);
    expect(out.byLanguage.has('en')).toBe(true);
    expect(out.byLanguage.has('pl')).toBe(false);
  });

  it('rejects a directory that ships only pl.json (FR-016)', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['pl.json'],
        readFile: () => '{"actions.save":"Zapisz"}',
      }),
    ).toThrow(BundleLoadError);
    try {
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['pl.json'],
        readFile: () => '{"actions.save":"Zapisz"}',
      });
    } catch (err) {
      expect((err as BundleLoadError).reason).toBe('missing-fallback-bundle');
    }
  });

  it('rejects a file for an unsupported language code', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json', 'fr.json'],
        readFile: () => '{"a":"b"}',
      }),
    ).toThrow(BundleLoadError);
    try {
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json', 'fr.json'],
        readFile: () => '{"a":"b"}',
      });
    } catch (err) {
      expect((err as BundleLoadError).reason).toBe('unsupported-language-file');
    }
  });

  it('rejects malformed JSON', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{not valid json',
      }),
    ).toThrow(BundleLoadError);
    try {
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{not valid json',
      });
    } catch (err) {
      expect((err as BundleLoadError).reason).toBe('parse-failed');
    }
  });

  it('rejects bundles with non-string values (nested object)', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{"actions":{"save":"Save"}}',
      }),
    ).toThrow(BundleLoadError);
    try {
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{"actions":{"save":"Save"}}',
      });
    } catch (err) {
      expect((err as BundleLoadError).reason).toBe('invalid-shape');
    }
  });

  it('rejects bundles with array values', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{"actions.save":["Save"]}',
      }),
    ).toThrow(BundleLoadError);
  });

  it('rejects bundles with empty keys', () => {
    expect(() =>
      loadModuleBundles('settings', '/m/settings', 'i18n', {
        fileExists: () => true,
        readDir: () => ['en.json'],
        readFile: () => '{"":"empty key"}',
      }),
    ).toThrow(BundleLoadError);
  });

  it('reads from the configured bundlesDir, not a hard-coded default', () => {
    const calls: string[] = [];
    loadModuleBundles('settings', '/m/settings', 'translations', {
      fileExists: (p) => {
        calls.push(p);
        return true;
      },
      readDir: () => ['en.json'],
      readFile: () => '{"k":"v"}',
    });
    expect(calls[0]).toContain('/m/settings/translations');
  });
});
