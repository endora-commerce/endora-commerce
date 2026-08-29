import type { EntityManager } from '@mikro-orm/postgresql';
import {
  LANGUAGE_FALLBACK,
  SUPPORTED_LANGUAGES,
  type I18nCoverageLanguage,
  type I18nCoverageModule,
  type I18nCoverageResponse,
  type SupportedAdminLanguage,
  type TranslationBundleEntries,
} from '@endora-commerce/contracts';
import { TranslationBundle } from '../entities/translation-bundle.entity.js';
import { loadModuleBundles } from './bundle-loader.js';
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
    const installed: SupportedAdminLanguage[] = [];
    for (const [language, entries] of loaded.byLanguage) {
      // Single-statement UPSERT — INSERT bumps `version` via the column
      // default (nextval); the conflict UPDATE bumps it explicitly so
      // every successful install advances the sequence regardless of
      // whether the row existed (research §R9).
      //
      // Through `targetEm.execute`, not `targetEm.getKnex().raw`: the knex
      // instance is connection-level and carries no transaction context, so a
      // caller that passes a transactional `em` — as the signature invites, and
      // as the install path's revert semantics assume — got rows that outlived
      // its rollback (issue #200).
      await targetEm.execute(
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
      const exposedId = exposedBundleNamespace(row.moduleId);
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
      for (const lang of SUPPORTED_LANGUAGES) {
        if (langFilter && !langFilter.has(lang)) continue;
        const entries = langs.get(lang) ?? {};
        const otherEntries = lang === LANGUAGE_FALLBACK
          ? (Array.from(langs.entries()).find(([k]) => k !== LANGUAGE_FALLBACK)?.[1] ?? {})
          : (langs.get(LANGUAGE_FALLBACK) ?? {});
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
    // `targetEm.execute`, not `targetEm.getKnex()`: the rows below are read
    // through `targetEm`, so a caller holding a transaction open would have had
    // the freshness probe answer from outside it and the row read from inside —
    // one method, two views of the same table (issue #200).
    const maxRows = (await targetEm.execute(
      `select max("version") as max from "translation_bundles" where "language_code" = ?`,
      [language],
    )) as Array<{ max: string | number | null }>;
    const liveMax = maxRows[0]?.max == null ? 0 : Number(maxRows[0].max);

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
      const exposedId = exposedBundleNamespace(row.moduleId);
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
    // The alias, applied on the **read** side — feature 090, Phase 3
    // (`specs/090-module-owned-error-codes/core-block-home.md` §4(c)).
    //
    // This module's bundle is exposed to clients under the synthetic namespace
    // `core`, for the reason `getMergedBundleForLanguage` gives above: the
    // admin SPA has called it that since feature 019 and does so in 132 places.
    // Every caller therefore asked for `core` — until this module declared the
    // platform's 100 error codes in its own manifest, which made the composed
    // routing map answer `_i18n` and `translate('_i18n', 'errors.INTERNAL', …)`
    // return the placeholder. Both composition roots turn a placeholder back
    // into the raiser's untranslated English, silently, so the symptom would
    // have been 41 codes losing their sentences in both shipped languages with
    // no log and no failing check. `backend/test/integration/_i18n/
    // platform-error-sentences.test.ts` is the assertion that refuses it.
    //
    // The alternative was to publish the bundle under both keys in the merged
    // map, and it was refused: that map is the payload
    // `GET /api/v1/admin/i18n/bundles` serves, so it would change the wire
    // shape and duplicate the largest bundle on every admin boot.
    //
    // **A module with no legacy namespace needs nothing equivalent.** This is
    // one fact about one repository's history, not a pattern to copy: a
    // stranger's module is looked up under the id it registers. The remaining
    // three copies of the identity live in
    // `backend/scripts/check-error-translations.ts`, which still reads the
    // prefix chain and so still sees the string `core`; they go with the chain,
    // in the merge request that deletes it.
    const bundleId = exposedBundleNamespace(moduleId);
    const merged = await this.getMergedBundleForLanguage(language, em);
    const requested = merged.bundles[bundleId]?.[key];
    if (requested != null) {
      return interpolate(requested, params);
    }
    if (language !== LANGUAGE_FALLBACK) {
      const fallback = await this.getMergedBundleForLanguage(
        LANGUAGE_FALLBACK,
        em,
      );
      const englishValue = fallback.bundles[bundleId]?.[key];
      if (englishValue != null) {
        // The **exposed** id, not the caller's: `getCoverageSnapshot` keys its
        // bundle side by the exposed id too, so logging `_i18n` here would
        // report a second module with no bundle and 0% coverage beside `core`.
        this.missingKeyLogger.logFallback({
          moduleId: bundleId,
          languageCode: language,
          key,
          fellBackTo: 'en',
        });
        return interpolate(englishValue, params);
      }
    }
    this.missingKeyLogger.logFallback({
      moduleId: bundleId,
      languageCode: language,
      key,
      fellBackTo: 'placeholder',
    });
    // The **caller's** id, and this one may not be normalised: both composition
    // roots recognise a miss by comparing the answer to `${moduleId}.${key}`
    // with the id they passed in, and answer the raiser's own message when it
    // matches. Returning `core.errors.INTERNAL` to a caller that asked about
    // `_i18n` would defeat that comparison and put the placeholder itself in
    // front of a client.
    return `${moduleId}.${key}`;
  }

}

// `SUPPORTED_LANGUAGES` and `BundleLoadError` were re-exported here "for tests /
// consumers", and the line went with T040b's packaging. Neither had a consumer:
// `SUPPORTED_LANGUAGES` is `@endora-commerce/contracts`', which every caller
// already imports from there, and `BundleLoadError` is published by this
// package's own `./backend` barrel beside `loadModuleBundles`. What made the
// line a defect rather than dead weight is that it is a bare `export { … }`
// over two *imported* bindings, so `readBackendSurface` — which follows the
// barrel's re-exports to decide whether a package publishes an entity class by
// name (D-168) — reached a specifier it cannot resolve and reported
// `unresolvable-reexport`. That verdict is right: a re-export it cannot read is
// the one case where a silent pass would mean "not looking".

/** Manifest id of the platform-internal i18n module (= the chrome bundle owner). */
const I18N_CHROME_MODULE_ID = '_i18n';
/** Synthetic namespace exposed to clients for the `_i18n` module's bundle. */
const CORE_NAMESPACE = 'core';

/**
 * `_i18n` -> `core`, written once.
 *
 * The identity was spelled as the same ternary in two places here and, with its
 * own separately declared constant, three more times in
 * `backend/scripts/check-error-translations.ts` — five copies of one fact
 * across two files. Feature 090's platform-block migration needed a **third**
 * application in this file (`translate`, below), which is what made writing it
 * once worth the three lines: the check's three go with the prefix chain they
 * read, and this is then the only statement of the alias in the tree.
 */
function exposedBundleNamespace(moduleId: string): string {
  return moduleId === I18N_CHROME_MODULE_ID ? CORE_NAMESPACE : moduleId;
}

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
