import { describe, expect, it } from 'vitest';

import {
  checkVerdictOf,
  evaluateA1,
  evaluateA2,
  evaluateA3,
  evaluateA4,
  evaluateA5Package,
  evaluateA5Platform,
  evaluateA6Admin,
  evaluateA6Email,
  evaluateA6Storefront,
  evaluateA7Admin,
  evaluateA7Email,
  evaluateA7Storefront,
  evaluateA8Admin,
  evaluateA8Package,
  evaluateA8Platform,
  evaluateA8Storefront,
  unmeasured,
  type AdminBuildObservation,
  type AdminProbe,
  type EmailProbe,
  type PackedFixtureObservation,
  type PlatformObservation,
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
    expect(evaluateA8Package(email).state).toBe('pass');
  });

  it('A5 fails without the marker in either output, and when the control renders it too', () => {
    expect(evaluateA5Package({ ...email, html: '' }).state).toBe('fail');
    expect(evaluateA5Package({ ...email, text: '' }).state).toBe('fail');
    expect(evaluateA5Package({ ...email, htmlWithoutRenderers: email.html }).state).toBe('fail');
    expect(evaluateA5Package(null).state).toBe('fail');
  });

  it('A8 fails when the thrower contributed, a sibling is lost, or nothing was reported', () => {
    expect(evaluateA8Package({ ...email, explodingHtml: `${email.explodingHtml}acceptance-badge:Exploding` }).state).toBe('fail');
    expect(evaluateA8Package({ ...email, explodingHtml: 'acceptance-badge:Before' }).state).toBe('fail');
    expect(evaluateA8Package({ ...email, reported: [] }).state).toBe('fail');
  });
});

const GOLD = { status: 200, html: '<tr><td>acceptance-badge:Gold</td></tr>', text: 'acceptance-badge:Gold' };
const EMPTY = { status: 200, html: '<p>Hello</p>', text: 'Hello' };

const on: PlatformObservation = {
  active: true,
  descriptorEntry: { name: 'acceptance_blocks.Badge', fields: { text: {}, explode: {} } },
  descriptorStatus: 200,
  transactional: GOLD,
  transactionalExploding: {
    status: 200,
    html: 'acceptance-badge:Before acceptance-badge:After',
    text: 'acceptance-badge:Before acceptance-badge:After',
  },
  newsletter: GOLD,
  storedCampaignContent: '{"content":[{"type":"acceptance_blocks.Badge"}]}',
  saveStatus: 200,
};
const off: PlatformObservation = {
  ...on,
  active: false,
  descriptorEntry: null,
  transactional: EMPTY,
  newsletter: EMPTY,
};

const adminBuild: AdminBuildObservation = {
  registry: "import { contributions as contributions0 } from '@endora-commerce/mod-acceptance-blocks/admin';\n",
  stylesheet: '@import "@endora-commerce/mod-acceptance-blocks/blocks.css";\n',
  buildExitCode: 0,
  buildOutput: '',
  bundleHasMarker: true,
};

const adminProbe: AdminProbe = {
  registryModules: ['acceptance_blocks'],
  cmsOn: '<span>acceptance-badge:Gold</span>',
  cmsFields: ['text', 'explode'],
  cmsOff: '<div role="note">Missing CMS component: <code>acceptance_blocks.Badge</code></div>',
  cmsOffInsertable: false,
  cmsAgain: '<span>acceptance-badge:Gold</span>',
  cmsExploding:
    '<span>acceptance-badge:Before</span><div role="note"><code>acceptance_blocks.Badge</code></div><span>acceptance-badge:After</span>',
  emailCanvas: '<table><tbody><tr><td>acceptance-badge:Gold</td></tr></tbody></table>',
  documentBefore: '{"content":[1]}',
  documentAfter: '{"content":[1]}',
};

describe('A5–A8 — the composed platform', () => {
  it('pass on the observations a correct platform produces', () => {
    expect(evaluateA5Platform(on).state).toBe('pass');
    expect(evaluateA6Email(off).state).toBe('pass');
    expect(evaluateA7Email(on, off, on).state).toBe('pass');
    expect(evaluateA8Platform(on).state).toBe('pass');
  });

  it('A5 fails when either preview lacks the marker, answers an error, or the content cannot be saved', () => {
    expect(evaluateA5Platform({ ...on, transactional: EMPTY }).state).toBe('fail');
    expect(evaluateA5Platform({ ...on, newsletter: { ...GOLD, text: '' } }).state).toBe('fail');
    expect(evaluateA5Platform({ ...on, newsletter: { ...GOLD, status: 500 } }).state).toBe('fail');
    expect(evaluateA5Platform({ ...on, saveStatus: 400 }).state).toBe('fail');
    expect(evaluateA5Platform(null).state).toBe('fail');
  });

  it('A6 fails when the block still renders off, a message fails, or saving is refused', () => {
    expect(evaluateA6Email({ ...off, transactional: GOLD }).state).toBe('fail');
    expect(evaluateA6Email({ ...off, newsletter: { ...EMPTY, status: 500 } }).state).toBe('fail');
    expect(evaluateA6Email({ ...off, saveStatus: 400 }).state).toBe('fail');
  });

  it('A7 fails when the block does not come back, or the stored campaign moved', () => {
    expect(evaluateA7Email(on, off, { ...on, newsletter: EMPTY }).state).toBe('fail');
    expect(evaluateA7Email(on, { ...off, storedCampaignContent: '{}' }, on).state).toBe('fail');
    expect(evaluateA7Email({ ...on, storedCampaignContent: 'null' }, { ...off, storedCampaignContent: 'null' }, { ...on, storedCampaignContent: 'null' }).state).toBe('fail');
    expect(evaluateA7Email(on, null, on).state).toBe('fail');
  });

  it('A8 fails when the thrower contributed, a sibling is lost, or the message failed', () => {
    const exploding = on.transactionalExploding;
    expect(evaluateA8Platform({ ...on, transactionalExploding: { ...exploding, html: `${exploding.html} acceptance-badge:Exploding` } }).state).toBe('fail');
    expect(evaluateA8Platform({ ...on, transactionalExploding: { ...exploding, html: 'acceptance-badge:Before' } }).state).toBe('fail');
    expect(evaluateA8Platform({ ...on, transactionalExploding: { ...exploding, status: 500 } }).state).toBe('fail');
  });
});

describe('A2, A3, A6–A8 — the instance admin', () => {
  it('pass on the observations a correct instance produces', () => {
    expect(evaluateA2(adminBuild).state).toBe('pass');
    expect(evaluateA3(adminProbe, on).state).toBe('pass');
    expect(evaluateA6Admin(adminProbe, off).state).toBe('pass');
    expect(evaluateA7Admin(adminProbe, on).state).toBe('pass');
    expect(evaluateA8Admin(adminProbe).state).toBe('pass');
  });

  it('A2 fails on a failed build, a registry or stylesheet without the fixture, or a bundle without the marker', () => {
    expect(evaluateA2({ ...adminBuild, buildExitCode: 1, buildOutput: 'error during build' }).state).toBe('fail');
    expect(evaluateA2({ ...adminBuild, registry: '' }).state).toBe('fail');
    expect(evaluateA2({ ...adminBuild, stylesheet: '' }).state).toBe('fail');
    expect(evaluateA2({ ...adminBuild, bundleHasMarker: false }).state).toBe('fail');
  });

  it('A3 fails without a registry entry, a marker, the declared fields, or a descriptor entry', () => {
    expect(evaluateA3({ ...adminProbe, registryModules: [] }, on).state).toBe('fail');
    expect(evaluateA3({ ...adminProbe, cmsOn: '' }, on).state).toBe('fail');
    expect(evaluateA3({ ...adminProbe, cmsFields: ['componentName', 'ownerModule'] }, on).state).toBe('fail');
    expect(evaluateA3({ ...adminProbe, emailCanvas: '' }, on).state).toBe('fail');
    expect(evaluateA3(adminProbe, off).state).toBe('fail');
    expect(evaluateA3(null, on).state).toBe('fail');
  });

  it('A6 fails when the descriptor keeps the block, it renders, is not named, or stays insertable', () => {
    expect(evaluateA6Admin(adminProbe, on).state).toBe('fail');
    expect(evaluateA6Admin({ ...adminProbe, cmsOff: adminProbe.cmsOn }, off).state).toBe('fail');
    expect(evaluateA6Admin({ ...adminProbe, cmsOff: '<span></span>' }, off).state).toBe('fail');
    expect(evaluateA6Admin({ ...adminProbe, cmsOffInsertable: true }, off).state).toBe('fail');
  });

  it('A7 fails when the block does not come back, or the document moved', () => {
    expect(evaluateA7Admin(adminProbe, off).state).toBe('fail');
    expect(evaluateA7Admin({ ...adminProbe, cmsAgain: '' }, on).state).toBe('fail');
    expect(evaluateA7Admin({ ...adminProbe, documentAfter: '{}' }, on).state).toBe('fail');
  });

  it('A8 fails when a sibling is lost, the thrower rendered, or no placeholder names it', () => {
    expect(evaluateA8Admin({ ...adminProbe, cmsExploding: 'acceptance-badge:Before' }).state).toBe('fail');
    expect(evaluateA8Admin({ ...adminProbe, cmsExploding: `${adminProbe.cmsExploding}acceptance-badge:Exploding` }).state).toBe('fail');
    expect(evaluateA8Admin({ ...adminProbe, cmsExploding: 'acceptance-badge:Before acceptance-badge:After' }).state).toBe('fail');
  });
});

describe('an assertion the runner does not measure', () => {
  it('is its own state, and makes the plain run exit 2 rather than 0', () => {
    const result = unmeasured('A2', 'needs a scaffolded instance');
    expect(result).toEqual({ id: 'A2', state: 'unmeasured', detail: 'needs a scaffolded instance' });
    expect(exitCodeFor([evaluateA1(packed), result])).toBe(2);
  });
});
