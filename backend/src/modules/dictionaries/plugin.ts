// Dictionaries module plugin — feature 017 / T004 (skeleton).
//
// Phase 1 establishes the export shape so downstream tasks (services, routes,
// validator, seed reconciler) can hang implementations on a stable handle.
// Real wiring lands in Phase 2 (T011, T013) and the user-story phases.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator } from '@b2b/contracts';

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
   * Run the boot reconciler (countries seed + Polish translations + primary
   * language↔country associations). Idempotent. Wired in Phase 2 (T011).
   */
  reconcile(): Promise<void>;
}

export function dictionariesModule(_options: DictionariesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: DictionariesModuleHandle;
} {
  // Real services land in later phases. The skeleton handle keeps the
  // composition root and the tests honest about the public shape.
  const handle: DictionariesModuleHandle = {
    validator: undefined,
    reconcile: async () => {
      // No-op until T011 wires the SeedReconciler.
    },
  };

  const plugin = async (_app: FastifyInstance) => {
    // No routes in Phase 1. Admin + storefront routes are registered in
    // T029 / T043 once the underlying services exist.
    await handle.reconcile();
  };

  return { plugin, handle };
}
