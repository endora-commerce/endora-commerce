import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Reads a published port straight out of `packages/contracts/src`, so a test
 * can assert what the **contract** says rather than what a class happens to
 * implement.
 *
 * The distinction is the whole point of a narrowing (D-98.4, D-98.5, D-99.7):
 * the class keeps its methods, the interface stops publishing them, and a
 * structural assertion over the class would notice neither. `tsc` cannot be
 * asked either — an interface has no runtime value to enumerate — so the
 * source is the only place the surface exists to be measured.
 */
const CONTRACTS_SRC = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'src',
);

export function contractSource(file: string): string {
  return readFileSync(join(CONTRACTS_SRC, file), 'utf8');
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
}

function declarationOf(file: string, name: string): ts.InterfaceDeclaration | undefined {
  const sf = parse(file, contractSource(file));
  return sf.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
}

/** Every member name the published interface declares, in declaration order. */
export function publishedMembers(file: string, interfaceName: string): string[] {
  const declaration = declarationOf(file, interfaceName);
  if (declaration === undefined) return [];
  return declaration.members
    .map((member) => (member.name !== undefined ? member.name.getText() : ''))
    .filter((name) => name.length > 0);
}

/** The interface's leading doc block, without its comment punctuation. */
export function publishedDocBlock(file: string, interfaceName: string): string {
  const declaration = declarationOf(file, interfaceName);
  if (declaration === undefined) return '';
  const text = contractSource(file);
  const ranges = ts.getLeadingCommentRanges(text, declaration.pos) ?? [];
  return ranges
    .map((range) => text.slice(range.pos, range.end))
    .join('\n')
    .replace(/^\s*\/?\*+\/?/gm, '')
    .trim();
}

/** Whether the file declares an interface under that name at all. */
export function publishesInterface(file: string, interfaceName: string): boolean {
  return declarationOf(file, interfaceName) !== undefined;
}
