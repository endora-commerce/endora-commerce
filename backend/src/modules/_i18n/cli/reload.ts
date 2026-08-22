/**
 * `_i18n reload` — hot-reload translations (feature 080, T042b / D-160.9).
 *
 * Re-reads every module's on-disk i18n JSON bundles into the
 * `translation_bundles` table, bumping each row's version. A running backend
 * serves the new strings on its next read (the per-language cache rebuilds when
 * it sees a newer `MAX(version)`), so no restart is needed — admins just refresh
 * the page, or the Admin UI "Reload translations" button does it for them.
 *
 * Note: the storefront ships its UI strings compiled in-tree
 * (`storefront/lib/i18n/messages.ts`); those are not DB-backed and require a
 * storefront rebuild/redeploy. This command covers the admin bundles.
 *
 * ## What composing bought here
 *
 * This was `scripts/reload.ts`, and it imported `resolvedManifestEntries` from
 * `_lifecycle` to get the module list — the single entry in this module's
 * `check:module-boundary` shard, escalated rather than cut because *"a
 * module-owned CLI entry point has no container and no `ModuleContext` … and
 * what it needs is the deployment's module registry, which is a
 * composition-root input by nature"*. Both halves of that sentence are answered
 * by the host running the command: `resolvedModuleRegistry` is a
 * `PLATFORM_OWNED_NAMES` entry any module may read off its cradle, and the
 * `I18nService` is this module's own registration rather than a second instance
 * built here.
 *
 * It is deliberately the **composition's** registry rather than a fresh
 * `resolvedManifestEntries()` call, which is what makes the command's answer
 * the same as the running platform's: core, this deployment's overlay modules
 * and every installed package (feature 080, T032).
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '../../../kernel/index.js';
import {
  reconcileBundles,
  type I18nReconcileEntry,
} from '../services/bundle-reconciler.js';
import type { I18nService } from '../services/i18n-service.js';

/** The one root-supplied name this command reads. */
interface I18nReloadCradle {
  readonly resolvedModuleRegistry: readonly I18nReconcileEntry[];
}

export async function reload({
  ctx,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const entries = ctx.cradle<I18nReloadCradle>().resolvedModuleRegistry;
  // This module's own port, resolved exactly as `backend.ts` resolves it.
  const i18nService = lazyPort<I18nService>(ctx, 'adminI18nService');

  const result = await reconcileBundles(entries, i18nService, {
    info: (msg) => out(msg),
    warn: (msg) => err(msg),
  });
  out(
    `[i18n reload] done — installed=${result.installed} skipped=${result.skipped} ` +
      `failed=${result.failed}`,
  );
  for (const failure of result.failures) {
    err(`[i18n reload] "${failure.moduleId}" (${failure.reason}) at ${failure.modulePath}`);
  }
  return result.failed > 0 ? 1 : 0;
}
