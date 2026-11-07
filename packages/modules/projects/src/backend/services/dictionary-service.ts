import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  pickLocalized,
  slugify,
  type CreateProjectRoleBody,
  type ProjectRole,
  type UpdateProjectRoleBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import type { ProjectLossReason } from '../entities/project-loss-reason.entity.js';
import type { ProjectRole as ProjectRoleEntity } from '../entities/project-role.entity.js';
import { isUuid } from './project-access.js';

/**
 * The two configuration dictionaries of `projects` — Project Roles and loss
 * reasons (`specs/163-projects-and-tasks/`, User Story 4; `data-model.md`
 * §2.1; `contracts/admin-api.md` §2.5). One shape, one set of writes, so one
 * implementation; `role-service.ts` and `loss-reason-service.ts` say which
 * table it writes and what "in use" means for it.
 *
 * Every write is one Command (Constitution XIII) with `objectType`
 * `project_role` or `project_loss_reason` and the actions `<prefix>.create`,
 * `.update`, `.archive`, `.restore`, `.delete`. Every refusal is checked
 * before the Command; the delete checks again inside it, on the locked row.
 *
 * **Concurrency (issue #453).** A create and a rename take the dictionary's
 * advisory lock (`projects.dictionary:<table>`) first inside their Command,
 * and only then check the name — and, for a create, pick the code and read the
 * next position. Two creates of one name therefore answer `201` and
 * `409 nameTaken`, never a collision on the code's unique index and never a
 * second row suffixed `_2`; a retry on the unique violation would have hidden exactly
 * that. A dictionary may also lock a row against the writes that name it
 * before its delete asks "in use?" ({@link DictionaryDefinition.lockForDelete}).
 *
 * - The **code** is derived from the default name when the row is added
 *   (`slugify`, `_`-separated, a numeric suffix when another row holds it) and
 *   never changes — the analytics and the events name a row by it.
 * - Two rows of one dictionary never share a **default name**, whatever its
 *   case and whether one is archived: the operator restores the old one.
 * - **Archived** rows stay on the Projects and Templates that use them and are
 *   no longer offered (`?active=true`); the writes that hand a row out refuse
 *   an archived one (`project-service.ts`, `template-service.ts`,
 *   `move-service.ts`).
 * - **Seeded** rows (`isSystem`) are renamable and archivable, never deleted;
 *   nor is a row a Project or a Template uses.
 *
 * Configuration is platform-wide (`@GlobalEntity`), so no Organization reach
 * applies. Nothing here grants or withdraws a permission (FR-009).
 */

type DictionaryEntity = typeof ProjectRoleEntity | typeof ProjectLossReason;

export interface DictionaryDefinition {
  entity: DictionaryEntity;
  table: 'project_roles' | 'project_loss_reasons';
  objectType: 'project_role' | 'project_loss_reason';
  actionPrefix: 'projects.role' | 'projects.loss_reason';
  /** The code an empty slug falls back to. */
  fallbackCode: string;
  /** Whether a Project or a Template uses row `id` — read on the Command's `em`. */
  inUse: (em: EntityManager, id: string) => Promise<boolean>;
  /**
   * Taken inside the delete's Command before `inUse` is asked, where a write
   * naming the row is not stopped by a foreign key (Roles: `role-locks.ts`).
   */
  lockForDelete?: (em: EntityManager, id: string) => Promise<void>;
}

export interface DictionaryServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
}

/** A Project Role and a loss reason have one body and one answer (`contracts/src/projects.ts`). */
export type DictionaryBody = CreateProjectRoleBody;
export type DictionaryPatch = UpdateProjectRoleBody;
export type DictionaryEntry = ProjectRole;

const CODE_MAX = 60;

type Row = InstanceType<DictionaryEntity>;

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.PROJECT_DICTIONARY_ENTRY_NOT_FOUND, 'No such entry.');
}

function nameTaken(): HttpError {
  return new HttpError(409, ERROR_CODES.PROJECT_DICTIONARY_NAME_TAKEN, 'Another entry already has this name.');
}

/** The audit snapshot of a row — what an operator configured. */
function snapshot(row: Row): Record<string, unknown> {
  return {
    code: row.code,
    defaultName: row.defaultName,
    name: row.name,
    archived: row.archivedAt != null,
    position: row.position,
  };
}

export class DictionaryService {
  constructor(
    private readonly deps: DictionaryServiceDeps,
    private readonly definition: DictionaryDefinition,
  ) {}

  /** One row as the read routes answer it, its label in `language`. */
  async get(id: string, language: string): Promise<DictionaryEntry> {
    const row = await this.#find(this.deps.emFactory(), id);
    if (!row) throw notFound();
    return this.#present(row, language);
  }

  /** `POST` — an operator row, last in order. */
  async create(body: DictionaryBody, language: string): Promise<DictionaryEntry> {
    const { entity, objectType, actionPrefix } = this.definition;
    const id = randomUUID();
    await this.deps.commandBus.run({
      action: `${actionPrefix}.create`,
      objectType,
      objectId: id,
      run: async ({ em: tx }) => {
        const scoped = tx as EntityManager;
        // Issue #453 — the dictionary's turn first; the name, the code and the
        // position are all read under it.
        await this.#lockDictionary(scoped);
        await this.#assertNameFree(scoped, body.defaultName, null);
        const code = await this.#freeCode(scoped, body.defaultName);
        const [{ next }] = (await scoped.execute(
          `select coalesce(max("position"), 0) + 10 as "next" from "${this.definition.table}"`,
        )) as [{ next: number }];
        const row = scoped.create(entity as typeof ProjectRoleEntity, {
          id,
          code,
          name: body.name,
          defaultName: body.defaultName,
          position: Number(next),
        });
        await scoped.flush();
        return { result: null, before: null, after: snapshot(row) };
      },
    });
    return this.get(id, language);
  }

  /** `PATCH /:id` — renaming; the code never changes. `name` replaces the names per language. */
  async update(id: string, patch: DictionaryPatch, language: string): Promise<DictionaryEntry> {
    if (!(await this.#find(this.deps.emFactory(), id))) throw notFound();
    const { objectType, actionPrefix } = this.definition;
    await this.deps.commandBus.run({
      action: `${actionPrefix}.update`,
      objectType,
      objectId: id,
      run: async ({ em: tx }) => {
        const scoped = tx as EntityManager;
        // Issue #453 — a rename checks the name under the dictionary's turn,
        // the one a create holds while it checks and writes.
        if (patch.defaultName !== undefined) {
          await this.#lockDictionary(scoped);
          await this.#assertNameFree(scoped, patch.defaultName, id);
        }
        const row = await this.#find(scoped, id, true);
        if (!row) throw notFound();
        const before = snapshot(row);
        if (patch.name !== undefined) row.name = patch.name;
        if (patch.defaultName !== undefined) row.defaultName = patch.defaultName;
        row.updatedAt = new Date();
        return { result: null, before, after: snapshot(row) };
      },
    });
    return this.get(id, language);
  }

  /** `POST /:id/archive` — no longer offered; it stays where it is used. */
  async archive(id: string, language: string): Promise<DictionaryEntry> {
    return this.#setArchived(id, true, language);
  }

  /** `POST /:id/restore`. */
  async restore(id: string, language: string): Promise<DictionaryEntry> {
    return this.#setArchived(id, false, language);
  }

  /** `DELETE /:id` — an operator row nothing uses; 409 otherwise. */
  async delete(id: string): Promise<void> {
    const em = this.deps.emFactory();
    const row = await this.#find(em, id);
    if (!row) throw notFound();
    this.#assertDeletable(row, await this.definition.inUse(em, id));
    const { objectType, actionPrefix } = this.definition;
    await this.deps.commandBus.run({
      action: `${actionPrefix}.delete`,
      objectType,
      objectId: id,
      run: async ({ em: tx }) => {
        const scoped = tx as EntityManager;
        // Issue #453 — before "in use?": a write naming the row waits, or is waited for.
        await this.definition.lockForDelete?.(scoped, id);
        const locked = await this.#find(scoped, id, true);
        if (!locked) throw notFound();
        // Again on the locked row: a Project may have taken it since.
        this.#assertDeletable(locked, await this.definition.inUse(scoped, id));
        const before = snapshot(locked);
        scoped.remove(locked);
        await scoped.flush();
        return { result: null, before, after: null };
      },
    });
  }

  async #setArchived(id: string, archived: boolean, language: string): Promise<DictionaryEntry> {
    if (!(await this.#find(this.deps.emFactory(), id))) throw notFound();
    const { objectType, actionPrefix } = this.definition;
    await this.deps.commandBus.run({
      action: `${actionPrefix}.${archived ? 'archive' : 'restore'}`,
      objectType,
      objectId: id,
      run: async ({ em: tx }) => {
        const row = await this.#find(tx as EntityManager, id, true);
        if (!row) throw notFound();
        const wasArchived = row.archivedAt != null;
        if (wasArchived === archived) return { result: null, skipAudit: true };
        row.archivedAt = archived ? new Date() : null;
        row.updatedAt = new Date();
        return { result: null, before: { archived: wasArchived }, after: { archived } };
      },
    });
    return this.get(id, language);
  }

  #assertDeletable(row: Row, inUse: boolean): void {
    if (row.isSystem) {
      throw new HttpError(
        409,
        ERROR_CODES.PROJECT_DICTIONARY_ENTRY_SYSTEM,
        'This entry comes with the platform and cannot be deleted. Archive it instead.',
      );
    }
    if (inUse) {
      throw new HttpError(
        409,
        ERROR_CODES.PROJECT_DICTIONARY_ENTRY_IN_USE,
        'Projects or templates use this entry, so it cannot be deleted. Archive it instead.',
      );
    }
  }

  /** The dictionary's advisory lock, held until the Command's transaction ends. */
  async #lockDictionary(em: EntityManager): Promise<void> {
    await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
      `projects.dictionary:${this.definition.table}`,
    ]);
  }

  async #find(em: EntityManager, id: string, lock = false): Promise<Row | null> {
    if (!isUuid(id)) return null;
    return em.findOne(this.definition.entity as typeof ProjectRoleEntity, { id }, {
      refresh: true,
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    });
  }

  /** 409 when another row of this dictionary has `defaultName`, whatever its case, archived or not. */
  async #assertNameFree(em: EntityManager, defaultName: string, exceptId: string | null): Promise<void> {
    const rows = (await em.execute(
      `select 1 from "${this.definition.table}" where lower("default_name") = lower(?) ${exceptId ? 'and "id" <> ?' : ''} limit 1`,
      exceptId ? [defaultName.trim(), exceptId] : [defaultName.trim()],
    )) as unknown[];
    if (rows.length > 0) throw nameTaken();
  }

  /** The default name's slug, suffixed `_2`, `_3`, … past the codes already held. */
  async #freeCode(em: EntityManager, defaultName: string): Promise<string> {
    const base = slugify(defaultName, { separator: '_', maxLength: CODE_MAX, fallback: this.definition.fallbackCode });
    const held = new Set(
      (
        (await em.execute(`select "code" from "${this.definition.table}" where "code" = ? or "code" like ?`, [
          base,
          `${base}\\_%`,
        ])) as Array<{ code: string }>
      ).map((row) => row.code),
    );
    if (!held.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}_${suffix}`;
      if (!held.has(candidate)) return candidate;
    }
  }

  #present(row: Row, language: string): DictionaryEntry {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      defaultName: row.defaultName,
      label: pickLocalized(row.name, language) || row.defaultName,
      isSystem: row.isSystem,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      position: row.position,
    };
  }
}
