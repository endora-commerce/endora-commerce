import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CreateImportProfileRequest,
  ImportProfile as ImportProfileView,
  UpdateImportProfileRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ImportProfile } from '../entities/import-profile.entity.js';
import {
  createImportProfileCommand,
  deleteImportProfileCommand,
  profileNotFound,
  updateImportProfileCommand,
} from '../commands/import-profile.commands.js';

/**
 * Import profiles (`specs/170-product-editor-scope-switcher/contracts/import-profiles-and-csv.md`
 * §1; FR-048). Reads go straight to the module's own table; every write is a Command
 * (Constitution XIII). Profiles are platform-global — any `catalog:write` admin may edit any.
 */
export interface ImportProfileServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
}

export function toImportProfileView(row: ImportProfile): ImportProfileView {
  return {
    id: row.id,
    name: row.name,
    entity: row.entity,
    sourceLanguageForGlobal: row.sourceLanguageForGlobal ?? null,
    localeMapping: row.localeMapping,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ImportProfileService {
  constructor(private readonly deps: ImportProfileServiceDeps) {}

  async list(query: { entity?: 'products' | undefined }): Promise<ImportProfileView[]> {
    const rows = await this.deps.emFactory().find(
      ImportProfile,
      query.entity ? { entity: query.entity } : {},
      { orderBy: { name: 'asc' } },
    );
    return rows.map(toImportProfileView);
  }

  async get(id: string): Promise<ImportProfileView> {
    const row = await this.deps.emFactory().findOne(ImportProfile, { id });
    if (!row) throw profileNotFound(id);
    return toImportProfileView(row);
  }

  /**
   * The profile a run uses, read once at run start (the snapshot of
   * `import-profiles-and-csv.md` §2): an edit while the run is going has no effect on it.
   */
  async snapshot(id: string): Promise<ImportProfileView> {
    return structuredClone(await this.get(id));
  }

  async create(body: CreateImportProfileRequest): Promise<ImportProfileView> {
    const { row } = await this.deps.commandBus.run(
      createImportProfileCommand({
        id: randomUUID(),
        name: body.name,
        entity: body.entity,
        sourceLanguageForGlobal: body.sourceLanguageForGlobal,
        localeMapping: body.localeMapping,
      }),
    );
    return toImportProfileView(row);
  }

  async update(id: string, body: UpdateImportProfileRequest): Promise<ImportProfileView> {
    const { row } = await this.deps.commandBus.run(updateImportProfileCommand({ id, patch: body }));
    return toImportProfileView(row);
  }

  async delete(id: string): Promise<void> {
    await this.deps.commandBus.run(deleteImportProfileCommand({ id }));
  }
}
