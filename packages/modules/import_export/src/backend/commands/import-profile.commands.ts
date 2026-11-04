import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type PimLocaleMappingEntry } from '@endora-commerce/contracts';
import type { AuditState, Command, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ImportProfile } from '../entities/import-profile.entity.js';

/**
 * The three writes of import profiles (`specs/172-product-editor-scope-switcher/data-model.md`
 * §11; Constitution XIII), each a Command run by `CommandBus.run`: one audit entry per
 * successful run, none for a refusal — every check throws before the first write, and a throw
 * rolls the transaction (and the audit row) back. `before` / `after` are the row projection.
 */

const OBJECT_TYPE = 'import_profile';

/** The audit projection of a profile: the row, without its timestamps. */
export function auditStateOf(row: ImportProfile): AuditState {
  return {
    name: row.name,
    entity: row.entity,
    sourceLanguageForGlobal: row.sourceLanguageForGlobal ?? null,
    localeMapping: row.localeMapping,
  };
}

export function profileNotFound(profileId: string): HttpError {
  return new HttpError(404, ERROR_CODES.IMPORT_PROFILE_NOT_FOUND, 'Import profile not found.', { profileId });
}

function nameTaken(name: string): HttpError {
  return new HttpError(409, ERROR_CODES.IMPORT_PROFILE_NAME_TAKEN, 'Another import profile already has this name.', {
    name,
  });
}

/**
 * Refuse a name another profile holds, compared case-insensitively — the same predicate as the
 * migration's `lower(name)` unique index. Serialised per lower-cased name, so two concurrent
 * writes of one name end in one row and one `409` rather than a constraint error.
 */
async function assertNameFree(em: EntityManager, name: string, exceptId: string | null): Promise<void> {
  await em.execute('select pg_advisory_xact_lock(hashtext(?))', [`import_profiles:name:${name.toLowerCase()}`]);
  const rows = await em.execute<Array<{ id: string }>>(
    `select id from import_profiles where lower(name) = lower(?) ${exceptId ? 'and id <> ?' : ''} limit 1`,
    exceptId ? [name, exceptId] : [name],
  );
  if (rows.length > 0) throw nameTaken(name);
}

async function load(ctx: CommandContext, id: string): Promise<ImportProfile> {
  const row = await ctx.em.findOne(ImportProfile, { id });
  if (!row) throw profileNotFound(id);
  return row;
}

export interface ImportProfileResult {
  readonly row: ImportProfile;
}

export function createImportProfileCommand(input: {
  readonly id: string;
  readonly name: string;
  readonly entity: 'products';
  readonly sourceLanguageForGlobal: string | null;
  readonly localeMapping: PimLocaleMappingEntry[];
}): Command<ImportProfileResult> {
  return {
    action: 'import_profile.create',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      await assertNameFree(ctx.em, input.name, null);
      const now = new Date();
      const row = ctx.em.create(ImportProfile, {
        id: input.id,
        name: input.name,
        entity: input.entity,
        sourceLanguageForGlobal: input.sourceLanguageForGlobal,
        localeMapping: input.localeMapping,
        createdAt: now,
        updatedAt: now,
      });
      ctx.em.persist(row);
      await ctx.em.flush();
      return { result: { row }, after: auditStateOf(row) };
    },
  };
}

export function updateImportProfileCommand(input: {
  readonly id: string;
  readonly patch: {
    name?: string | undefined;
    entity?: 'products' | undefined;
    sourceLanguageForGlobal?: string | null | undefined;
    localeMapping?: PimLocaleMappingEntry[] | undefined;
  };
}): Command<ImportProfileResult> {
  return {
    action: 'import_profile.update',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await load(ctx, input.id);
      const before = auditStateOf(row);
      const { patch } = input;
      if (patch.name !== undefined && patch.name !== row.name) await assertNameFree(ctx.em, patch.name, row.id);
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.entity !== undefined) row.entity = patch.entity;
      if (patch.sourceLanguageForGlobal !== undefined) row.sourceLanguageForGlobal = patch.sourceLanguageForGlobal;
      if (patch.localeMapping !== undefined) row.localeMapping = patch.localeMapping;
      row.updatedAt = new Date();
      await ctx.em.flush();
      return { result: { row }, before, after: auditStateOf(row) };
    },
  };
}

export function deleteImportProfileCommand(input: { readonly id: string }): Command<void> {
  return {
    action: 'import_profile.delete',
    objectType: OBJECT_TYPE,
    objectId: input.id,
    async run(ctx) {
      const row = await load(ctx, input.id);
      const before = auditStateOf(row);
      ctx.em.remove(row);
      await ctx.em.flush();
      return { result: undefined, before };
    },
  };
}
