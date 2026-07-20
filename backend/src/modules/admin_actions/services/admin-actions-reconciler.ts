import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleAction as ModuleActionDecl } from '@b2b/contracts';
import { ModuleAction } from '../entities/module-action.entity.js';

/**
 * Admin Actions Reconciler — feature 020.
 *
 * Idempotent UPSERT-and-prune of `module_actions` rows from a module's
 * declared `manifest.actions` array. Mirrors feature 019's i18n-service
 * UPSERT pattern: a single SQL statement with `INSERT … ON CONFLICT
 * (module_id, action_id) DO UPDATE` so every successful install
 * advances the per-row `version` sequence whether the row existed or
 * not. After UPSERT, any rows owned by `moduleId` whose `action_id` is
 * no longer in the new declaration are deleted (prune).
 *
 * Wraps work in the caller's transaction (the lifecycle orchestrator
 * supplies its own `EntityManager`); idempotent — re-running install
 * with the same payload is a no-op aside from bumping `version`.
 */
export interface AdminActionsReconcilerDeps {
  em: () => EntityManager;
}

export class AdminActionsReconciler {
  constructor(private readonly deps: AdminActionsReconcilerDeps) {}

  /**
   * Install (or update) every declared action for `moduleId`. After
   * inserting/updating the declared rows, prune any rows for the same
   * module whose action_id is not present in the new declaration.
   */
  async installForModule(args: {
    moduleId: string;
    actions: readonly ModuleActionDecl[];
    em?: EntityManager;
  }): Promise<{ upserted: number; pruned: number }> {
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // invariant repair, not an operator-initiated audited write.
    const targetEm = args.em ?? this.deps.em();
    const knex = targetEm.getKnex();
    const declaredIds = new Set<string>();

    for (const action of args.actions) {
      declaredIds.add(action.id);
      await knex.raw(
        `insert into "module_actions" (` +
          `"module_id", "action_id", "label_key", "description_key", "icon", ` +
          `"target_route", "required_permission", "keywords", "weight", ` +
          `"installed_at", "updated_at"` +
          `) values (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, now(), now()) ` +
          `on conflict ("module_id", "action_id") do update set ` +
          `"label_key" = excluded."label_key", ` +
          `"description_key" = excluded."description_key", ` +
          `"icon" = excluded."icon", ` +
          `"target_route" = excluded."target_route", ` +
          `"required_permission" = excluded."required_permission", ` +
          `"keywords" = excluded."keywords", ` +
          `"weight" = excluded."weight", ` +
          `"version" = nextval('module_actions_version_seq'), ` +
          `"updated_at" = now()`,
        [
          args.moduleId,
          action.id,
          action.labelKey,
          action.descriptionKey ?? null,
          action.icon,
          action.targetRoute,
          action.requiredPermission ?? null,
          JSON.stringify(action.keywords ?? []),
          action.weight ?? 100,
        ],
      );
    }

    // Prune: delete any rows for this module whose action_id is not in
    // the newly-declared set. The empty-set case is safe — the
    // whereNotIn(...) becomes a delete-all-for-module.
    let pruned = 0;
    if (declaredIds.size > 0) {
      pruned = await targetEm.nativeDelete(ModuleAction, {
        moduleId: args.moduleId,
        actionId: { $nin: [...declaredIds] },
      });
    } else {
      pruned = await targetEm.nativeDelete(ModuleAction, { moduleId: args.moduleId });
    }

    return { upserted: args.actions.length, pruned };
  }

  /**
   * Hard-uninstall — drop every action row for the module. Soft-
   * uninstall (state → 'disabled') intentionally leaves rows in place;
   * visibility is gated by the registry-state join at query time.
   */
  async removeForModule(args: {
    moduleId: string;
    em?: EntityManager;
  }): Promise<{ removed: number }> {
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // invariant repair, not an operator-initiated audited write.
    const targetEm = args.em ?? this.deps.em();
    const removed = await targetEm.nativeDelete(ModuleAction, { moduleId: args.moduleId });
    return { removed };
  }
}
