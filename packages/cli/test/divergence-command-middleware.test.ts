/**
 * `specs/189-command-middleware/` T043 (FR-031, FR-034) — an overlay module's
 * command middleware is a divergence of its own kind, `command-middleware`,
 * keyed `command-middleware:<module>:<id>`, derived from the overlay's
 * **manifest** declaration (research R-12: the report reads the declaration
 * without running code). Owner `null` — the subject is the bus — and rung 2.
 *
 * Pure over `deriveDivergence`, so the fixture sources enter at the top of the
 * analysis.
 */
import { describe, expect, it } from 'vitest';

import { deriveDivergence, SEAM_CLASSIFICATION, type DivergenceInput } from '../src/lib/divergence.js';
import { readDivergenceDeclaration, renderDivergenceMarkdown } from '../src/lib/divergence-artefacts.js';

const MANIFEST = (id: string, middleware: string, dependencies = '[]'): string => `
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: '${id}',
  name: '${id}',
  version: '1.0.0',
  dependencies: ${dependencies},
  commandMiddleware: ${middleware},
});
`;

const BACKEND = `
import type { ModuleContext } from '@endora-commerce/platform/kernel';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandMiddleware([
    { id: 'legal-hold', phase: 'admit', admit: () => undefined },
    { id: 'timing', phase: 'observe', observe: () => undefined },
  ]);
}
`;

function input(
  modules: Record<string, { manifest: string; backend?: string }>,
  declaration: Partial<DivergenceInput['declaration']> = {},
): DivergenceInput {
  const sources = Object.entries(modules).flatMap(([moduleId, files]) => [
    { moduleId, file: `backend/src/apps/acme/modules/${moduleId}/manifest.ts`, text: files.manifest },
    ...(files.backend === undefined
      ? []
      : [{ moduleId, file: `backend/src/apps/acme/modules/${moduleId}/backend.ts`, text: files.backend }]),
  ]);
  return {
    deployment: 'acme',
    overlayRoot: 'backend/src/apps/acme/modules',
    overlayModules: Object.keys(modules),
    sources,
    routes: new Map(),
    owners: new Map(),
    rootSupplied: new Set(),
    declaration: { omittedModules: [], decorationOrder: {}, reasons: {}, ...declaration },
    seams: ['commandMiddleware', 'commandHooks'],
  };
}

const HOLD = {
  manifest: MANIFEST(
    'acme_hold',
    `[
    { id: 'legal-hold', phase: 'admit', actions: ['organization.', 'quote.convert'] },
    { id: 'timing', phase: 'observe', actions: '*', timeoutMs: 2000 },
  ]`,
  ),
  backend: BACKEND,
};

describe('the `command-middleware` divergence kind (189 T043)', () => {
  it('is classified on rung 2, so `ctx.commandMiddleware` is no unclassified seam', () => {
    expect(SEAM_CLASSIFICATION['commandMiddleware']).toEqual({ verdict: 'divergence', kind: 'command-middleware', rung: 2 });
    const { findings, report } = deriveDivergence(input({ acme_hold: HOLD }));
    expect(findings.filter((finding) => finding.kind === 'unclassified-seam')).toEqual([]);
    expect(report.boundary.recorded).toContain('command-middleware');
  });

  it('records each declared middleware as command-middleware:<module>:<id>, owner null, rung 2, with phase and filter', () => {
    const { report } = deriveDivergence(input({ acme_hold: HOLD }));
    const entries = report.entries.filter((entry) => entry.kind === 'command-middleware');
    expect(entries).toEqual([
      {
        key: 'command-middleware:acme_hold:legal-hold',
        kind: 'command-middleware',
        module: 'acme_hold',
        subject: 'legal-hold',
        owner: null,
        rung: 2,
        detail: { kind: 'command-middleware', phase: 'admit', id: 'legal-hold', actions: ['organization.', 'quote.convert'] },
        reason: '',
      },
      {
        key: 'command-middleware:acme_hold:timing',
        kind: 'command-middleware',
        module: 'acme_hold',
        subject: 'timing',
        owner: null,
        rung: 2,
        detail: { kind: 'command-middleware', phase: 'observe', id: 'timing', actions: '*' },
        reason: '',
      },
    ]);
  });

  it('derives entries from the declaration only, so the registration call adds none and no computed-subject', () => {
    const { report, findings } = deriveDivergence(input({ acme_hold: HOLD }));
    expect(report.entries.filter((entry) => entry.kind === 'command-middleware')).toHaveLength(2);
    expect(findings.filter((finding) => finding.kind === 'computed-subject')).toEqual([]);
  });

  it('asks for one reason per middleware, and a reason keyed by it clears it', () => {
    const undeclared = deriveDivergence(input({ acme_hold: HOLD })).findings.filter(
      (finding) => finding.kind === 'undeclared-divergence',
    );
    expect(undeclared.map((finding) => finding.detail)).toEqual([
      expect.stringContaining('command-middleware:acme_hold:legal-hold'),
      expect.stringContaining('command-middleware:acme_hold:timing'),
    ]);
    const reasons = {
      'command-middleware:acme_hold:legal-hold': 'Refuses writes for an organisation under a legal hold, children included.',
      'command-middleware:acme_hold:timing': 'Sends the duration and outcome of every write to the monitoring stack.',
    };
    expect(
      deriveDivergence(input({ acme_hold: HOLD }, { reasons })).findings.filter((finding) => finding.kind === 'undeclared-divergence'),
    ).toEqual([]);
  });

  it('reports a declaration it cannot read as computed-subject, never as a skip', () => {
    const computed = { manifest: MANIFEST('acme_hold', `[{ id: HOLD_ID, phase: 'admit', actions: '*' }]`) };
    const { findings } = deriveDivergence(input({ acme_hold: computed }));
    expect(findings.filter((finding) => finding.kind === 'computed-subject').map((finding) => finding.detail)).toEqual([
      expect.stringContaining('commandMiddleware'),
    ]);
  });

  it('renders the kind under its own heading in the human report, with phase and filter', () => {
    const { report } = deriveDivergence(input({ acme_hold: HOLD }));
    const markdown = renderDivergenceMarkdown(report);
    expect(markdown).toContain('### Command middleware this deployment runs on the Command Bus');
    expect(markdown).toContain('`legal-hold` (admit, `organization.`, `quote.convert`)');
    expect(markdown).toContain('`timing` (observe, every Command)');
    expect(markdown).toContain('the Command Bus (no module owns it)');
  });
});

describe('commandMiddlewareOrder findings (189 T043, FR-031)', () => {
  const admitAll = (id: string, dependencies = '[]') => ({
    manifest: MANIFEST(id, `[{ id: 'rule', phase: 'admit', actions: '*' }]`, dependencies),
  });

  it('raises stale-middleware-order for an entry naming no admit contributor of this deployment', () => {
    const { findings } = deriveDivergence(
      input({ acme_a: admitAll('acme_a'), acme_b: admitAll('acme_b') }, { commandMiddlewareOrder: ['acme_a', 'acme_b', 'acme_gone'] }),
    );
    expect(findings.filter((finding) => finding.kind === 'stale-middleware-order').map((finding) => finding.detail)).toEqual([
      expect.stringContaining('acme_gone'),
    ]);
  });

  it('raises incomplete-middleware-order for an entry naming one module of a tie and not the other', () => {
    const { findings } = deriveDivergence(
      input(
        { acme_a: admitAll('acme_a'), acme_b: admitAll('acme_b'), acme_c: admitAll('acme_c') },
        { commandMiddlewareOrder: ['acme_a', 'acme_c'] },
      ),
    );
    expect(findings.filter((finding) => finding.kind === 'incomplete-middleware-order').map((finding) => finding.detail)).toEqual([
      expect.stringContaining('acme_b'),
    ]);
  });

  it('raises nothing for a pair a dependency already orders, or whose filters cannot meet', () => {
    const dependent = deriveDivergence(
      input(
        { acme_a: admitAll('acme_a'), acme_b: admitAll('acme_b', "['acme_a']"), acme_c: { manifest: MANIFEST('acme_c', `[{ id: 'rule', phase: 'admit', actions: ['quote.'] }]`, "['acme_a', 'acme_b']") } },
        { commandMiddlewareOrder: ['acme_a', 'acme_b'] },
      ),
    );
    expect(dependent.findings.filter((finding) => finding.kind.endsWith('middleware-order'))).toEqual([]);
  });

  it('is read from a divergence.ts written as literals', () => {
    const reading = readDivergenceDeclaration(
      `export const divergence = { omittedModules: [], decorationOrder: {}, reasons: {}, commandMiddlewareOrder: ['acme_a', 'acme_b'] };`,
      'apps/acme/divergence.ts',
    );
    expect(reading.unresolved).toEqual([]);
    expect(reading.declaration.commandMiddlewareOrder).toEqual(['acme_a', 'acme_b']);
  });
});
