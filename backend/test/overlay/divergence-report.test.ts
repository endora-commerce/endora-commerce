import { describe, expect, it } from 'vitest';
import type { DivergenceReport } from '@endora-commerce/contracts';
import { DIVERGENCE_REPORT } from '../../src/overlay/divergence.core.generated.js';
import {
  renderDivergenceMarkdown,
  RUNG_COSTS,
  serializeDivergenceJson,
  serializeDivergenceModule,
} from '../../src/overlay/divergence-report.js';
import { divergenceBoundary } from '../../scripts/lib/divergence.js';

/**
 * The committed divergence report — its emit shape, its determinism and the two
 * renderings it emits from one derivation (feature 107, FR-013/FR-015).
 *
 * This file replaces `override-manifest.test.ts`, `us3-determinism.test.ts` and
 * `us3-bare-core-manifest.test.ts`, which asserted the same three things about
 * the artefact this one supersedes. Their subjects survive here unchanged; what
 * moved is the shape they are asserted over, and one addition — the markdown
 * rendering, which is new and is the one an upgrader reads.
 */

const FIXTURES = '/home/somebody/checkout/backend/src/apps/acme/modules';

function reportFor(overlayModules: readonly string[]): DivergenceReport {
  return {
    deployment: 'acme',
    generatedFrom: { overlayRoot: 'backend/src/apps/acme/modules' },
    overlayModules: [...overlayModules],
    entries: [
      {
        key: 'decoration:acme_overlay:pricingService',
        kind: 'decoration',
        module: 'acme_overlay',
        subject: 'pricingService',
        owner: 'price_lists',
        rung: 4,
        detail: { kind: 'decoration', depth: null },
        reason:
          'Core resolves a line price from the price lists a customer is entitled to; Acme ' +
          'applies a per-contract rebate after list price, delegating to core first.',
      },
    ],
    boundary: divergenceBoundary(),
  };
}

describe('the divergence report — emit shape and determinism (FR-013)', () => {
  it('records nothing about the machine that generated it', () => {
    // Determinism is not "the same run twice agrees" — it is "two checkouts
    // agree", and an absolute path is what breaks that first. The fixture root
    // is somebody else's home directory on purpose.
    const rendered = serializeDivergenceModule(reportFor(['acme_overlay']), './types.js');
    expect(rendered).not.toContain(FIXTURES);
    expect(rendered).not.toContain('/home/');
    // No timestamp, in any of the shapes one is written in.
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it('renders byte-identically from one report, in both renderings', () => {
    const report = reportFor(['acme_overlay', 'acme_pricing']);
    expect(serializeDivergenceModule(report, './types.js')).toEqual(
      serializeDivergenceModule(report, './types.js'),
    );
    expect(renderDivergenceMarkdown(report)).toEqual(renderDivergenceMarkdown(report));
    expect(serializeDivergenceJson(report)).toEqual(serializeDivergenceJson(report));
  });

  it('renders the report it was given, and sorts nothing itself', () => {
    // Sorting is the **derivation's** — `deriveDivergence` sorts the overlay
    // module list and the entries, because a directory listing is its input and
    // two filesystems disagree about it. A render that sorted as well would be
    // a second answer to that question, and the one a reader could not see.
    // `test/unit/scripts/check-divergence.test.ts` proves the sort where it
    // happens.
    const rendered = serializeDivergenceModule(reportFor(['b_mod', 'a_mod']), './types.js');
    expect(rendered.indexOf('b_mod')).toBeLessThan(rendered.indexOf('a_mod'));
  });
});

describe('the human rendering (US4, SC-001)', () => {
  const markdown = renderDivergenceMarkdown(reportFor(['acme_overlay']));

  it('names what was changed, who changed it, who owns it and why', () => {
    expect(markdown).toContain('pricingService');
    expect(markdown).toContain('acme_overlay');
    expect(markdown).toContain('price_lists');
    expect(markdown).toContain('per-contract rebate');
  });

  it('spells the rung’s cost rather than its number', () => {
    // A number means nothing to a reader who has not got the ladder open beside
    // them, and the reader this artefact exists for is a client's developer who
    // has not. The cost sentence is `RUNG_COSTS`', so the two cannot drift.
    expect(markdown).toContain(RUNG_COSTS[4]);
  });

  it('carries no key strings and no repository-relative paths', () => {
    // SC-001's two negative rules: a reader is not looking anything up, and
    // their tree is not this one.
    expect(markdown).not.toContain('decoration:acme_overlay:pricingService');
    expect(markdown).not.toContain('backend/src/apps');
  });

  it('states its own boundary rather than implying completeness', () => {
    // FR-018. A report that lists what it records and says nothing about the
    // rest is indistinguishable from a complete one.
    expect(markdown).toContain('What this report does not cover');
    expect(markdown).toContain('ctx.routes');
    expect(markdown).toContain('the operator');
  });

  it('says so explicitly when a deployment diverges by nothing', () => {
    const empty = renderDivergenceMarkdown({ ...reportFor([]), entries: [] });
    expect(empty).toContain('Nothing.');
    // And still states the boundary: an empty report is a statement, and a
    // statement with no boundary is the one shape FR-018 refuses.
    expect(empty).toContain('What this report does not cover');
  });
});

describe('the bare-core artefact', () => {
  it('is bare core: no deployment, no overlay root, no overlay module', () => {
    expect(DIVERGENCE_REPORT.deployment).toBe('core');
    expect(DIVERGENCE_REPORT.generatedFrom.overlayRoot).toBeNull();
    expect(DIVERGENCE_REPORT.overlayModules).toEqual([]);
    expect(DIVERGENCE_REPORT.entries).toEqual([]);
  });

  it('states its boundary even with nothing to report', () => {
    // The property that lets an empty artefact be a *statement*: a deployment
    // that diverges by nothing is legitimate, so `overlay:check`'s `empty`
    // verdict does not apply — which is exactly why the boundary has to be here.
    expect(DIVERGENCE_REPORT.boundary.recorded.length).toBeGreaterThan(0);
    expect(DIVERGENCE_REPORT.boundary.notRecorded.length).toBeGreaterThan(0);
    expect(DIVERGENCE_REPORT.boundary.runtimeOnly).toHaveLength(3);
  });

  it('carries no field the shape does not declare', () => {
    // The v2 manifest's `overrides` array was always empty for a year, and an
    // always-empty field in an artefact a determinism check byte-compares is a
    // field that makes the check agree with itself.
    expect(Object.keys(DIVERGENCE_REPORT).sort()).toEqual([
      'boundary',
      'deployment',
      'entries',
      'generatedFrom',
      'overlayModules',
    ]);
  });
});
