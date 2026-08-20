import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkDocument,
  discoverCitingDocuments,
  DOCUMENT_ROOTS,
  REPO_ROOT,
} from '../../../scripts/check-doc-snippets.js';

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
  it('every citing document quotes its sources correctly', () => {
    const read = (p: string): string => readFileSync(p, 'utf8');
    const findings = discoverCitingDocuments().flatMap((d) => checkDocument(d, read));
    expect(findings, findings.map((f) => `${f.doc}:${f.docLine} → ${f.message}`).join('\n')).toEqual(
      [],
    );
  });
});

/**
 * Which documents participate (issue #113).
 *
 * Membership used to be a two-entry opt-in list, and the check reported
 * "2 document(s) checked" over one document that carried a marker: the other
 * had none, so it contributed no quotation to verify, and the assertion that it
 * was *on the list* is exactly the vacuous shape — it proved the list's
 * contents, not that anything was read. A marker now enrols a file.
 */
describe('discoverCitingDocuments', () => {
  it('finds every document that carries a marker, and only those', () => {
    const documents = discoverCitingDocuments();
    expect(documents.length).toBeGreaterThan(0);
    for (const doc of documents) {
      expect(readFileSync(join(REPO_ROOT, doc), 'utf8'), doc).toContain('verbatim-from:');
    }
    expect(documents).toContain('specs/072-module-kernel-di/quickstart.md');
  });

  it('walks the documented roots', () => {
    expect(DOCUMENT_ROOTS).toContain('specs');
    expect(DOCUMENT_ROOTS).toContain('docs/docs');
  });

  it('enrols a file the moment it writes a marker, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'endora-doc-snippets-'));
    try {
      mkdirSync(join(root, 'specs', 'nested'), { recursive: true });
      mkdirSync(join(root, 'docs', 'docs'), { recursive: true });
      writeFileSync(join(root, 'specs', 'cites.md'), '<!-- verbatim-from: backend/src/x.ts -->\n');
      writeFileSync(join(root, 'specs', 'nested', 'deep.md'), '<!-- verbatim-from: a.ts -->\n');
      writeFileSync(join(root, 'specs', 'prose.md'), 'mentions verbatim-from as prose\n');
      writeFileSync(join(root, 'docs', 'docs', 'page.md'), '# Page\n');
      writeFileSync(join(root, 'specs', 'notes.txt'), '<!-- verbatim-from: a.ts -->\n');

      expect(discoverCitingDocuments(root)).toEqual([
        join('specs', 'cites.md'),
        join('specs', 'nested', 'deep.md'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
