/**
 * `search reindex` — push every Sales Channel's public product surface into
 * Meilisearch (quickstart §3 / troubleshooting, tasks T067).
 *
 * Idempotent: call after a fresh `seed:dev` or whenever the index drifts from
 * PostgreSQL. Exits non-zero if Meilisearch is unreachable.
 *
 * ## What composing bought here, and what it closed
 *
 * This was `scripts/reindex.ts`, and it hand-built a **second** `SearchIndexer`
 * out of five services belonging to two other modules —
 * `CatalogAttributeReadService`, `CatalogProductReadService`,
 * `CatalogCategoryReadService`, `CustomFieldDefinitionService` and
 * `CustomFieldDefinitionsCache`. Those five imports were the whole of this
 * module's `check:module-boundary` shard, five of the eighteen keys left to
 * drain across the repository, escalated rather than cut on the ground that *"a
 * module-owned CLI entry point has no container and no `ModuleContext`, so
 * there is nothing here to resolve `catalogAttributeReadPort` … from"*.
 *
 * The host composes now, so this resolves `searchHandle` — **this module's own
 * registration** — and reindexes through the one indexer the composition holds,
 * built in `backend.ts` from those same ports. All five keys go and
 * `custom_fields` never becomes a `search` dependency: it leaked in only as a
 * collaborator of the `catalog` service the CLI was constructing, and `catalog`
 * owns that edge.
 *
 * Two defects go with them. The old script handed
 * `CustomFieldDefinitionService` a fake `CommandBus` that **threw on use** — an
 * audit seam disabled by construction, in a file no reviewer of a Command would
 * think to open — and it ran a second `SearchIndexer` and a second Meilisearch
 * client beside the module's own, which is the *"two instances of one service,
 * neither required to agree with the other"* shape `search/backend.ts` records
 * as the reason `searchReindexPort` came home.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '../../../kernel/index.js';
import type { SearchModuleHandle } from '../plugin.js';

/** This module's own handle, plus the EntityManager factory every root supplies. */
interface SearchReindexCradle {
  readonly searchHandle: SearchModuleHandle;
  readonly emFactory: () => EntityManager;
}

export async function reindex({
  ctx,
  out,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  // A cradle read and **not** `lazyPort<SearchModuleHandle>(ctx, 'searchHandle')`,
  // which compiles and then fails at runtime with
  // `handle.indexer.reindexAllChannels is not a function`. `lazyPort` returns a
  // proxy that answers *every* property with a function so it can forward a
  // method call — the same property that makes optional methods impossible
  // through a port (D-97.3) — so a nested reach like `handle.indexer` gets a
  // function rather than the indexer. `searchHandle` is this module's own name,
  // so a cradle read crosses no boundary and hides no edge from
  // `check:port-dependencies`; presence for this module was decided by the host
  // before this body ran.
  //
  // `reindexAllChannels` rather than `searchReindexPort.reindexAll` because the
  // per-channel breakdown below is what an operator runs this for, and the port
  // returns one total. Both run over the same indexer.
  const cradle = ctx.cradle<SearchReindexCradle>();
  const results = await cradle.searchHandle.indexer.reindexAllChannels(cradle.emFactory());

  out('');
  out('=== Search reindex complete ===');
  if (results.length === 0) {
    out('No Sales Channels found — run seed:dev first.');
  } else {
    for (const r of results) {
      out(
        `  ${r.channelCode.padEnd(16)} → ${r.indexUid.padEnd(28)} ` +
          `(${r.documentCount} document${r.documentCount === 1 ? '' : 's'})`,
      );
    }
  }
  out('');
  return 0;
}
