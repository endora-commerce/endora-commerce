import Redis from 'ioredis';
import {
  CacheAdminService,
  CACHE_NAMESPACES,
} from '../services/cache-admin.service.js';
import { enterSystemScope } from '../../../kernel/scope.js';

/**
 * CLI: clear selected (or all) Redis cache namespaces.
 *
 *   pnpm --filter backend cache:clear all
 *   pnpm --filter backend cache:clear blog cms
 *   pnpm --filter backend cache:clear --list
 *
 * Mirrors the Admin UI "Clear cache" page so the same flush is available from
 * a shell / deploy hook. Reads REDIS_URL from the environment.
 */

function printUsage(): void {
  process.stdout.write(
    'Usage: cache:clear <all | namespace…>\n\n' +
      'Available namespaces:\n' +
      CACHE_NAMESPACES.map((n) => `  ${n.key.padEnd(16)} ${n.description}`).join('\n') +
      '\n',
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return args.length === 0 ? 1 : 0;
  }
  if (args.includes('--list')) {
    printUsage();
    return 0;
  }

  const known = new Set(CACHE_NAMESPACES.map((n) => n.key));
  const wantAll = args.includes('all');
  if (!wantAll) {
    const unknown = args.filter((a) => !known.has(a));
    if (unknown.length > 0) {
      process.stderr.write(`Unknown namespace(s): ${unknown.join(', ')}\n\n`);
      printUsage();
      return 1;
    }
  }

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  try {
    const svc = new CacheAdminService(redis);
    const result = await svc.clear(wantAll ? 'all' : args);
    for (const c of result.cleared) {
      process.stdout.write(`  ${c.key.padEnd(16)} ${c.deletedKeysCount} key(s) deleted\n`);
    }
    process.stdout.write(`Done. ${result.totalDeletedKeys} key(s) deleted in total.\n`);
    return 0;
  } finally {
    redis.disconnect();
  }
}

enterSystemScope('cli: clear the settings cache', main)
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`cache:clear failed: ${String(err)}\n`);
    process.exit(1);
  });
