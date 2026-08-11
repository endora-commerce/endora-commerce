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
import type { CommandBus } from '../../../commands/index.js';
import { SearchIndexer } from '../services/search-indexer.js';
import { CatalogAttributeReadService } from '../../catalog/services/catalog-attribute-read.service.js';
import { CustomFieldDefinitionsCache } from '../../custom_fields/services/custom-field-definitions-cache.js';
import { CustomFieldDefinitionService } from '../../custom_fields/services/custom-field-definition.service.js';
import { enterSystemScope } from '../../../kernel/scope.js';

async function main(): Promise<void> {
  const orm = await initOrm();
  const em = orm.em.fork();
  // Feature 061 — the indexer derives attribute settings + option labels from
  // the composed view. This CLI is composition-level wiring: it builds a
  // read-only definition source (no mutations run here, so the command bus is
  // a never-invoked stub).
  const definitionSource = new CustomFieldDefinitionService(
    () => orm.em.fork(),
    new CustomFieldDefinitionsCache(),
    {
      run: () => {
        throw new Error('search:reindex is read-only — no commands are dispatched');
      },
    } as unknown as CommandBus,
  );
  const indexer = new SearchIndexer({
    attributeRead: new CatalogAttributeReadService(() => orm.em.fork(), definitionSource),
  });
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

enterSystemScope('cli: search reindex', main).catch((err) => {
  console.error('search:reindex failed:', err);
  process.exit(1);
});
