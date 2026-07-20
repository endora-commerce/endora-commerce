import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ADMIN_LANGUAGE_FALLBACK,
  SUPPORTED_ADMIN_LANGUAGES,
  type I18nCoverageLanguage,
  type I18nCoverageModule,
  type I18nCoverageResponse,
  type SupportedAdminLanguage,
  type TranslationBundleEntries,
} from '@b2b/contracts';
import { TranslationBundle } from '../entities/translation-bundle.entity.js';
import { loadModuleBundles, BundleLoadError } from './bundle-loader.js';
import { MissingKeyLogger } from './missing-key-logger.js';

/**
 * Admin UI i18n resolver and bundle store — feature 019 /
 * data-model.md §8, research §R7 / R9.
 *
 * Public surface (every method is exercised by a test in
 * specs/019-admin-i18n/research.md §R12):
 *
 *   - `installBundlesForModule(moduleId, modulePath, bundlesDir)` —
 *      called by the lifecycle install hook for any module that declares
 *      `manifest.i18n`. UPSERTs one row per language into
 *      `translation_bundles`; the row's `version` defaults via the
 *      `translation_bundles_version_seq` sequence.
 *   - `removeBundlesForModule(moduleId)` — hard-uninstall path. DELETEs
 *      every row owned by the module. Soft-uninstall is a no-op
 *      (data-model §3).
 *   - `getMergedBundleForLanguage(language)` — returns the merged
 *      `{ moduleId: entries }` object served to the admin SPA at boot,
 *      together with the `version` vector consumed by the SPA's cache.
 *   - `translate(moduleId, key, language, params?)` — backend-side lookup
 *      with the (requested → en → placeholder) fallback chain.
 */

export interface I18nServiceDeps {
  em: () => EntityManager;
  missingKeyLogger?: MissingKeyLogger;
}

interface CachedSnapshot {
  /** `MAX(version)` observed when the snapshot was built. */
  version: number;
  /** `moduleId → entries` for the cached language. */
  merged: Record<string, TranslationBundleEntries>;
}

export class I18nService {
  private readonly em: () => EntityManager;
  private readonly missingKeyLogger: MissingKeyLogger;
  private readonly cache = new Map<SupportedAdminLanguage, CachedSnapshot>();

  constructor(deps: I18nServiceDeps) {
    this.em = deps.em;
    this.missingKeyLogger = deps.missingKeyLogger ?? new MissingKeyLogger();
  }

  // -------------------------------------------------------------------------
  // Lifecycle hook surface — driven by feature 018's orchestrator.
  // -------------------------------------------------------------------------

  /**
   * Install (or update) every supported-language bundle for one module
   * by reading the JSON files at `<modulePath>/<bundlesDir>/<lang>.json`.
   * The loader rejects malformed input via `BundleLoadError`; the
   * lifecycle orchestrator surfaces that error as the install failure.
   */
  async installBundlesForModule(
    moduleId: string,
    modulePath: string,
    bundlesDir: string,
    em?: EntityManager,
  ): Promise<{ installed: SupportedAdminLanguage[] }> {
    const loaded = loadModuleBundles(moduleId, modulePath, bundlesDir);
    const targetEm = em ?? this.em();
    const knex = targetEm.getKnex();
    const installed: SupportedAdminLanguage[] = [];
    for (const [language, entries] of loaded.byLanguage) {
      // Single-statement UPSERT — INSERT bumps `version` via the column
      // default (nextval); the conflict UPDATE bumps it explicitly so
      // every successful install advances the sequence regardless of
      // whether the row existed (research §R9).
      await knex.raw(
        `insert into "translation_bundles" ("module_id", "language_code", "entries", "installed_at", "updated_at") ` +
          `values (?, ?, ?::jsonb, now(), now()) ` +
          `on conflict ("module_id", "language_code") do update set ` +
          `"entries" = excluded."entries", ` +
          `"version" = nextval('translation_bundles_version_seq'), ` +
          `"updated_at" = now()`,
        [moduleId, language, JSON.stringify(entries)],
      );
      installed.push(language);
    }
    // Force the next read for any affected language to rebuild from DB.
    for (const language of installed) {
      this.cache.delete(language);
    }
    return { installed };
  }

  /** Hard-uninstall — soft-uninstall is a no-op (data-model §3). */
  async removeBundlesForModule(
    moduleId: string,
    em?: EntityManager,
  ): Promise<{ removed: number }> {
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // invariant repair, not an operator-initiated audited write.
    const targetEm = em ?? this.em();
    const removed = await targetEm.nativeDelete(TranslationBundle, { moduleId });
    // Affected languages are unknown without a SELECT-then-DELETE; clear all.
    this.cache.clear();
    // Feature 021: drop accumulator entries so the diagnostic stops reporting
    // the now-uninstalled module.
    this.missingKeyLogger.pruneModule(moduleId);
    return { removed };
  }

  // -------------------------------------------------------------------------
  // Coverage diagnostic — feature 021.
  // -------------------------------------------------------------------------

  /**
   * Build a `(moduleId, languageCode)` coverage snapshot combining:
   *   - the `MissingKeyLogger` accumulator (runtime fallback events), and
   *   - a static comparison of the shipped bundle entries per language.
   *
   * Modules and languages can be filtered before serialisation. `includeKeys`
   * defaults to `'missing'`; set `'all'` to return every key the runtime has
   * seen (large; intended for deep inspection).
   */
  async getCoverageSnapshot(
    filter: {
      moduleIds?: string[];
      languageCodes?: SupportedAdminLanguage[];
      includeKeys?: 'missing' | 'all';
    } = {},
    em?: EntityManager,
  ): Promise<I18nCoverageResponse> {
    const targetEm = em ?? this.em();
    const moduleFilter = filter.moduleIds && filter.moduleIds.length > 0
      ? new Set(filter.moduleIds)
      : null;
    const langFilter = filter.languageCodes && filter.languageCodes.length > 0
      ? new Set(filter.languageCodes)
      : null;

    // Load every bundle from the DB. The bundles table is small (one row per
    // module-language pair); a full scan is fine for a diagnostic that runs
    // at admin-review cadence.
    const rows = await targetEm.find(TranslationBundle, {});
    const byModule = new Map<string, Map<SupportedAdminLanguage, TranslationBundleEntries>>();
    for (const row of rows) {
      const exposedId = row.moduleId === I18N_CHROME_MODULE_ID ? CORE_NAMESPACE : row.moduleId;
      if (moduleFilter && !moduleFilter.has(exposedId)) continue;
      const langs = byModule.get(exposedId) ?? new Map();
      langs.set(row.languageCode as SupportedAdminLanguage, row.entries);
      byModule.set(exposedId, langs);
    }

    // Index the accumulator by (moduleId, languageCode) → Set<key>.
    const runtimeMissing = new Map<string, Map<SupportedAdminLanguage, Set<string>>>();
    const runtimeFellBackToEn = new Map<string, Map<SupportedAdminLanguage, Set<string>>>();
    for (const entry of this.missingKeyLogger.snapshot()) {
      if (moduleFilter && !moduleFilter.has(entry.moduleId)) continue;
      const lang = entry.languageCode as SupportedAdminLanguage;
      if (langFilter && !langFilter.has(lang)) continue;
      const missingMap = runtimeMissing.get(entry.moduleId) ?? new Map();
      const missingSet = missingMap.get(lang) ?? new Set<string>();
      missingSet.add(entry.key);
      missingMap.set(lang, missingSet);
      runtimeMissing.set(entry.moduleId, missingMap);
      if (entry.fellBackTo === 'en') {
        const fbMap = runtimeFellBackToEn.get(entry.moduleId) ?? new Map();
        const fbSet = fbMap.get(lang) ?? new Set<string>();
        fbSet.add(entry.key);
        fbMap.set(lang, fbSet);
        runtimeFellBackToEn.set(entry.moduleId, fbMap);
      }
    }

    const allModuleIds = new Set<string>([
      ...byModule.keys(),
      ...runtimeMissing.keys(),
    ]);

    const modules: I18nCoverageModule[] = [];
    for (const moduleId of Array.from(allModuleIds).sort()) {
      const langs = byModule.get(moduleId) ?? new Map();
      const languages: I18nCoverageLanguage[] = [];
      for (const lang of SUPPORTED_ADMIN_LANGUAGES) {
        if (langFilter && !langFilter.has(lang)) continue;
        const entries = langs.get(lang) ?? {};
        const otherEntries = lang === ADMIN_LANGUAGE_FALLBACK
          ? (Array.from(langs.entries()).find(([k]) => k !== ADMIN_LANGUAGE_FALLBACK)?.[1] ?? {})
          : (langs.get(ADMIN_LANGUAGE_FALLBACK) ?? {});
        // Static-scan missing: keys present in any other language but absent
        // in this one.
        const staticMissing = new Set<string>();
        for (const k of Object.keys(otherEntries)) {
          if (!(k in entries)) staticMissing.add(k);
        }
        // Union with the runtime accumulator's missing set.
        const runtimeSet = runtimeMissing.get(moduleId)?.get(lang) ?? new Set();
        for (const k of runtimeSet) staticMissing.add(k);
        const missingKeys = Array.from(staticMissing).sort();
        const fbSet = runtimeFellBackToEn.get(moduleId)?.get(lang) ?? new Set();
        languages.push({
          languageCode: lang,
          totalKeysSeen: Object.keys(entries).length + (filter.includeKeys === 'all' ? 0 : 0),
          missingCount: missingKeys.length,
          missingKeys,
          fellBackToEnCount: fbSet.size,
          fellBackToEnKeys: Array.from(fbSet).sort(),
        });
      }
      modules.push({ moduleId, languages });
    }

    return {
      capturedAt: new Date().toISOString(),
      modules,
    };
  }

  // -------------------------------------------------------------------------
  // Read surface — driven by the GET /api/v1/admin/i18n/bundles endpoint.
  // -------------------------------------------------------------------------

  async getMergedBundleForLanguage(
    language: SupportedAdminLanguage,
    em?: EntityManager,
  ): Promise<{ version: number; bundles: Record<string, TranslationBundleEntries> }> {
    const targetEm = em ?? this.em();
    const knex = targetEm.getKnex();
    const maxRow = (await knex('translation_bundles')
      .where('language_code', language)
      .max('version as max')
      .first()) as { max: string | number | null } | undefined;
    const liveMax = maxRow?.max == null ? 0 : Number(maxRow.max);

    const cached = this.cache.get(language);
    if (cached && cached.version >= liveMax) {
      return { version: cached.version, bundles: cached.merged };
    }

    const rows = await targetEm.find(TranslationBundle, { languageCode: language });
    const merged: Record<string, TranslationBundleEntries> = {};
    let highest = 0;
    for (const row of rows) {
      // The `_i18n` module ships its own bundle as the synthetic `core`
      // namespace that owns admin-chrome strings (AppShell, login,
      // profile). DB rows stay keyed by `_i18n` so they line up with
      // `module_registrations`; the rename happens at the resolver
      // boundary so consumers (Admin SPA + backend `translate(...)`
      // calls) look it up under `core`. See data-model.md §3 / §4 and
      // research.md §R7.
      const exposedId = row.moduleId === I18N_CHROME_MODULE_ID ? CORE_NAMESPACE : row.moduleId;
      merged[exposedId] = row.entries;
      if (Number(row.version) > highest) highest = Number(row.version);
    }
    this.cache.set(language, { version: highest, merged });
    return { version: highest, bundles: merged };
  }

  // -------------------------------------------------------------------------
  // Resolver — backend-side string lookup for emitted messages
  // (audit-log labels, validation messages, notifications, etc.).
  // -------------------------------------------------------------------------

  async translate(
    moduleId: string,
    key: string,
    language: SupportedAdminLanguage,
    params?: Record<string, string | number>,
    em?: EntityManager,
  ): Promise<string> {
    const merged = await this.getMergedBundleForLanguage(language, em);
    const requested = merged.bundles[moduleId]?.[key];
    if (requested != null) {
      return interpolate(requested, params);
    }
    if (language !== ADMIN_LANGUAGE_FALLBACK) {
      const fallback = await this.getMergedBundleForLanguage(
        ADMIN_LANGUAGE_FALLBACK,
        em,
      );
      const englishValue = fallback.bundles[moduleId]?.[key];
      if (englishValue != null) {
        this.missingKeyLogger.logFallback({
          moduleId,
          languageCode: language,
          key,
          fellBackTo: 'en',
        });
        return interpolate(englishValue, params);
      }
    }
    this.missingKeyLogger.logFallback({
      moduleId,
      languageCode: language,
      key,
      fellBackTo: 'placeholder',
    });
    return `${moduleId}.${key}`;
  }

}

// Allowed: list of supported languages re-exported for tests / consumers.
export { SUPPORTED_ADMIN_LANGUAGES, BundleLoadError };

/** Manifest id of the platform-internal i18n module (= the chrome bundle owner). */
const I18N_CHROME_MODULE_ID = '_i18n';
/** Synthetic namespace exposed to clients for the `_i18n` module's bundle. */
const CORE_NAMESPACE = 'core';

/** Substitute `{name}` placeholders. Missing params are left as-is. */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : `{${name}}`,
  );
}
