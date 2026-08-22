import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGUAGE_FALLBACK,
  SUPPORTED_LANGUAGES,
  SupportedAdminLanguageSchema,
  TranslationBundleEntriesSchema,
  type SupportedAdminLanguage,
  type TranslationBundleEntries,
} from '@endora-commerce/contracts';

/**
 * Filesystem reader for module-shipped translation bundles —
 * feature 019 / data-model.md §6, contracts/translation-bundle-schema.md.
 *
 * Reads `<modulePath>/<bundlesDir>/<lang>.json` for every supported
 * Admin UI language, validates each file with
 * `TranslationBundleEntriesSchema`, and returns the bundles keyed by
 * language code. Throws a `BundleLoadError` for any rule violation:
 *
 *   - filename does not match a supported language code,
 *   - JSON does not parse,
 *   - the parsed value does not satisfy the entries schema (e.g.
 *     nested object, array, null, non-string value, empty key),
 *   - the directory exists but no English bundle is present
 *     (FR-016: English is the platform-wide fallback).
 *
 * Modules that do NOT ship a bundles directory are exempt and the
 * loader returns an empty map for them.
 */

export class BundleLoadError extends Error {
  constructor(
    public readonly moduleId: string,
    public readonly reason:
      | 'unsupported-language-file'
      | 'parse-failed'
      | 'invalid-shape'
      | 'missing-fallback-bundle',
    message: string,
    public readonly path?: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'BundleLoadError';
  }
}

export interface LoadedBundles {
  /**
   * Per-language entries map. Only languages that have a bundle file on
   * disk are present; missing languages are simply absent from the map.
   */
  byLanguage: Map<SupportedAdminLanguage, TranslationBundleEntries>;
}

export interface BundleLoaderOptions {
  /** For tests: override the JSON-file reader (e.g. to point at fixtures). */
  readFile?: (path: string) => string;
  /** For tests: override directory listing. */
  readDir?: (path: string) => string[];
  /** For tests: override existence check. */
  fileExists?: (path: string) => boolean;
}

const DEFAULT_OPTS: Required<BundleLoaderOptions> = {
  readFile: (p) => readFileSync(p, 'utf8'),
  readDir: (p) => readdirSync(p),
  fileExists: (p) => existsSync(p),
};

/**
 * Load every supported-language bundle for one module. Returns an empty
 * map when the bundles directory does not exist (the module ships no
 * translatable strings).
 */
export function loadModuleBundles(
  moduleId: string,
  modulePath: string,
  bundlesDir: string,
  opts: BundleLoaderOptions = {},
): LoadedBundles {
  const o = { ...DEFAULT_OPTS, ...opts };
  const dirPath = join(modulePath, bundlesDir);
  if (!o.fileExists(dirPath)) {
    return { byLanguage: new Map() };
  }

  const supported = new Set<string>(SUPPORTED_LANGUAGES);
  const files = o.readDir(dirPath).filter((f) => f.endsWith('.json'));
  const byLanguage = new Map<SupportedAdminLanguage, TranslationBundleEntries>();

  for (const file of files) {
    const lang = file.replace(/\.json$/, '');
    if (!supported.has(lang)) {
      throw new BundleLoadError(
        moduleId,
        'unsupported-language-file',
        `[i18n] module "${moduleId}" ships unsupported language bundle "${file}"; supported: ${[
          ...supported,
        ].join(', ')}`,
        join(dirPath, file),
      );
    }
    const parsed = SupportedAdminLanguageSchema.parse(lang);
    const filePath = join(dirPath, file);
    let content: unknown;
    try {
      content = JSON.parse(o.readFile(filePath));
    } catch (err) {
      throw new BundleLoadError(
        moduleId,
        'parse-failed',
        `[i18n] module "${moduleId}" bundle "${file}" is not valid JSON: ${(err as Error).message}`,
        filePath,
      );
    }
    const validated = TranslationBundleEntriesSchema.safeParse(content);
    if (!validated.success) {
      throw new BundleLoadError(
        moduleId,
        'invalid-shape',
        `[i18n] module "${moduleId}" bundle "${file}" failed validation`,
        filePath,
        validated.error.issues,
      );
    }
    byLanguage.set(parsed, validated.data);
  }

  // FR-016 — when the module ships any bundle at all, English MUST be present.
  if (byLanguage.size > 0 && !byLanguage.has(LANGUAGE_FALLBACK)) {
    throw new BundleLoadError(
      moduleId,
      'missing-fallback-bundle',
      `[i18n] module "${moduleId}" ships translation bundles but is missing the "${LANGUAGE_FALLBACK}.json" fallback (FR-016).`,
      dirPath,
    );
  }

  return { byLanguage };
}
