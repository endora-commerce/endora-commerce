import { describe, expect, it } from 'vitest';

import { previousBackendWiring } from '../../helpers/previous-wiring.js';

/**
 * An instance upgraded from an earlier release starts its first `setup` on the
 * wiring that release rendered: `endora upgrade` is run by the earlier CLI,
 * which moves the packages and runs `setup` before the new CLI can rewrite a
 * wiring file (`.changeset/1848-overlay-build.md`, "two runs"). So every value
 * an earlier rendering imports from a release package has to still be exported
 * by this one, or that first `setup` stops on an import, as 0.112.0's
 * `backend/src/migrate.ts` did on `refuseOverlaySchema` before it was kept as a
 * deprecated no-op.
 */

/** `{ a, b as c }` value names imported from `@endora-commerce/<specifier>`; type-only imports are skipped. */
function releaseImports(content: string): { specifier: string; name: string }[] {
  const out: { specifier: string; name: string }[] = [];
  for (const match of content.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@endora-commerce\/([^']+)'/g)) {
    if (match[1] !== undefined) continue;
    for (const raw of match[2]!.split(',')) {
      const name = raw.trim();
      if (name === '' || name.startsWith('type ')) continue;
      out.push({ specifier: match[3]!, name: name.split(/\s+as\s+/)[0]!.trim() });
    }
  }
  return out;
}

describe('earlier releases’ backend wiring still loads against this release', () => {
  const renderings = previousBackendWiring();

  it('reads the recorded renderings', () => {
    expect(renderings.some((rendering) => rendering.path === 'backend/src/migrate.ts')).toBe(true);
    expect(renderings.flatMap((rendering) => releaseImports(rendering.content)).length).toBeGreaterThan(0);
  });

  it('exports every value an earlier rendering imports from a release package', async () => {
    const missing: string[] = [];
    for (const rendering of renderings) {
      for (const { specifier, name } of releaseImports(rendering.content)) {
        const module = (await import(`@endora-commerce/${specifier}`)) as Record<string, unknown>;
        if (!(name in module)) missing.push(`${rendering.release} ${rendering.path}: ${name} from ${specifier}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
