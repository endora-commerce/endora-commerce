import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The wiring files earlier releases' `endora new instance` rendered, as
 * `endora upgrade` records them (`packages/cli/src/upgrade/wiring-renderings.ts`).
 *
 * That module is not on the CLI's `exports`, so it is read as text: each file is
 * a JSON string literal keyed by its path, under its release. `{{scope}}` is
 * replaced by the platform's scope, so a rendering reads as the instance's file
 * does and an import parser written for first-party sources reads it too.
 *
 * These renderings are consumers outside this repository: an instance upgraded
 * from that release runs its first `setup` on them. While an entry is recorded,
 * the names its files import are surface a release keeps
 * (`test/unit/cli/previous-wiring-imports.test.ts`).
 */
const RENDERINGS = fileURLToPath(new URL('../../../packages/cli/src/upgrade/wiring-renderings.ts', import.meta.url));

export interface PreviousRendering {
  readonly release: string;
  readonly path: string;
  /** The file as an instance holds it, `{{scope}}` resolved; `{{name}}` is left in place. */
  readonly content: string;
}

export function previousWiringRenderings(): PreviousRendering[] {
  const source = readFileSync(RENDERINGS, 'utf8');
  const renderings: PreviousRendering[] = [];
  const releases = [...source.matchAll(/release:\s*'([^']+)'/g)];
  releases.forEach((match, at) => {
    const end = releases[at + 1]?.index ?? source.length;
    const block = source.slice(match.index, end);
    for (const file of block.matchAll(/^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gm)) {
      const content = (JSON.parse(file[2]!) as string).replaceAll('{{scope}}', '@endora-commerce/');
      renderings.push({ release: match[1]!, path: file[1]!, content });
    }
  });
  return renderings;
}

/**
 * The backend member's renderings only: what that first `setup` runs (`migrate`,
 * then the entry points). The admin wiring imports `admin-shell`, a React package
 * node does not load, and it is built afterwards, from the new rendering.
 */
export function previousBackendWiring(): PreviousRendering[] {
  return previousWiringRenderings().filter((rendering) => rendering.path.startsWith('backend/'));
}
