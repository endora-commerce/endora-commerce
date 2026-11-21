/**
 * Admin previews of rendered e-mail HTML are drawn in sandboxed frames.
 *
 * A preview shows markup authored by somebody else — a template, a block, a campaign — to an
 * administrator whose session it shares an origin with. Every `<iframe srcDoc=…>` in the admin
 * sources therefore carries a `sandbox` attribute that withholds `allow-scripts`, and the e-mail
 * editor's inline embed preview no longer injects that markup into the editor's own document.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['packages', 'admin/src'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(path);
  }
  return out;
}

/** Every `<iframe … >` JSX opening element whose attributes include `srcDoc`. */
function srcDocFrames(source: string): string[] {
  const frames: string[] = [];
  for (const match of source.matchAll(/<iframe\b[\s\S]*?\/?>/g)) {
    if (/\bsrcDoc\s*=/.test(match[0])) frames.push(match[0]);
  }
  return frames;
}

describe('admin HTML preview frames', () => {
  const files = ROOTS.flatMap((root) => tsxFiles(join(REPO_ROOT, root)));

  it('finds the preview frames it is meant to hold', () => {
    const withFrames = files.filter((file) => srcDocFrames(readFileSync(file, 'utf8')).length > 0);
    const names = withFrames.map((file) => relative(REPO_ROOT, file));
    expect(names).toEqual(
      expect.arrayContaining([
        // The campaign editor's own preview card is gone (issue #1533): the builder's
        // preview dialog, here, is the one preview a campaign has.
        'packages/page-builder-admin/src/email/EmailEditorPane.tsx',
      ]),
    );
  });

  it('sandboxes every srcDoc frame without allowing scripts', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const frame of srcDocFrames(readFileSync(file, 'utf8'))) {
        const sandbox = /\bsandbox\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"]([^'"]*)['"]\s*\})/.exec(frame);
        const value = sandbox ? (sandbox[1] ?? sandbox[2] ?? sandbox[3] ?? '') : null;
        if (value === null || /\ballow-scripts\b/.test(value)) {
          offenders.push(`${relative(REPO_ROOT, file)}: ${frame.replace(/\s+/g, ' ').slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the e-mail editor does not inject rendered e-mail HTML into its own document', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'packages/page-builder-admin/src/email/EmailEditorPane.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
