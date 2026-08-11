import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkDocument, CHECKED_DOCUMENTS, REPO_ROOT } from '../../../scripts/check-doc-snippets.js';

/**
 * The checker has to be able to go red, or it is decoration.
 *
 * These cases feed it synthetic documents through an injected reader rather
 * than writing fixtures to disk, so a failure names a signature rather than a
 * temp path.
 */
describe('check-doc-snippets', () => {
  const SOURCE = 'backend/src/example.ts';
  const sourceText = [
    'export function greet(name: string): string {',
    '  return `hello ${name}`;',
    '}',
    '',
    'export const answer = 42;',
  ].join('\n');

  function reader(docText: string): (p: string) => string {
    return (p: string) => {
      if (p.endsWith('gone.ts')) throw new Error('ENOENT');
      return p.endsWith('example.ts') ? sourceText : docText;
    };
  }

  function doc(body: string): string {
    return ['# Doc', '', `<!-- verbatim-from: ${SOURCE} -->`, '```ts', body, '```', ''].join('\n');
  }

  it('passes when the block is a verbatim contiguous quotation', () => {
    const findings = checkDocument('d.md', reader(doc('export const answer = 42;')));
    expect(findings).toEqual([]);
  });

  it('passes when the block is uniformly indented for reading', () => {
    const body = ['  export function greet(name: string): string {', '    return `hello ${name}`;', '  }'].join('\n');
    expect(checkDocument('d.md', reader(doc(body)))).toEqual([]);
  });

  it('fails when a signature drifted, and names the offending line', () => {
    const findings = checkDocument('d.md', reader(doc('export function greet(name: string, extra: number): string {')));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('nowhere in the source');
    expect(findings[0]!.message).toContain('extra: number');
  });

  it('fails when every line exists but the order does not', () => {
    const body = ['export const answer = 42;', '}'].join('\n');
    const findings = checkDocument('d.md', reader(doc(body)));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('contiguous run');
  });

  it('fails when the cited file was moved or renamed', () => {
    const text = ['<!-- verbatim-from: backend/src/gone.ts -->', '```ts', 'x', '```'].join('\n');
    const findings = checkDocument('d.md', reader(text));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('does not exist');
  });

  it('fails when a marker is not followed by a fence', () => {
    const text = [`<!-- verbatim-from: ${SOURCE} -->`, 'prose, not code'].join('\n');
    const findings = checkDocument('d.md', reader(text));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('not followed by a fenced code block');
  });

  it('ignores fenced blocks that carry no marker', () => {
    const text = ['```ts', 'anything at all', '```'].join('\n');
    expect(checkDocument('d.md', reader(text))).toEqual([]);
  });

  /**
   * The real thing. If this fails, a quickstart is lying to the 65 module
   * conversions that copy it — fix the document, not this test.
   */
  it('every checked document quotes its sources correctly', () => {
    const read = (p: string): string => readFileSync(p, 'utf8');
    const findings = CHECKED_DOCUMENTS.flatMap((d) => checkDocument(d, read));
    expect(findings, findings.map((f) => `${f.doc}:${f.docLine} → ${f.message}`).join('\n')).toEqual(
      [],
    );
  });

  it('checks at least the two quickstarts that the sweeps copy', () => {
    expect(CHECKED_DOCUMENTS).toContain('specs/072-module-kernel-di/quickstart.md');
    expect(CHECKED_DOCUMENTS).toContain('specs/073-lifecycle-gating-completion/quickstart.md');
    expect(readFileSync(join(REPO_ROOT, CHECKED_DOCUMENTS[0]!), 'utf8')).toContain('verbatim-from:');
  });
});
