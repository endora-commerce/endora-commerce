import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One `RequireAdminFactory` declaration, and one implementation (T145).
 *
 * The repository used to carry **17 byte-identical declarations** of this type,
 * one per module that happened to need an admin guard, and 53 files imported
 * `catalog`'s copy — infrastructure depending on a domain module because that
 * is where someone wrote the type first. T010 collapsed them into
 * `src/kernel/ports/require-admin.ts`.
 *
 * A collapse like that does not stay collapsed on its own: the type is four
 * lines, so the cheapest thing a contributor can do when they need it is
 * declare it again locally. This test is what makes re-declaring it cost more
 * than importing it.
 *
 * It reads the source rather than the type system on purpose. TypeScript is
 * structural, so seventeen identical declarations typecheck perfectly — which
 * is exactly why the duplication survived as long as it did. The property is
 * about the *source*, so the assertion has to be too.
 */

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const KERNEL_PORT = 'kernel/ports/require-admin.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Files declaring the name, as opposed to importing or **re-exporting** it.
 *
 * The trailing `=` or `{` is what separates the two: `kernel/index.ts` carries
 * `type RequireAdminFactory,` inside an export block, which is the barrel doing
 * its job rather than a second declaration.
 */
function declarationsOf(name: string): string[] {
  const pattern = new RegExp(
    `^\\s*(export\\s+)?(type\\s+${name}\\s*(<[^=]*>)?\\s*=|interface\\s+${name}\\b[^;]*\\{)`,
    'm',
  );
  return walk(SRC)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(SRC.length))
    .sort();
}

describe('T145 — the admin guard has one declaration', () => {
  it('declares RequireAdminFactory in the kernel port and nowhere else', () => {
    expect(declarationsOf('RequireAdminFactory')).toEqual([KERNEL_PORT]);
  });

  it('declares RequireAdminAnyFactory beside it, also once', () => {
    // The any-of variant lives in the same file precisely so it cannot drift
    // away from its twin the way the original did.
    expect(declarationsOf('RequireAdminAnyFactory')).toEqual([KERNEL_PORT]);
  });

  it('keeps the implementation in `auth`, which is not where the type lives', () => {
    // The split is deliberate and worth pinning: the kernel owns the shape
    // because every route surface needs it, and `auth` owns the behaviour
    // because promoting an admin actor needs that module's per-request
    // decorations and a permission check needs `admin_roles` — which `auth`
    // declares as a dependency and the kernel could not.
    const implementations = walk(SRC)
      .filter((file) => /export function createRequireAdmin\b/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length));

    expect(implementations).toEqual(['modules/auth/require-admin.ts']);
  });
});
