/**
 * TransactionalEmailReconciler — feature 047 (R6/US1/US5).
 *
 * At boot, upserts `transactional_emails` rows from module manifests +
 * registered defaults. Refreshes module-owned columns (name, variables,
 * defaults, ...) but NEVER touches `transactional_email_contents`, so admin
 * customizations are preserved across module-default updates (FR-027). Reports
 * a code collision when two modules declare the same email code (FR-006).
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';
import type { EmailDefaultsRegistry } from './email-defaults-registry.js';

export class TransactionalEmailCodeCollision extends Error {
  constructor(code: string, modules: string[]) {
    super(`Transactional email code "${code}" declared by multiple modules: ${modules.join(', ')}`);
    this.name = 'TransactionalEmailCodeCollision';
  }
}

export interface ReconcileResult {
  created: number;
  updated: number;
  pruned: number;
}

export class TransactionalEmailReconciler {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly defaults: EmailDefaultsRegistry,
    private readonly fallbackLanguages: readonly string[] = ['en-US'],
  ) {}

  async reconcile(manifests: ReadonlyArray<ModuleManifest>): Promise<ReconcileResult> {
    // command-coverage-ignore: idempotent boot reconciler — seeds/updates the
    // module-declared email blocks/templates from manifests; a system bootstrap,
    // not an operator-initiated write.
    const em = this.emFactory();
    let created = 0;
    let updated = 0;

    // Detect cross-module code collisions first.
    const owners = new Map<string, string[]>();
    for (const m of manifests) {
      for (const entry of m.transactionalEmails ?? []) {
        const list = owners.get(entry.code) ?? [];
        list.push(m.id);
        owners.set(entry.code, list);
      }
    }
    for (const [code, mods] of owners) {
      if (mods.length > 1) throw new TransactionalEmailCodeCollision(code, mods);
    }

    for (const m of manifests) {
      for (const entry of m.transactionalEmails ?? []) {
        const def = this.defaults.get(entry.code);
        const languages = def
          ? Object.keys(def.defaultContent && typeof def.defaultContent === 'object'
              ? ((def.defaultContent as { languages?: Record<string, unknown> }).languages ?? {})
              : {})
          : [];
        const resolvedLanguages = languages.length > 0 ? languages : [...this.fallbackLanguages];

        let row = await em.findOne(TransactionalEmail, { code: entry.code });
        if (!row) {
          row = em.create(TransactionalEmail, {
            code: entry.code,
            name: entry.name,
            ownerModule: m.id,
            description: entry.description ?? null,
            groupCode: entry.group ?? null,
            variables: entry.variables ?? [],
            languages: resolvedLanguages,
            defaultSubject: def?.defaultSubject ?? {},
            defaultContent: def?.defaultContent ?? { schema_version: 1, languages: {} },
            active: true,
          });
          created += 1;
        } else {
          row.name = entry.name;
          row.ownerModule = m.id;
          row.description = entry.description ?? null;
          row.groupCode = entry.group ?? null;
          row.variables = entry.variables ?? [];
          row.languages = resolvedLanguages;
          if (def) {
            row.defaultSubject = def.defaultSubject;
            row.defaultContent = def.defaultContent;
          }
          updated += 1;
        }
      }
    }

    await em.flush();

    // Prune orphans (FR-028): definitions whose owning module is no longer
    // installed / no longer declares the code. All rows are reconciler-owned, so
    // anything not currently declared is safe to remove; the FK cascade drops
    // the associated admin customizations.
    const declaredCodes = [...owners.keys()];
    const pruned =
      declaredCodes.length > 0
        ? await em.nativeDelete(TransactionalEmail, { code: { $nin: declaredCodes } })
        : await em.nativeDelete(TransactionalEmail, {});

    return { created, updated, pruned };
  }
}
