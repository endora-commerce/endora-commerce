import ts from 'typescript';

/**
 * Which classes of a source file are persisted entities, read off the syntax
 * tree.
 *
 * ## Why this is not a text match
 *
 * The composer generator answered this with `source.includes(...)` on the
 * decorator's spelling and took the next `export class` for the class it
 * decorated. Text and syntax disagree in both directions:
 *
 * - **A sentence triggered it.** A comment, a string literal or a JSDoc example
 *   that quotes the decorator made its file "declare an entity". With no
 *   exported class below, the generator threw about a class that "could not be
 *   read" in a file that declares none; with a module package it went on to
 *   report entities "behind two subpaths" and pointed at the `exports` map. And
 *   with an exported class below — a service documenting its owner's entity —
 *   it **registered that class**, which is the direction that emits a wrong
 *   artefact instead of refusing.
 * - **A real decorator escaped it.** `@Entity (`, a namespace-qualified
 *   `@orm.Entity()` and a call broken across lines are all the same node and
 *   none of them is the seven characters the scan looked for. In a file not
 *   named `*.entity.ts` the miss was a silent skip.
 *
 * So this asks the parser, as the checks do (`declaredTableNames`,
 * `check:entity-tenant-classification`). A comment is trivia and a string is a
 * literal; neither is a `Decorator` node, and every spelling of a decorator is.
 *
 * ## What counts
 *
 * Every `Decorator` node in the file whose applied name is `Entity` — bare or
 * called, an identifier or the property of a namespace — wherever the parser
 * put it. The walk is over all nodes rather than over top-level classes, and
 * that is deliberate: a decorator the registry cannot use (on a class that is
 * not exported by name at the top level, on a member, on a class expression)
 * is reported as `unreadable` rather than passed over, so the caller refuses
 * it. A walk that only looked where a usable entity could be would turn each
 * of those into an entity quietly absent from the ORM metadata.
 */
export type EntityDeclaration =
  | { readonly kind: 'class'; readonly className: string; readonly line: number }
  | { readonly kind: 'unreadable'; readonly line: number; readonly reason: string };

/** The decorator name this module reads. Other decorators are not its subject. */
const ENTITY = 'Entity';

/** The name a decorator expression applies, whatever spelling it arrived in. */
function appliedName(expression: ts.Expression): string | undefined {
  const callee = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name))
    return callee.name.text;
  return undefined;
}

function hasModifier(node: ts.ClassDeclaration, kind: ts.SyntaxKind): boolean {
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/** Why the registry cannot name what `decorator` sits on, or the class name. */
function targetOf(decorator: ts.Decorator): { className: string } | { reason: string } {
  const target = decorator.parent;
  if (!ts.isClassDeclaration(target)) {
    return { reason: 'it does not sit on a class declaration' };
  }
  if (!ts.isSourceFile(target.parent)) {
    return { reason: 'the class is not declared at the top level of the file' };
  }
  if (target.name === undefined) {
    return { reason: 'the class has no name' };
  }
  if (!hasModifier(target, ts.SyntaxKind.ExportKeyword)) {
    return { reason: `class '${target.name.text}' is not exported` };
  }
  if (hasModifier(target, ts.SyntaxKind.DefaultKeyword)) {
    return {
      reason: `class '${target.name.text}' is a default export, and the registry imports by name`,
    };
  }
  return { className: target.name.text };
}

/**
 * Every entity decorator `source` applies, in source order.
 *
 * A class carrying the decorator twice is reported twice; that is a defect in
 * the source and the caller's duplicate-name refusal says so.
 */
export function entityDeclarations(source: string, file: string): EntityDeclaration[] {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const found: EntityDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && appliedName(node.expression) === ENTITY) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const target = targetOf(node);
      found.push(
        'className' in target
          ? { kind: 'class', className: target.className, line }
          : { kind: 'unreadable', line, reason: target.reason },
      );
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * The first line on which `source` *spells* the decorator, or `null`.
 *
 * For a diagnostic only, never for a decision: when a file declares no entity
 * and yet spells the decorator, the spelling is in a comment or a string, and
 * saying which line sends the author there instead of to a class.
 */
export function entityDecoratorMentionLine(source: string): number | null {
  const match = /@\s*(?:\w+\s*\.\s*)?Entity\b/.exec(source);
  if (match === null) return null;
  return source.slice(0, match.index).split('\n').length;
}
