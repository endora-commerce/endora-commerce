/**
 * Search reindex CLI (quickstart §3 / troubleshooting + tasks T067).
 *
 * Walks every Sales Channel and pushes its public product surface into
 * Meilisearch. Idempotent — call after a fresh `seed:dev` or whenever
 * the index drifts from Postgres.
 *
 * Exits non-zero if Meilisearch is unreachable.
 */

import { initOrm, closeOrm } from '../../../db/index.js';
import { SearchIndexer } from '../services/search-indexer.js';

async function main(): Promise<void> {
  const orm = await initOrm();
  const em = orm.em.fork();
  const indexer = new SearchIndexer();
  const results = await indexer.reindexAllChannels(em);

  console.log('');
  console.log('=== Search reindex complete ===');
  if (results.length === 0) {
    console.log('No Sales Channels found — run seed:dev first.');
  } else {
    for (const r of results) {
      console.log(
        `  ${r.channelCode.padEnd(16)} → ${r.indexUid.padEnd(28)} (${r.documentCount} document${r.documentCount === 1 ? '' : 's'})`,
      );
    }
  }
  console.log('');

  await closeOrm();
}

main().catch((err) => {
  console.error('search:reindex failed:', err);
  process.exit(1);
});
