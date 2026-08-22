import { initOrm, closeOrm } from '../../../db/index.js';
import { I18nService } from '../services/i18n-service.js';
import { reconcileBundles } from '../services/bundle-reconciler.js';
import { resolvedManifestEntries } from '../../_lifecycle/registered-manifests.js';
import { enterSystemScope } from '../../../kernel/scope.js';

/**
 * `pnpm --filter backend run i18n:reload` — hot-reload translations.
 *
 * Re-reads every module's on-disk i18n JSON bundles into the
 * `translation_bundles` table, bumping each row's version. A running
 * backend serves the new strings on its next read (the per-language cache
 * rebuilds when it sees a newer `MAX(version)`), so no restart is needed —
 * admins just refresh the page (or the Admin UI "Reload translations"
 * button does it for them).
 *
 * Note: the storefront ships its UI strings compiled in-tree
 * (`storefront/lib/i18n/messages.ts`); those are not DB-backed and require a
 * storefront rebuild/redeploy. This command covers the admin bundles.
 *
 * "Every module" is the **instance-resolved** set — core, this deployment's
 * overlay modules and every installed package (feature 080, T032). It read
 * bare-core `REGISTERED_MANIFESTS` until then, which is the shape D-155.3(c)
 * describes for the `module:*` CLIs: the running platform reconciles a
 * package's bundles at boot and this command, run against the same instance,
 * could not see them — so the operator's remedy for a stale translation
 * silently skipped exactly the modules whose translations arrived last.
 */
async function main(): Promise<void> {
  const orm = await initOrm();
  try {
    const i18nService = new I18nService({ em: () => orm.em.fork() });
    const log = {
      info: (msg: string): void => {
        process.stdout.write(`${msg}\n`);
      },
      warn: (msg: string): void => {
        process.stderr.write(`${msg}\n`);
      },
    };
    const entries = await resolvedManifestEntries();
    const result = await reconcileBundles(entries, i18nService, log);
    process.stdout.write(
      `[i18n:reload] done — installed=${result.installed} skipped=${result.skipped} failed=${result.failed}\n`,
    );
    for (const failure of result.failures) {
      process.stderr.write(
        `[i18n:reload] "${failure.moduleId}" (${failure.reason}) at ${failure.modulePath}\n`,
      );
    }
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await closeOrm();
  }
}

void enterSystemScope('cli: reload i18n bundles', main, { entryPoint: 'cli' }).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(2);
});
