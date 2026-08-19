import type {
  DictionaryReference,
  DictionaryReferenceDescriptor,
  DictionaryReferenceRegistryPort,
} from '@b2b/contracts';

/**
 * In-process registry of "who still points at this language code" descriptors
 * (feature 077, D-87 drain).
 *
 * Registered under `languageReferenceRegistry` and contributed to from other modules'
 * boot hooks. This module consults it before deleting a language, and
 * `dictionaries` consults it to build the orphan report.
 *
 * **Enumeration policy: honoured while the contributing module is absent.**
 * D-39's default is to skip, and honouring needs a written reason: this is
 * referential integrity, not a surface. A switched-off module still owns the
 * rows that carry the code, so skipping its descriptor would let an operator
 * delete a language that comes back as a dangling reference the moment the module
 * is switched on again — data loss caused by an action Constitution XVII
 * promises is non-destructive and reversible.
 *
 * `ownerModuleId` is recorded on every descriptor even though this registry
 * does not filter on it, because the alternative is a registry that could not
 * express the decision either way, and because it attributes a 409 to a module.
 */
export class LanguageReferenceRegistry implements DictionaryReferenceRegistryPort {
  private readonly descriptors: DictionaryReferenceDescriptor[] = [];

  register(descriptor: DictionaryReferenceDescriptor): void {
    if (!this.descriptors.includes(descriptor)) {
      this.descriptors.push(descriptor);
    }
  }

  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[] {
    return this.descriptors.map((d) => d.ownerModuleId);
  }

  async countReferences(code: string): Promise<DictionaryReference[]> {
    const counts = await Promise.all(
      this.descriptors.map(async (d) => ({ descriptor: d, count: await d.countReferences(code) })),
    );
    return counts
      .filter((row) => row.count > 0)
      .map(({ descriptor, count }) => describe(descriptor, code, count));
  }

  async usedCodes(): Promise<DictionaryReference[]> {
    const perDescriptor = await Promise.all(
      this.descriptors.map(async (d) => ({ descriptor: d, rows: await d.usedCodes() })),
    );
    return perDescriptor.flatMap(({ descriptor, rows }) =>
      rows.map((row) => describe(descriptor, row.code, row.count)),
    );
  }
}

function describe(
  descriptor: DictionaryReferenceDescriptor,
  code: string,
  count: number,
): DictionaryReference {
  return {
    ownerModuleId: descriptor.ownerModuleId,
    consumer: descriptor.consumer,
    tableName: descriptor.tableName,
    columnName: descriptor.columnName,
    code,
    count,
    blocking: descriptor.blocking,
  };
}
