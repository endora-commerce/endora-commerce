import { isColumnExtension } from './define.js';
import { SchemaExtensionInvalidError } from './errors.js';
import type { ExtensibleHostSet } from './extensible-hosts.js';
import type { ColumnExtension } from './types.js';

/**
 * The **context** rules of a declaration
 * (`contracts/column-extension-declaration.md` §3): V2 against the hosts this
 * platform has rolled out, V9 – V11 against the package that declared it.
 *
 * The shape rules ran when `defineColumnExtension` was called; these need what
 * only discovery knows, so the package reader and the ORM configuration ask
 * them, with the package's own `endora.id` and dependency closure.
 */
export interface DeclarationContext {
  /** The extensible hosts in force — the rolled-out list in production. */
  readonly hosts: ExtensibleHostSet;
  /** The declaring package's `endora.id`. */
  readonly packageModuleId: string;
  /** Every module the declaring module depends on, transitively. */
  readonly dependencyClosure: ReadonlySet<string>;
  /** For diagnostics: where the declaration came from. */
  readonly source?: string;
}

/** Refuses the first declaration that breaks a context rule; returns the list typed. */
export function validateDeclarationContext(
  declarations: readonly unknown[],
  context: DeclarationContext,
): readonly ColumnExtension[] {
  const where = context.source === undefined ? '' : ` (declared in ${context.source})`;
  const seen = new Set<string>();
  for (const [index, declaration] of declarations.entries()) {
    if (!isColumnExtension(declaration)) {
      throw new SchemaExtensionInvalidError(
        'not-a-declaration',
        context.packageModuleId,
        null,
        `schemaExtensions[${index}] was not made by defineColumnExtension${where}`,
      );
    }
    if (declaration.module !== context.packageModuleId) {
      throw new SchemaExtensionInvalidError(
        'module-mismatch',
        declaration.module,
        null,
        `the declaration's module is "${declaration.module}" but the declaring package's ` +
          `endora.id is "${context.packageModuleId}"${where}`,
      );
    }
    const host = context.hosts.get(declaration.host);
    if (host === undefined) {
      const listed = [...context.hosts.keys()].sort().join(', ') || '(none)';
      throw new SchemaExtensionInvalidError(
        'host-not-extensible',
        declaration.module,
        null,
        `"${declaration.host}" is not extensible on this platform; extensible hosts: ${listed}${where}`,
      );
    }
    if (!context.dependencyClosure.has(host.ownerModuleId)) {
      throw new SchemaExtensionInvalidError(
        'host-not-a-dependency',
        declaration.module,
        null,
        `"${declaration.host}" is owned by module "${host.ownerModuleId}", which is not in ` +
          `"${declaration.module}"'s dependency closure; add it to the manifest's dependencies${where}`,
      );
    }
    if (seen.has(declaration.id)) {
      throw new SchemaExtensionInvalidError(
        'duplicate-declaration',
        declaration.module,
        null,
        `"${declaration.module}" declares "${declaration.host}" twice; merge the two declarations${where}`,
      );
    }
    seen.add(declaration.id);
  }
  return declarations as readonly ColumnExtension[];
}

/** Every module reachable from `moduleId` through `dependencies`, excluding itself. */
export function dependencyClosureOf(
  moduleId: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const closure = new Set<string>();
  const stack = [...(dependencies.get(moduleId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (closure.has(next)) continue;
    closure.add(next);
    stack.push(...(dependencies.get(next) ?? []));
  }
  return closure;
}
