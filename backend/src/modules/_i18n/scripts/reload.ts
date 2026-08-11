import { initOrm, closeOrm } from '../../../db/index.js';
import { I18nService } from '../services/i18n-service.js';
import { reconcileBundles } from '../plugin.js';
import { REGISTERED_MANIFESTS } from '../../_lifecycle/registered-manifests.js';
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
    const result = await reconcileBundles(REGISTERED_MANIFESTS, i18nService, log);
    process.stdout.write(
      `[i18n:reload] done — installed=${result.installed} skipped=${result.skipped} failed=${result.failed}\n`,
    );
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await closeOrm();
  }
}

void enterSystemScope('cli: reload i18n bundles', main, { entryPoint: 'cli' }).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(2);
});
