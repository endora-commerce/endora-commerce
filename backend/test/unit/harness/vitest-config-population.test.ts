/**
 * Every backend vitest config is one a command actually selects.
 *
 * `vitest.pure.config.ts` sat beside the other three for months, headed "no
 * Postgres/Redis" and "for offline unit tests". No script and no workflow named
 * it, its `include` was a copy of `vitest.unit.config.ts`'s, and it never set
 * `BACKEND_TEST_SERVICES` — so a run through it was an *undeclared* run, which
 * `test/declared-services.ts` reads as the complete one with every service
 * present. The header promised the opposite of what the file did, and nothing
 * compared the two because nothing ran it.
 *
 * The condition that let it drift is being unreferenced, so that is what is
 * held here: a config is either the one `vitest run` picks up by default or the
 * target of a `--config` in one of `backend/package.json`'s scripts. A config
 * somebody adds for a one-off run and leaves behind fails this file instead of
 * waiting for a reader to believe its header.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');

/** The config `vitest run` loads when no `--config` is given. */
const DEFAULT_CONFIG = 'vitest.config.ts';

/** Every vitest config file in the backend's own directory. */
function configFiles(): readonly string[] {
  return readdirSync(BACKEND_ROOT)
    .filter((entry) => /^vitest(?:\.[\w-]+)*\.config\.[cm]?ts$/.test(entry))
    .sort();
}

/** Every config a `backend/package.json` script selects with `--config`. */
function configsNamedByScripts(): ReadonlySet<string> {
  const manifest = JSON.parse(readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Readonly<Record<string, string>>;
  };
  const named = new Set<string>();
  for (const script of Object.values(manifest.scripts ?? {})) {
    for (const match of script.matchAll(/--config[= ](\S+)/g)) named.add(match[1]!);
  }
  return named;
}

describe('the backend’s vitest configs', () => {
  it('finds the configs and the scripts to judge at all', () => {
    expect(configFiles(), 'the default config is not where this file looks').toContain(
      DEFAULT_CONFIG,
    );
    expect(
      configsNamedByScripts().size,
      'no script names a config, so the case below would call every non-default config an orphan',
    ).toBeGreaterThan(0);
  });

  it('holds no config that no script selects', () => {
    const named = configsNamedByScripts();
    const orphans = configFiles().filter((file) => file !== DEFAULT_CONFIG && !named.has(file));

    expect(
      orphans,
      'a vitest config no `backend/package.json` script selects is run by nothing, so nothing ' +
        'compares what its header promises with what it does. Give it a script or delete it.',
    ).toEqual([]);
  });

  it('names no config in a script that is not there', () => {
    const present = new Set(configFiles());
    const missing = [...configsNamedByScripts()].filter((file) => !present.has(file));

    expect(missing, 'a script selects a vitest config that does not exist').toEqual([]);
  });
});
