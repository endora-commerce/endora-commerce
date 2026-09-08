/**
 * The scaffold's migration identity is this repository's, in both directions.
 *
 * `endora new module --entities` emits a migration, and
 * `specs/089-endora-cli-module-scaffold/contracts/module-scaffold-output.md` §6
 * is explicit that the stamp is **not** computed by that command: it is the rule
 * `pnpm --filter backend run migration:new` applies, and two authors for a
 * migration identity is exactly the family this feature exists to remove.
 *
 * The CLI cannot import that rule. It is a package and `backend/scripts/` is an
 * application, so the derivation is written twice — once in each — and this file
 * is what makes the second copy safe: it holds the two to each other over the
 * shapes a scaffolded module actually produces, and it holds the CLI's copy of
 * `BASELINE_THROUGH` to the watermark the ordering algorithm owns. A stamp that
 * drifted below it would be ordered by history rather than by its module's
 * manifest `dependencies`, which is an order a fresh database cannot apply.
 *
 * It runs here rather than in the CLI's own suite for the reason the derivation
 * is duplicated at all: an application may depend on a tool, and a tool may not
 * depend on an application.
 */
import { describe, expect, it } from 'vitest';

import {
  BASELINE_THROUGH as CLI_BASELINE_THROUGH,
  buildScaffoldSpec,
  formatStamp as cliFormatStamp,
  migrationClassOf,
  migrationFileOf,
  migrationStampFor,
  segmentOf,
} from '@endora-commerce/cli';

import { BASELINE_THROUGH } from '@endora-commerce/platform/db';
import {
  classNameFromFile,
  formatStamp,
  MIGRATION_FILE_RE,
  segmentFor,
} from '../../../scripts/new-migration.js';

/**
 * The module ids a scaffolded migration has to be named correctly for.
 *
 * `_lifecycle` is here because the underscore is exactly what the segment rule
 * is about, and the activation form goes with it: an `_`-prefixed id is
 * platform-internal and the manifest contract refuses every activation form for
 * one except `nonDeactivatable`.
 */
const IDS = ['demo_widgets', 'orders', 'quote_requests', '_lifecycle'] as const;

function specFor(id: string) {
  return buildScaffoldSpec({
    id,
    name: 'X',
    description: 'Y',
    entities: true,
    now: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
    ...(id.startsWith('_') ? { nonDeactivatable: 'platform-internal' } : {}),
  });
}

describe('the scaffold and migration:new agree about a migration identity', () => {
  it('formats the same UTC stamp', () => {
    const moments = [
      new Date(Date.UTC(2026, 8, 1, 12, 0, 0)),
      new Date(Date.UTC(2026, 11, 31, 23, 59, 59)),
      new Date(Date.UTC(2027, 0, 1, 0, 0, 0)),
    ];

    for (const moment of moments) {
      expect(cliFormatStamp(moment)).toBe(formatStamp(moment));
    }
  });

  it('normalises a module id to the same migration segment', () => {
    for (const id of IDS) {
      expect(segmentOf(id)).toBe(segmentFor(id));
    }
  });

  it('emits a file name the only sanctioned recognizer accepts', () => {
    for (const id of IDS) {
      const spec = specFor(id);

      expect(MIGRATION_FILE_RE.test(migrationFileOf(spec)), migrationFileOf(spec)).toBe(true);
    }
  });

  it('derives the class name exactly as the filename rule does', () => {
    for (const id of IDS) {
      const spec = specFor(id);

      expect(migrationClassOf(spec)).toBe(classNameFromFile(migrationFileOf(spec)));
      // And it is scoped by the owning module's segment, which is what keeps it
      // unique across every module the platform can compose (`unscoped-name`).
      const segment = segmentFor(id);
      const pascalSegment = segment
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      expect(migrationClassOf(spec)).toContain(pascalSegment);
    }
  });
});

describe('the frozen historical prefix', () => {
  it('is the same watermark on both sides', () => {
    expect(CLI_BASELINE_THROUGH).toBe(BASELINE_THROUGH);
  });

  it('clamps a stamp that would land inside the frozen block', () => {
    expect(migrationStampFor(new Date(Date.UTC(2020, 0, 1))) > BASELINE_THROUGH).toBe(true);
  });
});
