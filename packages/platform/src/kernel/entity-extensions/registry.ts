import { ENTITY_EXTENSION_HOSTS } from '../schema-extensions/extensible-hosts.js';
import type { ColumnExtension } from '../schema-extensions/types.js';
import { EntityExtensionInvalidError } from './errors.js';
import type { EntityExtensionLoaderEntry, RegisteredEntityExtensionLoader } from './loaders.js';

/**
 * The composition's side-table loaders (`specs/187-side-table-extensions/`
 * FR-053, `contracts/extension-attributes-read-ports.md` §2), beside the
 * command-hook registry and for the same reasons: every module context
 * registers into one instance, `composeModules` seals it once the last module
 * has registered, and the platform — not the host — knows who extends what.
 *
 * Registration resolves nothing and reads no presence state. The refusals are
 * the registry's, raised at the call:
 *
 * | Rule | Refused when |
 * | --- | --- |
 * | L1 `loader-without-extension` | the module's manifest has no `extends` entry on the host |
 * | L2 `duplicate-loader` | a second loader for the same (module, host) |
 * | L3 `registration-after-seal` | the composition has already sealed the registry |
 * | L4 `loader-and-columns-on-one-host` | the loader opts into admin reads and the module also serves `adminReads` D2 columns on the host's table (`specs/193-admin-form-extensions/` FR-015) |
 */

/** One manifest `extends` entry, attributed to the module whose manifest carries it. */
export interface DeclaredEntityExtension {
  readonly moduleId: string;
  readonly entity: string;
  readonly table: string;
}

/** The part of a manifest {@link entityExtensionDeclarationsFrom} reads. */
export interface EntityExtensionDeclaringManifest {
  readonly id: string;
  readonly extends?: readonly { readonly entity: string; readonly table: string }[] | undefined;
}

/**
 * Every manifest's `extends`, attributed — what L1 is judged against. The
 * declarations themselves are judged (E1 – E5) by the manifest-registry
 * derivation before any module registers; this only reads them.
 */
export function entityExtensionDeclarationsFrom(
  manifests: readonly EntityExtensionDeclaringManifest[],
): DeclaredEntityExtension[] {
  return manifests.flatMap((manifest) =>
    (manifest.extends ?? []).map((entry) => ({ moduleId: manifest.id, entity: entry.entity, table: entry.table })),
  );
}

export interface EntityExtensionLoaderRegistryOptions {
  /** Every composed manifest's `extends` — {@link entityExtensionDeclarationsFrom}. Absent: nothing is declared. */
  readonly declarations?: readonly DeclaredEntityExtension[];
  /**
   * The D2 column declarations this platform's ORM registered — what L4 is
   * judged against, read at the registration of an `adminReads` loader only
   * (the ORM is configured before any module registers; the composition roots
   * pass a reader that refuses otherwise, D-300.23). Absent: no module serves
   * columns.
   */
  readonly columnExtensions?: () => readonly Pick<ColumnExtension, 'module' | 'host' | 'adminReads'>[];
}

const key = (moduleId: string, host: string): string => `${moduleId}\u0000${host}`;

export class EntityExtensionLoaderRegistry {
  readonly #declared = new Map<string, DeclaredEntityExtension>();
  readonly #loaders = new Map<string, RegisteredEntityExtensionLoader>();
  readonly #columnExtensions: EntityExtensionLoaderRegistryOptions['columnExtensions'];
  #sealed = false;

  constructor(options: EntityExtensionLoaderRegistryOptions = {}) {
    this.#columnExtensions = options.columnExtensions;
    for (const declaration of options.declarations ?? []) {
      this.#declared.set(key(declaration.moduleId, declaration.entity), declaration);
    }
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  /** Called by the module context, which supplies `moduleId`; an entry never does. */
  register(moduleId: string, entries: readonly EntityExtensionLoaderEntry<unknown>[]): void {
    for (const entry of entries) {
      const declared = this.#declared.get(key(moduleId, entry.host));
      const refusal = (rule: EntityExtensionInvalidError['rule'], detail: string): EntityExtensionInvalidError =>
        new EntityExtensionInvalidError({
          rule,
          moduleId,
          origin: null,
          table: declared?.table ?? '(none declared)',
          entity: entry.host,
          detail,
        });
      if (this.#sealed) {
        throw refusal(
          'registration-after-seal',
          'the composition has sealed the loader registry; register loaders from registerModule, not later',
        );
      }
      if (declared === undefined) {
        throw refusal(
          'loader-without-extension',
          `the module's manifest has no extends entry on ${entry.host}; declare the side table the loader reads ` +
            `(extends: [{ entity: '${entry.host}', table: '<own table>' }]) or drop the loader`,
        );
      }
      if (this.#loaders.has(key(moduleId, entry.host))) {
        throw refusal(
          'duplicate-loader',
          `a loader for ${entry.host} is already registered by this module; one loader per host reads every ` +
            'side value the module attaches to it',
        );
      }
      const adminReads = entry.adminReads === true;
      const hostTable = ENTITY_EXTENSION_HOSTS.get(entry.host)?.table;
      if (
        adminReads &&
        hostTable !== undefined &&
        (this.#columnExtensions?.() ?? []).some(
          (columns) => columns.adminReads && columns.module === moduleId && columns.host === hostTable,
        )
      ) {
        throw refusal(
          'loader-and-columns-on-one-host',
          `the module also serves adminReads columns on ${hostTable}, and both would answer ` +
            `extensions.${moduleId} on its admin read; serve one of them there — drop adminReads from the ` +
            'loader or from the column declaration',
        );
      }
      this.#loaders.set(key(moduleId, entry.host), {
        moduleId,
        table: declared.table,
        host: entry.host,
        schema: entry.schema,
        adminReads,
        load: entry.load,
      });
    }
  }

  /** After the last module registered (`composeModules`); every later `register` is L3. */
  seal(): void {
    this.#sealed = true;
  }

  /** The loader `moduleId` registered for `host`, if any. */
  loaderFor(moduleId: string, host: string): RegisteredEntityExtensionLoader | undefined {
    return this.#loaders.get(key(moduleId, host));
  }
}
