import { dirname } from 'node:path';
import { BundleLoadError } from './bundle-loader.js';
import type { I18nService } from './i18n-service.js';

/** Aggregate outcome of a reconcile/reload pass over every module's bundles. */
export interface I18nReconcileResult {
  installed: number;
  skipped: number;
  failed: number;
}

/**
 * Idempotent reconciler — for every module whose manifest declares an
 * `i18n.bundlesDir`, refresh its `translation_bundles` rows from the
 * JSON files on disk. Errors from the loader (malformed JSON, missing
 * EN bundle, etc.) are logged but do NOT abort the boot — a single
 * bad bundle should not take down the platform; the gap surfaces via
 * FR-014's diagnostic surface and the platform keeps serving.
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
      if (err instanceof BundleLoadError) {
        log.warn(
          `[i18n] reconcile: module "${moduleId}" bundle load failed (${err.reason}): ${err.message}`,
        );
      } else {
        log.warn(`[i18n] reconcile: module "${moduleId}" failed: ${(err as Error).message}`);
      }
    }
  }
  log.info(
    `[i18n] reconcile complete — installed=${installed} skipped=${skipped} failed=${failed}`,
  );
  return { installed, skipped, failed };
}
