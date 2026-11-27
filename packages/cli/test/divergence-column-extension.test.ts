/**
 * `specs/190-overlay-full-modules/` T093 (FR-047, `contracts/overlay-lifecycle.md` §3) — what an
 * overlay module does to another module's table is a divergence; what it owns is not.
 *
 *  - `column-extension` is a kind of its own: one entry per `defineColumnExtension(…)` declaration
 *    in an overlay module, keyed `column-extension:<module>:<host>`, its subject the host table,
 *    owned by the host's module and costed on the data ladder's rung D2.
 *  - An overlay's own entities and migrations are its own surface, so they are named under
 *    `notRecorded` rather than recorded — a reader can tell "not a divergence" from "not looked at".
 *
 * Pure over `deriveDivergence`, so the fixture overlay source enters at the top of the analysis.
 */
import { describe, expect, it } from 'vitest';

import { deriveDivergence, type DivergenceInput } from '../src/lib/divergence.js';
import { renderDivergenceMarkdown } from '../src/lib/divergence-artefacts.js';

const BACKEND = `
import { defineColumnExtension } from '@endora-commerce/platform/kernel';
import { ErpLink } from './entities/erp-link.entity.js';

const host = 'organizations' as const;

export const entities = [ErpLink];

export const schemaExtensions = [
  defineColumnExtension({
    host: 'organizations',
    module: 'acme_erp',
    columns: {
      erpCode: { type: 'varchar', length: 32, nullable: true },
      syncedAt: { type: 'timestamptz', nullable: true },
    },
  }),
  defineColumnExtension({ host, module: 'acme_erp', columns: { other: { type: 'text' } } }),
  defineColumnExtension({ host: 'not_a_host', module: 'acme_erp', columns: { x: { type: 'text' } } }),
];

export function registerModule(): void {}
`;

const KEY = 'column-extension:acme_erp:organizations';

function input(reasons: Record<string, string> = {}, text: string = BACKEND): DivergenceInput {
  return {
    deployment: 'acme',
    overlayRoot: 'backend/src/apps/acme/modules',
    overlayModules: ['acme_erp'],
    sources: [
      { moduleId: 'acme_erp', file: 'backend/src/apps/acme/modules/acme_erp/backend.ts', text },
    ],
    routes: new Map(),
    owners: new Map(),
    rootSupplied: new Set(),
    declaration: { omittedModules: [], decorationOrder: {}, reasons },
    seams: [],
  };
}

describe('the `column-extension` divergence kind (190 T093)', () => {
  it('records a declaration as column-extension:<module>:<host>, owned by the host’s module', () => {
    const { report } = deriveDivergence(input());
    const columns = report.entries.filter((entry) => entry.kind === 'column-extension');
    expect(columns.map((entry) => entry.key)).toEqual([KEY]);
    expect(columns[0]).toMatchObject({
      module: 'acme_erp',
      subject: 'organizations',
      owner: 'organizations',
      // The escalation ladder ranks ways of changing what core *does*; a column is data, and its
      // rung is the data ladder's, which the detail carries.
      rung: null,
      detail: {
        kind: 'column-extension',
        dataRung: 'D2',
        columns: ['x_acme_erp_erp_code', 'x_acme_erp_synced_at'],
      },
    });
    expect(report.boundary.recorded).toContain('column-extension');
  });

  it('reports a host it cannot read as a literal as computed-subject, and an unknown host as unowned-subject', () => {
    const { findings } = deriveDivergence(input());
    expect(findings.filter((finding) => finding.kind === 'computed-subject').map((f) => f.detail)).toEqual([
      expect.stringContaining('defineColumnExtension'),
    ]);
    expect(findings.filter((finding) => finding.kind === 'unowned-subject').map((f) => f.detail)).toEqual([
      expect.stringContaining('not_a_host'),
    ]);
  });

  it('asks the deployment for a sentence, and a reason keyed by the declaration clears it', () => {
    const undeclared = (reasons: Record<string, string>): string[] =>
      deriveDivergence(input(reasons))
        .findings.filter((finding) => finding.kind === 'undeclared-divergence')
        .map((finding) => finding.detail);
    expect(undeclared({}).some((detail) => detail.includes(KEY))).toBe(true);
    expect(
      undeclared({ [KEY]: 'The ERP code this client keys every organization by, read on each sync.' }).some(
        (detail) => detail.includes(KEY),
      ),
    ).toBe(false);
  });

  it('records nothing for the overlay’s own entities, and names them under notRecorded', () => {
    const { report } = deriveDivergence(input());
    expect(report.entries.some((entry) => entry.subject === 'ErpLink')).toBe(false);
    expect(report.boundary.notRecorded.map((entry) => entry.seam)).toContain(
      "an overlay module's own entities and migrations",
    );
  });

  it('renders the kind under its own heading with the data-ladder cost', () => {
    const { report } = deriveDivergence(
      input({ [KEY]: 'The ERP code this client keys every organization by, read on each sync.' }),
    );
    const markdown = renderDivergenceMarkdown(report);
    expect(markdown).toContain("### Columns this deployment adds to another module's table");
    expect(markdown).toContain('data ladder D2');
    expect(markdown).toContain('`organizations` (`x_acme_erp_erp_code`, `x_acme_erp_synced_at`)');
  });

  // #1941 case 1: the walk keyed on the callee's spelling, so a renamed import was not a
  // declaration at all — no entry, no finding, a column the report never names.
  it('follows an aliased import of defineColumnExtension', () => {
    const aliased = `
import { defineColumnExtension as extendColumns } from '@endora-commerce/platform/kernel';

export const schemaExtensions = [
  extendColumns({ host: 'organizations', module: 'acme_erp', columns: { erpCode: { type: 'text' } } }),
];
`;
    const { report, findings } = deriveDivergence(input({}, aliased));
    expect(report.entries.filter((entry) => entry.kind === 'column-extension')).toEqual([
      expect.objectContaining({ key: KEY, detail: expect.objectContaining({ columns: ['x_acme_erp_erp_code'] }) }),
    ]);
    expect(findings.filter((finding) => finding.kind === 'computed-subject')).toEqual([]);
  });

  // #1941 case 1: a spread (or any non-literal) `columns` value used to be read as "no columns",
  // recording an entry that lists none of the columns the declaration adds.
  it.each([
    ['a spread inside columns', `columns: { ...shared, erpCode: { type: 'text' } }`],
    ['a columns value that is not an object literal', 'columns: shared'],
    ['a spread beside columns', `...defaults, columns: { erpCode: { type: 'text' } }`],
  ])('reports %s as computed-subject rather than recording a partial column list', (_, columns) => {
    const spread = `
import { defineColumnExtension } from '@endora-commerce/platform/kernel';
const shared = { syncedAt: { type: 'timestamptz' } } as const;
const defaults = {};
export const schemaExtensions = [
  defineColumnExtension({ host: 'organizations', module: 'acme_erp', ${columns} }),
];
`;
    const { report, findings } = deriveDivergence(input({}, spread));
    expect(report.entries.filter((entry) => entry.kind === 'column-extension')).toEqual([]);
    expect(findings.filter((finding) => finding.kind === 'computed-subject').map((f) => f.detail)).toEqual([
      expect.stringContaining('columns'),
    ]);
  });
});
