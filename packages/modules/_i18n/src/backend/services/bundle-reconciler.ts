import { dirname } from 'node:path';
import { BundleLoadError } from './bundle-loader.js';
import type { I18nService } from './i18n-service.js';

/** One module whose bundles could not be read, and where they were read from. */
export interface I18nReconcileFailure {
  moduleId: string;
  /** `dirname(entry.filePath)` — the directory `bundlesDir` was joined to. */
  modulePath: string;
  /** The `BundleLoadError` reason, or `'unknown'` for anything else. */
  reason: string;
  message: string;
}

/** Aggregate outcome of a reconcile/reload pass over every module's bundles. */
export interface I18nReconcileResult {
  installed: number;
  skipped: number;
  failed: number;
  /**
   * One entry per module counted in {@link failed}.
   *
   * The counts alone were the whole diagnostic surface, and they were enough
   * while every bundle in the platform came out of this repository: a core
   * module's malformed bundle cannot ship, because
   * `test/unit/_i18n/registered-bundles-shape.test.ts` walks the committed
   * registry and fails the build. An **installed package's** bundle passes
   * through no CI of ours, so this pass is the first and only thing that ever
   * reads it — and `failed=1` names nobody.
   */
  failures: I18nReconcileFailure[];
}

/**
 * Idempotent reconciler — for every module whose manifest declares an
 * `i18n.bundlesDir`, refresh its `translation_bundles` rows from the
 * JSON files on disk. Errors from the loader (malformed JSON, missing
 * EN bundle, etc.) are logged but do NOT abort the boot — a single
 * bad bundle should not take down the platform; the gap surfaces via
 * FR-014's diagnostic surface and the platform keeps serving.
 *
 * ## Why log-and-skip is still right when the bundle is a stranger's
 *
 * Feature 080 (T032) put an **installed package's** bundles on this path, and
 * that is a different question from the one this policy was written for: a
 * malformed bundle used to be a mistake this repository made and CI refused
 * before it shipped. A package's bundle is a mistake somebody else made, and
 * it arrives on a running shop.
 *
 * The answer does not change, and the reason it does not is that this pass has
 * **no caller to answer**. It runs at boot and on `i18n:reload`, where the only
 * alternative to skipping is refusing to serve — so one vendor's nested JSON
 * object would take a shop off the internet, over labels. That is the same
 * trade `installed-packages.ts` already makes for a `package.json` it cannot
 * parse ("one unreadable stranger must not stop a shop from booting"), and the
 * blast radius here is smaller: the module's routes, permissions and gating are
 * untouched, and its palette entries render raw keys.
 *
 * Where there **is** a caller, the answer is already the opposite one and stays
 * that way: `module:install` reconciles through
 * `orchestrator.ts`'s `i18nReconciler.install(...)`, outside this function,
 * where a `BundleLoadError` bubbles out and aborts the install transaction
 * (FR-016). An operator installing a package with an unreadable bundle is told
 * at the moment they can still choose not to install it.
 *
 * What T032 changed is the part that was genuinely wrong for a stranger:
 * the failure is now **attributable**. The warning names the directory the
 * bundle was read from — for a package that is `node_modules/@vendor/…`, which
 * is the only thing in the line that says whose mistake it is, since D-142
 * makes the module id the platform's identity and not the vendor's — and the
 * result carries {@link I18nReconcileFailure} entries rather than a count.
 */
/** One module's manifest + on-disk location, as the reconciler needs it. */
export interface I18nReconcileEntry {
  manifest: { id: string; i18n?: { bundlesDir: string } | undefined };
  filePath: string;
}

export async function reconcileBundles(
  entries: Iterable<I18nReconcileEntry>,
  i18nService: I18nService,
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<I18nReconcileResult> {
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  const failures: I18nReconcileFailure[] = [];
  for (const entry of entries) {
    const i18n = entry.manifest.i18n;
    if (!i18n) {
      skipped += 1;
      continue;
    }
    const moduleId = entry.manifest.id;
    const modulePath = dirname(entry.filePath);
    try {
      const result = await i18nService.installBundlesForModule(
        moduleId,
        modulePath,
        i18n.bundlesDir,
      );
      if (result.installed.length > 0) {
        installed += 1;
      }
    } catch (err) {
      failed += 1;
      const isLoadError = err instanceof BundleLoadError;
      const reason = isLoadError ? err.reason : 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ moduleId, modulePath, reason, message });
      // `modulePath` is in the line, not only in the structured failure: a
      // module id says which module, and for an installed package it is
      // precisely the thing that does NOT say whose module it is.
      log.warn(
        `[i18n] reconcile: module "${moduleId}" bundle load failed (${reason}) ` +
          `at ${modulePath}: ${message}`,
      );
    }
  }
  log.info(
    `[i18n] reconcile complete — installed=${installed} skipped=${skipped} failed=${failed}`,
  );
  return { installed, skipped, failed, failures };
}
