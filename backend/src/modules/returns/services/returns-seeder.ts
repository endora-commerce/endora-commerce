import type { EntityManager } from '@mikro-orm/postgresql';
import { ReturnStatus } from '../entities/return-status.entity.js';
import { ReturnStatusTransition } from '../entities/return-status-transition.entity.js';
import { ReturnReason } from '../entities/return-reason.entity.js';
import {
  DEFAULT_RETURN_STATUSES,
  computeDefaultTransitions,
} from '../domain/return-status-graph.js';
import { DEFAULT_RETURN_REASONS } from '../domain/default-reasons.js';

/**
 * ReturnsSeeder — feature 046 (T017).
 *
 * Idempotently ensures the default status graph and reasons exist. The init
 * migration seeds these on a fresh install; this runtime seeder is a no-op when
 * the data is present and restores it when absent (e.g. after a module
 * uninstall/reinstall under the lifecycle), so the module is self-healing. It is
 * invoked once at module boot.
 */
export class ReturnsSeeder {
  constructor(private readonly emFactory: () => EntityManager) {}

  async ensureDefaults(): Promise<void> {
    await this.ensureStatusGraph();
    await this.ensureReasons();
  }

  private async ensureStatusGraph(): Promise<void> {
    const em = this.emFactory();
    if ((await em.count(ReturnStatus, {})) > 0) return;
    for (const s of DEFAULT_RETURN_STATUSES) {
      em.persist(
        em.create(ReturnStatus, {
          code: s.code,
          name: s.name,
          defaultName: s.defaultName,
          isInitial: s.isInitial,
          isTerminal: s.isTerminal,
          isSystem: s.isSystem,
          weight: s.weight,
          color: s.color,
        }),
      );
    }
    for (const t of computeDefaultTransitions()) {
      em.persist(
        em.create(ReturnStatusTransition, {
          fromStatusCode: t.fromStatusCode,
          toStatusCode: t.toStatusCode,
          isSystem: t.isSystem,
        }),
      );
    }
    await em.flush();
  }

  private async ensureReasons(): Promise<void> {
    const em = this.emFactory();
    if ((await em.count(ReturnReason, {})) > 0) return;
    for (const r of DEFAULT_RETURN_REASONS) {
      em.persist(em.create(ReturnReason, { label: r.label, appliesTo: r.appliesTo, weight: r.weight }));
    }
    await em.flush();
  }
}
