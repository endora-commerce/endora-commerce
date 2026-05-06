// Dictionaries module plugin — feature 017 / T004 (skeleton).
//
// Phase 1 establishes the export shape so downstream tasks (services, routes,
// validator, seed reconciler) can hang implementations on a stable handle.
// Real wiring lands in Phase 2 (T011, T013) and the user-story phases.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator } from '@b2b/contracts';
import {
  runDictionarySeedReconciler,
  type SeedReconcilerSummary,
} from './services/seed-reconciler.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface DictionariesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
  /** Redis is optional — when absent, the registry cache is skipped. */
  redis?: Redis;
}

export interface DictionariesModuleHandle {
  /** Cross-module validator port — wired in Phase 6 (US4). */
  validator: DictionaryValidator | undefined;
  /**
   * Run the boot reconciler (currencies + countries + Polish translations +
   * primary language↔country associations). Idempotent — operator edits are
   * preserved (FR-019).
   */
  reconcile(): Promise<SeedReconcilerSummary>;
}

export function dictionariesModule(options: DictionariesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: DictionariesModuleHandle;
} {
  let reconciled = false;

  const handle: DictionariesModuleHandle = {
    validator: undefined,
    reconcile: async () => {
      const summary = await runDictionarySeedReconciler(options.emFactory);
      reconciled = true;
      return summary;
    },
  };

  const plugin = async (_app: FastifyInstance) => {
    if (!reconciled) {
      await handle.reconcile();
    }
    // Admin + storefront routes are registered in T029 / T043 once the
    // underlying services exist.
  };

  return { plugin, handle };
}
