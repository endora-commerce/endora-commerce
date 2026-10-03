import { describe, expect, it } from 'vitest';

import {
  checkVerdictOf,
  evaluateA1,
  evaluateA4,
  evaluateA5Package,
  evaluateA6Storefront,
  evaluateA7Storefront,
  evaluateA8Email,
  evaluateA8Storefront,
  unmeasured,
  type EmailProbe,
  type PackedFixtureObservation,
  type StorefrontBuildObservation,
  type StorefrontProbe,
} from '../../../scripts/acceptance/block-renderers-assertions.js';
import { exitCodeFor } from '../../../scripts/acceptance/storefront-scaffold-assertions.js';

/**
 * The judgements of the block-renderers acceptance criterion
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §9), each
 * red and green. The runner supplies observations; nothing here packs, installs
 * or renders.
 */

const packed: PackedFixtureObservation = {
  exports: {
    '.': './dist/manifest.js',
    './admin': './dist/admin/index.js',
    './storefront': './dist/storefront/index.js',
    './email': './dist/email/index.js',
    './blocks.css': './blocks.css',
  },
  files: [
    'package.json',
    'blocks.css',
    'dist/manifest.js',
    'dist/admin/index.js',
    'dist/storefront/index.js',
    'dist/email/index.js',
  ],
  checkVerdict: 'clean',
};

const probe: StorefrontProbe = {
  present: '<span class="acceptance_blocks-badge">acceptance-badge:Gold</span>',
  absent: '<span aria-hidden="true"></span>',
  absentPreview: '<div role="note">Missing CMS component: <code>acceptance_blocks.Badge</code></div>',
  presentAgain: '<span class="acceptance_blocks-badge">acceptance-badge:Gold</span>',
  exploding: '<span>acceptance-badge:Before</span><span aria-hidden="true"></span><span>acceptance-badge:After</span>',
  documentBefore: '{"content":[]}',
  documentAfter: '{"content":[]}',
};

const build: StorefrontBuildObservation = {
  registry:
    "import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';\n\n" +
    "import { contributions as contributions0 } from '@endora-commerce/mod-acceptance-blocks/storefront';\n" +
    "  { moduleId: 'acceptance_blocks', contributions: contributions0 },\n",
  stylesheet: "@import '@endora-commerce/mod-acceptance-blocks/blocks.css';\n",
  buildExitCode: 0,
  buildOutput: '',
  probe,
};

const email: EmailProbe = {
  html: '<tr><td>acceptance-badge:Gold</td></tr>',
  text: 'acceptance-badge:Gold',
  htmlWithoutRenderers: '',
  explodingHtml: '<tr><td>acceptance-badge:Before</td></tr><tr><td>acceptance-badge:After</td></tr>',
  explodingText: 'acceptance-badge:Before\nacceptance-badge:After',
  reported: ['acceptance_blocks.Badge'],
};

describe('A1 — the packed fixture', () => {
  it('passes when all four subpaths are published and the check is clean', () => {
    expect(evaluateA1(packed).state).toBe('pass');
  });

  it.each([
    ['a subpath the manifest does not declare', { ...packed, exports: { ...packed.exports, './email': undefined } }],
    ['a subpath whose file is not in the tarball', { ...packed, files: packed.files.filter((f) => f !== 'blocks.css') }],
    ['a check with findings', { ...packed, checkVerdict: 'findings=1' }],
    ['a check that is not-applicable — the rule found no subject', { ...packed, checkVerdict: 'not-applicable' }],
    ['no check line at all', { ...packed, checkVerdict: null }],
  ])('fails on %s', (_label, observed) => {
    expect(evaluateA1(observed as PackedFixtureObservation).state).toBe('fail');
  });

  it('reads the verdict word off the rule’s own line', () => {
    const output =
      '  check:block-names                  pending        waits on …\n' +
      '  check:block-renderers              clean          [block-renderers] read: files=9 sites=4\n';
    expect(checkVerdictOf(output, 'check:block-renderers')).toBe('clean');
    expect(checkVerdictOf(output, 'check:block-names')).toBe('pending');
    expect(checkVerdictOf(output, 'check:nul-bytes')).toBeNull();
  });
});

describe('A4 — the storefront build', () => {
  it('passes for one registered layer, a green build and a marker in the SSR output', () => {
    expect(evaluateA4(build).state).toBe('pass');
  });

  it.each([
    ['an empty registry', { ...build, registry: 'export const STOREFRONT_BLOCK_CONTRIBUTIONS = [];\n' }],
    [
      'a second layer beside the fixture',
      { ...build, registry: `${build.registry}import { contributions as contributions1 } from '@other/mod/storefront';\n` },
    ],
    ['a stylesheet that was not imported', { ...build, stylesheet: '/* none */\n' }],
    ['a failed build', { ...build, buildExitCode: 1, buildOutput: 'Failed to compile.' }],
    ['no probe result', { ...build, probe: null }],
    ['SSR output without the marker', { ...build, probe: { ...probe, present: '<span></span>' } }],
  ])('fails on %s', (_label, observed) => {
    expect(evaluateA4(observed as StorefrontBuildObservation).state).toBe('fail');
  });
});

describe('A6–A8 — the storefront halves', () => {
  it('pass on the observations a correct storefront produces', () => {
    expect(evaluateA6Storefront(probe).state).toBe('pass');
    expect(evaluateA7Storefront(probe).state).toBe('pass');
    expect(evaluateA8Storefront(probe).state).toBe('pass');
  });

  it('A6 fails when the block reaches a customer, renders in preview, or preview says nothing', () => {
    expect(evaluateA6Storefront({ ...probe, absent: probe.present }).state).toBe('fail');
    expect(evaluateA6Storefront({ ...probe, absentPreview: probe.present }).state).toBe('fail');
    expect(evaluateA6Storefront({ ...probe, absentPreview: '<span></span>' }).state).toBe('fail');
    expect(evaluateA6Storefront(null).state).toBe('fail');
  });

  it('A7 fails when the block does not come back, or the document moved', () => {
    expect(evaluateA7Storefront({ ...probe, presentAgain: '' }).state).toBe('fail');
    expect(evaluateA7Storefront({ ...probe, documentAfter: '{"content":[1]}' }).state).toBe('fail');
    expect(evaluateA7Storefront({ ...probe, documentBefore: '', documentAfter: '' }).state).toBe('fail');
  });

  it('A8 fails when a sibling is lost, or the throwing block rendered', () => {
    expect(evaluateA8Storefront({ ...probe, exploding: 'acceptance-badge:Before' }).state).toBe('fail');
    expect(
      evaluateA8Storefront({ ...probe, exploding: `${probe.exploding}acceptance-badge:Exploding` }).state,
    ).toBe('fail');
  });
});

describe('A5 and A8 — the e-mail halves', () => {
  it('pass on the observations a correct layer produces', () => {
    expect(evaluateA5Package(email).state).toBe('pass');
    expect(evaluateA8Email(email).state).toBe('pass');
  });

  it('A5 fails without the marker in either output, and when the control renders it too', () => {
    expect(evaluateA5Package({ ...email, html: '' }).state).toBe('fail');
    expect(evaluateA5Package({ ...email, text: '' }).state).toBe('fail');
    expect(evaluateA5Package({ ...email, htmlWithoutRenderers: email.html }).state).toBe('fail');
    expect(evaluateA5Package(null).state).toBe('fail');
  });

  it('A8 fails when the thrower contributed, a sibling is lost, or nothing was reported', () => {
    expect(evaluateA8Email({ ...email, explodingHtml: `${email.explodingHtml}acceptance-badge:Exploding` }).state).toBe('fail');
    expect(evaluateA8Email({ ...email, explodingHtml: 'acceptance-badge:Before' }).state).toBe('fail');
    expect(evaluateA8Email({ ...email, reported: [] }).state).toBe('fail');
  });
});

describe('an assertion the runner does not measure', () => {
  it('is its own state, and makes the plain run exit 2 rather than 0', () => {
    const result = unmeasured('A2', 'needs a scaffolded instance');
    expect(result).toEqual({ id: 'A2', state: 'unmeasured', detail: 'needs a scaffolded instance' });
    expect(exitCodeFor([evaluateA1(packed), result])).toBe(2);
  });
});
