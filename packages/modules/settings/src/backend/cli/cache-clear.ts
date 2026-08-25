/**
 * `settings cache-clear` — flush selected (or all) Redis cache namespaces.
 *
 *   pnpm --filter backend run cache:clear -- all
 *   pnpm --filter backend run cache:clear -- blog cms
 *   pnpm --filter backend run cache:clear -- --list
 *
 * Mirrors the Admin UI "Clear cache" page, so the same flush is available from a
 * shell or a deploy hook.
 *
 * ## What composing bought here
 *
 * It was `scripts/cache-clear.ts`, and it opened **its own** `ioredis`
 * connection from `REDIS_URL` and built its own `CacheAdminService` over it. The
 * composed `settingsCacheAdminService` is built over the composition's Redis
 * client, so this command now flushes through the same object the admin screen
 * does, on the connection the platform configured — and a deployment decoration
 * over that registration reaches it.
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { CACHE_NAMESPACES, type CacheAdminService } from '../services/cache-admin.service.js';

/** The one registration this command reads — this module's own. */
interface CacheClearCradle {
  readonly settingsCacheAdminService: CacheAdminService;
}

function usage(out: (line: string) => void): void {
  out('Usage: settings cache-clear <all | namespace…>');
  out('');
  out('Available namespaces:');
  for (const namespace of CACHE_NAMESPACES) {
    out(`  ${namespace.key.padEnd(16)} ${namespace.description}`);
  }
}

export async function cacheClear({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    usage(out);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv.includes('--list')) {
    usage(out);
    return 0;
  }

  const known = new Set(CACHE_NAMESPACES.map((n) => n.key));
  const wantAll = argv.includes('all');
  if (!wantAll) {
    const unknown = argv.filter((a) => !known.has(a));
    if (unknown.length > 0) {
      err(`Unknown namespace(s): ${unknown.join(', ')}`);
      usage(out);
      return 1;
    }
  }

  const service = ctx.cradle<CacheClearCradle>().settingsCacheAdminService;
  const result = await service.clear(wantAll ? 'all' : [...argv]);
  for (const cleared of result.cleared) {
    out(`  ${cleared.key.padEnd(16)} ${cleared.deletedKeysCount} key(s) deleted`);
  }
  out(`Done. ${result.totalDeletedKeys} key(s) deleted in total.`);
  return 0;
}
