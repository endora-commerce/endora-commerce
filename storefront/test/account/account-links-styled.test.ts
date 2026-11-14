import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1214 — the storefront's base reset gives every `<a>` the inherited
 * colour and no underline, so a link with no class of its own reads as plain
 * text (issue #1178 fixed the account tables; this holds the rest). Every link
 * in the account area therefore names a class: the shared `.b2b-account__link`
 * (with its `--standalone` / `--stacked` modifiers), a button class, or a
 * deliberate style of its own. The sidebar is exempt — `.b2b-account__nav a`
 * styles its links from the container.
 *
 * Read as source because these are many pages with many API reads each; the
 * look itself is asserted on rendered markup in the pages' own tests.
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

const SCOPES = ['app/(account)', 'components/account', 'components/orders'];
const EXEMPT = new Set(['app/(account)/layout.tsx']);

function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Each link's opening tag: JSX attributes here hold no `>` outside a `{…}` arrow. */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  const start = /<(LocalizedLink|LocalizedAnchor|Link|a)(?=[\s>])/g;
  for (let m = start.exec(source); m; m = start.exec(source)) {
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

describe('every account-area link carries a visible style (issue #1214)', () => {
  it('names a class on each link outside the sidebar', () => {
    const offenders: string[] = [];
    const files = SCOPES.flatMap(sources).filter((f) => !EXEMPT.has(f));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      for (const tag of openingTags(source)) {
        if (!/\sclassName=/.test(tag)) offenders.push(`${relative(root, join(root, file))}: ${tag.replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
