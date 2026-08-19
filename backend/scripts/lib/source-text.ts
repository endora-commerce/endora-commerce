import ts from 'typescript';

/**
 * The tree's one comment stripper (issue #241).
 *
 * ## Why this is not two regexes
 *
 * "Remove the comments before matching" was written three times in this
 * repository, independently, and each copy was a pair of regexes — one for
 * `/* … *\/`, one for `//` — whose **order** decided whether it was correct.
 * There is no correct order. Run the block pass first and a `//` line ending in
 * a route glob opens a block comment: `harness-parity.test.ts` did exactly that
 * over `test/helpers/test-server.ts`, whose line 1544 ends
 * `… under /api/v1/admin/assets/` plus a star, and the pass ran on to the next
 * real terminator — **1135 of 2767 lines, 41% of the file**. Every
 * `expect(harnessCode).not.toContain(…)` inside that window was green because
 * the text was gone, `runBootHooks(`, `errorEnvelope` and
 * `resolvePreferredLanguage` among them. Run the line pass first and the
 * symmetric hole opens: a `//` inside a block comment truncates it. And in
 * either order a string literal holding a comment token — `'/*'` in
 * `assets_library`'s wildcard-MIME test, `'image/*, *\/*;q=0.5'` in
 * `pim_ergonode`'s Accept header — opens or closes a comment that is not there.
 *
 * So this asks the parser instead. `ts` is already a backend dependency and
 * already the input to nineteen checks; a scanner that knows what a string
 * literal is has no order to get wrong.
 *
 * ## Blanked, not deleted
 *
 * Every comment character becomes a space and every newline survives, so a line
 * number in the result is a line number in the source. A stripper that deletes
 * shifts every finding below the first comment onto a line the reader cannot
 * open, and the three copies this replaces all did.
 */
export function codeOnly(source: string, fileName = 'source.ts'): string {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );

  const characters = [...source];
  for (const range of commentRanges(sourceFile, source)) {
    for (let index = range.pos; index < range.end; index += 1) {
      if (characters[index] !== '\n') characters[index] = ' ';
    }
  }
  return characters.join('');
}

/**
 * Every comment span the parser saw, sorted.
 *
 * Trivia hangs off token positions rather than off nodes of its own, so the
 * walk asks at both ends of every node: a comment is leading trivia for the
 * token after it and trailing trivia for the token before it, and the file's
 * last comment is leading trivia of the end-of-file token. Ranges repeat under
 * that walk, which is what the `seen` set is for.
 */
function commentRanges(sourceFile: ts.SourceFile, source: string): ts.CommentRange[] {
  const found: ts.CommentRange[] = [];
  const seen = new Set<string>();

  const collect = (position: number): void => {
    const ranges = [
      ...(ts.getLeadingCommentRanges(source, position) ?? []),
      ...(ts.getTrailingCommentRanges(source, position) ?? []),
    ];
    for (const range of ranges) {
      const key = `${range.pos}:${range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(range);
    }
  };

  const visit = (node: ts.Node): void => {
    collect(node.getFullStart());
    collect(node.getEnd());
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);

  return found.sort((a, b) => a.pos - b.pos);
}
