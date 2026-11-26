import {
  EntityExtensionDeclarationSchema,
  type EntityExtensionDeclaration,
} from '@endora-commerce/contracts';
import { ENTITY_EXTENSION_HOSTS, type EntityExtensionHost } from '../schema-extensions/extensible-hosts.js';
import { dependencyClosureOf } from '../schema-extensions/validate.js';
import {
  EntityExtensionInvalidError,
  type EntityExtensionOrigin,
  type EntityExtensionRule,
} from './errors.js';

/**
 * The **static** rules of a side-table declaration over a whole composition
 * (`specs/187-side-table-extensions/contracts/entity-extension-declaration.md`
 * §3, FR-001 – FR-005): E1 shape and E5 duplicate table again, for a manifest
 * that did not pass through `defineModuleManifest` (a compiled package's), and
 * E2 – E4, which need every composed manifest — which hosts exist, who owns
 * them, and the dependency closure.
 *
 * No ORM and no database, so the manifest-registry derivation (and through it
 * the lifecycle and boot), the migration merge and `audit-packages` all ask the
 * same function.
 *
 * The origin is carried into the result and the errors and read by **no** rule
 * (FR-005, OR-5): a core module, an installed package and an overlay module
 * declare on identical terms.
 */

/** The part of a module's manifest these rules read. */
export interface EntityExtensionManifest {
  readonly moduleId: string;
  readonly origin: EntityExtensionOrigin;
  readonly dependencies: readonly string[];
  /** The manifest's `extends`, unvalidated — E1 is asked here too. */
  readonly extends?: readonly unknown[] | undefined;
}

/** A declaration that passed E1 – E5 — what the metadata and physical rules are handed. */
export interface ResolvedEntityExtension {
  readonly moduleId: string;
  readonly origin: EntityExtensionOrigin;
  readonly declaration: EntityExtensionDeclaration;
  readonly host: EntityExtensionHost;
}

export interface EntityExtensionJudgementOptions {
  /** The hosts in force. Defaults to every custom-field host (research R-3). */
  readonly hosts?: ReadonlyMap<string, EntityExtensionHost>;
  /**
   * Edges of modules outside `manifests` — the committed core graph when only
   * the installed packages are judged (`audit-packages`). An edge given by a
   * manifest in `manifests` wins.
   */
  readonly dependencies?: ReadonlyMap<string, readonly string[]>;
}

/** One entry's verdict — `audit-packages`' line, and the input of the refusal. */
export interface EntityExtensionVerdict {
  readonly moduleId: string;
  readonly origin: EntityExtensionOrigin;
  /** The entry's `table`, or `#<index>` when the entry has none to name. */
  readonly table: string;
  readonly entity: string;
  readonly verdict: 'ok' | EntityExtensionRule;
  /** The resolved declaration when `ok`. */
  readonly resolved?: ResolvedEntityExtension;
  /** The refusal when not `ok`. */
  readonly error?: EntityExtensionInvalidError;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Every entry of every manifest, judged — never a throw. The order is the
 * manifests', then each manifest's entries'.
 */
export function judgeEntityExtensions(
  manifests: readonly EntityExtensionManifest[],
  options: EntityExtensionJudgementOptions = {},
): EntityExtensionVerdict[] {
  const hosts = options.hosts ?? ENTITY_EXTENSION_HOSTS;
  const graph = new Map<string, readonly string[]>(options.dependencies ?? []);
  for (const manifest of manifests) graph.set(manifest.moduleId, manifest.dependencies);
  const listed = [...hosts.keys()].sort().join(', ');
  // One table has one owner: the first module to declare it keeps it.
  const claimedBy = new Map<string, string>();
  const verdicts: EntityExtensionVerdict[] = [];

  for (const manifest of manifests) {
    const entries = manifest.extends ?? [];
    if (entries.length === 0) continue;
    const closure = dependencyClosureOf(manifest.moduleId, graph);
    const own = new Set<string>();
    for (const [index, raw] of entries.entries()) {
      const rawTable = textOf((raw as { table?: unknown } | null)?.table);
      const rawEntity = textOf((raw as { entity?: unknown } | null)?.entity);
      const refuse = (rule: EntityExtensionRule, detail: string): void => {
        const table = rawTable ?? `#${index}`;
        const entity = rawEntity ?? '(no entity)';
        verdicts.push({
          moduleId: manifest.moduleId,
          origin: manifest.origin,
          table,
          entity,
          verdict: rule,
          error: new EntityExtensionInvalidError({
            rule,
            moduleId: manifest.moduleId,
            origin: manifest.origin,
            table,
            entity,
            detail,
          }),
        });
      };

      // E1 — the shape. A compiled package's manifest may not have been built
      // with `defineModuleManifest`, so the schema is asked again.
      const parsed = EntityExtensionDeclarationSchema.safeParse(raw);
      if (!parsed.success) {
        refuse(
          'declaration-shape',
          `extends[${index}] is not { entity: '<ownerModuleId>.<EntityClassName>', table: '<lower_snake ≤ 63 bytes>' }: ` +
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(entry)'}: ${issue.message}`).join('; '),
        );
        continue;
      }
      const declaration = parsed.data;

      // E5 — one table, one declaration; and across modules, one owner.
      if (own.has(declaration.table)) {
        refuse('duplicate-table', 'the manifest lists this table twice; a table extends one host, so list it once');
        continue;
      }
      own.add(declaration.table);
      const owner = claimedBy.get(declaration.table);
      if (owner !== undefined && owner !== manifest.moduleId) {
        refuse(
          'duplicate-table',
          `module "${owner}" already declares this table; a side table is owned by exactly one module`,
        );
        continue;
      }

      // E2 — an extensible host, named `<owner>.<Class>`.
      const host = hosts.get(declaration.entity);
      if (host === undefined) {
        refuse(
          'host-not-extensible',
          `"${declaration.entity}" is not an extensible host; the hosts a side table may extend are: ${listed}`,
        );
        continue;
      }

      // E4 — the host's own module keeps a 1:1 table as ordinary ownership.
      if (host.ownerModuleId === manifest.moduleId) {
        refuse(
          'self-extension',
          `"${manifest.moduleId}" owns ${declaration.entity} itself; a table of its own aggregate is ordinary ` +
            'ownership, not an extension — remove the entry',
        );
        continue;
      }

      // E3 — the host's owner orders the migrations, so it must be a dependency.
      if (!closure.has(host.ownerModuleId)) {
        refuse(
          'host-not-a-dependency',
          `${declaration.entity} is owned by module "${host.ownerModuleId}", which is not in ` +
            `"${manifest.moduleId}"'s dependency closure; add "${host.ownerModuleId}" to the manifest's dependencies`,
        );
        continue;
      }

      claimedBy.set(declaration.table, manifest.moduleId);
      verdicts.push({
        moduleId: manifest.moduleId,
        origin: manifest.origin,
        table: declaration.table,
        entity: declaration.entity,
        verdict: 'ok',
        resolved: { moduleId: manifest.moduleId, origin: manifest.origin, declaration, host },
      });
    }
  }
  return verdicts;
}

/**
 * The declarations of `manifests`, resolved — or the first refusal, thrown as
 * {@link EntityExtensionInvalidError}. A composition that declares nothing
 * resolves to `[]` without reading anything but the absent fields.
 */
export function resolveEntityExtensions(
  manifests: readonly EntityExtensionManifest[],
  options: EntityExtensionJudgementOptions = {},
): ResolvedEntityExtension[] {
  const resolved: ResolvedEntityExtension[] = [];
  for (const verdict of judgeEntityExtensions(manifests, options)) {
    if (verdict.error !== undefined) throw verdict.error;
    if (verdict.resolved !== undefined) resolved.push(verdict.resolved);
  }
  return resolved;
}
