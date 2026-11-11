import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Feature 154 (T057) — every path in this module that creates an Organization
 * binds it to a sales channel in the same step, so "no Organization without a
 * channel" (FR-015, FR-019) holds for a creation path nobody has written yet.
 *
 * A source-level guard: each `<em>.create(Organization, …)` under
 * `src/backend` must be followed, in the same file, by a call to the kernel
 * membership writer (`replaceChannelsForEntity` or `bindToDefaultIfEmpty`), or
 * be named in {@link BOUND_ELSEWHERE} with the place that binds it. The ledger
 * is two-way: an entry whose file no longer creates an Organization is stale.
 *
 * The population is not written down as a count — a new creation path that
 * binds passes without touching this file — but the sites known when this
 * guard was written must be found, so a scan that matched nothing cannot pass.
 */

const BACKEND_DIR = dirname(fileURLToPath(import.meta.url));

/** Creation sites whose binding lives in another file, and where. */
const BOUND_ELSEWHERE: Readonly<Record<string, string>> = {
  'demo/seed.ts':
    'demo data only; `packages/demo-composition` binds the demo Organization to the default channel in its "demo buyer joins the demo organisation" step and withdraws the row on reset (T025)',
};

/**
 * Present when this guard was written: business registration (the
 * `organization.register` Command since `specs/176-command-hooks-outbox/`),
 * personal provisioning, demo seed.
 */
const KNOWN_SITES = [
  'commands/register-organization.command.ts',
  'services/personal-organization-service.ts',
  'demo/seed.ts',
] as const;

const CREATE = /\b\w+\.create\(\s*Organization\s*,/g;
const BIND = /\.(?:replaceChannelsForEntity|bindToDefaultIfEmpty)\(\s*['"]organization['"]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

interface CreationSite {
  file: string;
  /** Character offsets of each `create(Organization, …)`. */
  creates: number[];
  /** Character offsets of each organization bind. */
  binds: number[];
}

function creationSites(): CreationSite[] {
  return sourceFiles(BACKEND_DIR)
    .map((path) => {
      const text = readFileSync(path, 'utf8');
      return {
        file: relative(BACKEND_DIR, path).split('\\').join('/'),
        creates: [...text.matchAll(CREATE)].map((m) => m.index),
        binds: [...text.matchAll(BIND)].map((m) => m.index),
      };
    })
    .filter((site) => site.creates.length > 0);
}

describe('organizations — every Organization creation binds a sales channel (T057)', () => {
  const sites = creationSites();
  console.info(`[organization-creation-binds-channel] read: sites=${sites.length}`);

  it('finds the creation sites known when the guard was written', () => {
    expect(sites.map((s) => s.file)).toEqual(expect.arrayContaining([...KNOWN_SITES]));
  });

  it('binds each created Organization after creating it, or names where it is bound', () => {
    const unbound = sites
      .filter((site) => !(site.file in BOUND_ELSEWHERE))
      .flatMap((site) =>
        site.creates
          .filter((at) => !site.binds.some((bind) => bind > at))
          .map((at) => `${site.file}@${at}`),
      );
    expect(unbound, 'Organization created with no sales-channel bind after it').toEqual([]);
  });

  it('keeps the ledger of sites bound elsewhere current', () => {
    const creating = new Set(sites.map((s) => s.file));
    const stale = Object.keys(BOUND_ELSEWHERE).filter((file) => !creating.has(file));
    expect(stale, 'ledger entries that no longer create an Organization').toEqual([]);
  });
});
