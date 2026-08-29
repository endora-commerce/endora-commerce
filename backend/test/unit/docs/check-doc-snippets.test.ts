import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkDocument,
  discoverCitingDocuments,
  DOCUMENT_ROOTS,
  markdownDocuments,
  REPO_ROOT,
  vacuousDocumentPopulation,
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

/**
 * The floor under the walk (feature 080, T010).
 *
 * This check's population is the documents, not the module tree, so re-rooting
 * it onto the resolved module list would have been wrong — a cited file that
 * moved is a finding here, not a silent green. The shortfall it *can* suffer is
 * one of its own roots going missing while the other carries the walk, which is
 * issue #215's shape one level over: measured when this landed, `docs/docs`
 * held 92 of the 943 markdown files and one of the seven citing documents, so
 * losing it left a run that reported six documents checked and exited 0.
 *
 * Every case below enters as a **tree on disk**, walked by the real walker: the
 * question is which root a file came from, and only the walk can answer that.
 */
describe('the document-root floor', () => {
  function tree(build: (root: string) => void): string[] {
    const root = mkdtempSync(join(tmpdir(), 'endora-doc-roots-'));
    try {
      build(root);
      return markdownDocuments(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const page = (root: string, relative: string): void => {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# Page\n', 'utf8');
  };

  it('refuses a walk that read one root and not the other', () => {
    const walked = tree((root) => {
      page(root, join('specs', '080-f4-real-scope', 'tasks.md'));
    });
    // The discrimination: the walk is not empty, so the old guard —
    // `documents.length === 0` — is green on exactly this tree.
    expect(walked.length).toBeGreaterThan(0);
    const reason = vacuousDocumentPopulation(walked);
    expect(reason).not.toBeNull();
    expect(reason).toContain('docs/docs');
    expect(reason).not.toContain('specs,');
  });

  it('refuses the other direction too, and names the root that went missing', () => {
    const walked = tree((root) => {
      page(root, join('docs', 'docs', 'architecture', 'kernel.md'));
    });
    const reason = vacuousDocumentPopulation(walked);
    expect(reason).toContain('specs');
    expect(reason).not.toContain('docs/docs');
  });

  it('says nothing about a tree where every declared root contributed', () => {
    const walked = tree((root) => {
      page(root, join('specs', '080-f4-real-scope', 'tasks.md'));
      page(root, join('docs', 'docs', 'architecture', 'kernel.md'));
    });
    expect(vacuousDocumentPopulation(walked)).toBeNull();
  });

  it('reads the real tree, so the floor is not vacuous on it either', () => {
    expect(vacuousDocumentPopulation(markdownDocuments())).toBeNull();
    expect(DOCUMENT_ROOTS.length).toBeGreaterThan(1);
  });
});
