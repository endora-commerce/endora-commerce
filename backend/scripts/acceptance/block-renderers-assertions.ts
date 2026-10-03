/**
 * Every judgement of the block-renderers acceptance criterion, pure
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §9).
 *
 * The runner (`block-renderers.ts`) packs, installs, builds and probes; this
 * file decides what each observation means. It is unit tested in
 * `test/unit/scripts/block-renderers-acceptance.test.ts`, red and green, so a
 * judgement cannot go soft without a test saying so.
 *
 * The result shape, the exit codes and the two-way comparison against the
 * recorded state are `storefront-scaffold-assertions.ts`' and are imported
 * rather than restated.
 */
import type { AssertionResult } from './storefront-scaffold-assertions.js';

/** What every renderer of the fixture's block prints, before the block's text. */
export const MARKER = 'acceptance-badge:';

/** The fixture's package name and the block it draws. */
export const FIXTURE_PACKAGE = '@endora-commerce/mod-acceptance-blocks';
export const FIXTURE_MODULE_ID = 'acceptance_blocks';
export const FIXTURE_BLOCK = 'acceptance_blocks.Badge';

/** The subpaths A1 requires the packed fixture to publish. */
export const REQUIRED_SUBPATHS = ['./admin', './storefront', './email', './blocks.css'] as const;

const pass = (id: string, detail: string): AssertionResult => ({ id, state: 'pass', detail });
const fail = (id: string, detail: string): AssertionResult => ({ id, state: 'fail', detail });

/** An assertion this runner does not measure, with the reason on its own line. */
export function unmeasured(id: string, reason: string): AssertionResult {
  return { id, state: 'unmeasured', detail: reason };
}

export interface PackedFixtureObservation {
  /** The `exports` map of the manifest **inside the tarball**. */
  readonly exports: Readonly<Record<string, unknown>>;
  /** Every path the tarball holds, package-relative. */
  readonly files: readonly string[];
  /** `check:block-renderers`' verdict word from `endora check`, or `null` if no line was printed. */
  readonly checkVerdict: string | null;
}

function targetOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry !== null && typeof entry === 'object') {
    for (const condition of ['import', 'default']) {
      const hit = targetOf((entry as Record<string, unknown>)[condition]);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * A1 — the packed fixture publishes the four subpaths, each pointing at a file
 * the tarball really holds, and `endora check` passes `check:block-renderers`.
 */
export function evaluateA1(observed: PackedFixtureObservation): AssertionResult {
  const files = new Set(observed.files);
  for (const subpath of REQUIRED_SUBPATHS) {
    const target = targetOf(observed.exports[subpath]);
    if (target === null) return fail('A1', `the packed manifest declares no \`${subpath}\``);
    if (!files.has(target.replace(/^\.\//, ''))) {
      return fail('A1', `\`${subpath}\` points at ${target}, which the tarball does not hold`);
    }
  }
  if (observed.checkVerdict === null) {
    return fail('A1', '`endora check` printed no `check:block-renderers` line for the fixture');
  }
  if (observed.checkVerdict !== 'clean') {
    return fail('A1', `\`endora check\` answered \`${observed.checkVerdict}\` for check:block-renderers`);
  }
  return pass(
    'A1',
    'the tarball publishes ./admin, ./storefront, ./email and ./blocks.css, and `endora check` answers `clean` for check:block-renderers',
  );
}

/** The verdict word `endora check` printed for one rule, or `null`. */
export function checkVerdictOf(output: string, ruleId: string): string | null {
  for (const line of output.split('\n')) {
    const match = /^\s+(\S+)\s+(\S+)/.exec(line);
    if (match !== null && match[1] === ruleId) return match[2] ?? null;
  }
  return null;
}

/** What the storefront's own vitest probe wrote. Each field is server-rendered HTML. */
export interface StorefrontProbe {
  /** The block, its owner present. */
  readonly present: string;
  /** The same document with the owner reported absent. */
  readonly absent: string;
  /** Absent, in preview. */
  readonly absentPreview: string;
  /** The owner present again. */
  readonly presentAgain: string;
  /** A sibling badge, one forced to throw, another sibling badge. */
  readonly exploding: string;
  /** The stored document, serialised before and after every render above. */
  readonly documentBefore: string;
  readonly documentAfter: string;
}

export interface StorefrontBuildObservation {
  /** `lib/page-builder/blocks.generated.ts` after `blocks:generate`. */
  readonly registry: string;
  /** `app/blocks.generated.css` after `blocks:generate`. */
  readonly stylesheet: string;
  readonly buildExitCode: number;
  readonly buildOutput: string;
  readonly probe: StorefrontProbe | null;
}

/**
 * A4 — a scaffolded storefront with the fixture added: `blocks:generate` writes
 * one entry, `next build` succeeds, and SSR of a document holding the block
 * contains the marker.
 */
export function evaluateA4(observed: StorefrontBuildObservation): AssertionResult {
  const imports = observed.registry.split('\n').filter((line) => /^import \{ contributions as /.test(line));
  if (imports.length !== 1 || !imports[0]!.includes(`'${FIXTURE_PACKAGE}/storefront'`)) {
    return fail(
      'A4',
      `blocks:generate wrote ${String(imports.length)} storefront layer(s), expected exactly the fixture's`,
    );
  }
  if (!observed.registry.includes(`moduleId: '${FIXTURE_MODULE_ID}'`)) {
    return fail('A4', `the generated registry does not key the fixture by its module id`);
  }
  if (!observed.stylesheet.includes(`@import '${FIXTURE_PACKAGE}/blocks.css';`)) {
    return fail('A4', 'the generated stylesheet does not import the fixture\'s ./blocks.css');
  }
  if (observed.buildExitCode !== 0) {
    return fail(
      'A4',
      `next build exited ${String(observed.buildExitCode)}: ` +
        observed.buildOutput.trim().split('\n').slice(-6).join(' / '),
    );
  }
  if (observed.probe === null) return fail('A4', 'the SSR probe wrote no result');
  if (!observed.probe.present.includes(`${MARKER}Gold`)) {
    return fail('A4', 'the server-rendered HTML of a document holding the block has no marker');
  }
  return pass(
    'A4',
    'blocks:generate registered the fixture alone, next build succeeded, and the block is in the server-rendered HTML',
  );
}

/** A6, storefront half — with the owner reported absent, no marker reaches a customer. */
export function evaluateA6Storefront(probe: StorefrontProbe | null): AssertionResult {
  const id = 'A6-storefront';
  if (probe === null) return fail(id, 'the SSR probe wrote no result');
  if (probe.absent.includes(MARKER) || probe.absent.includes(FIXTURE_BLOCK)) {
    return fail(id, 'the block reached the HTML while its owner was reported absent');
  }
  if (probe.absentPreview.includes(MARKER)) {
    return fail(id, 'the block rendered in preview while its owner was reported absent');
  }
  if (!probe.absentPreview.includes(FIXTURE_BLOCK)) {
    return fail(id, 'preview shows no note naming the block whose owner is absent');
  }
  return pass(id, 'absent owner: nothing of the block for a customer, the note in preview');
}

/** A7, storefront half — on again the block renders, and the stored document is byte-identical. */
export function evaluateA7Storefront(probe: StorefrontProbe | null): AssertionResult {
  const id = 'A7-storefront';
  if (probe === null) return fail(id, 'the SSR probe wrote no result');
  if (!probe.presentAgain.includes(`${MARKER}Gold`)) {
    return fail(id, 'the block did not render again once its owner was present');
  }
  if (probe.documentBefore !== probe.documentAfter) {
    return fail(id, 'the stored document changed between the renders');
  }
  if (probe.documentBefore === '') return fail(id, 'the probe recorded no document to compare');
  return pass(id, 'the block renders again and the stored document is byte-identical');
}

/** A8, storefront half — a throwing renderer degrades its own block and no other. */
export function evaluateA8Storefront(probe: StorefrontProbe | null): AssertionResult {
  const id = 'A8-storefront';
  if (probe === null) return fail(id, 'the SSR probe wrote no result');
  for (const sibling of ['Before', 'After']) {
    if (!probe.exploding.includes(`${MARKER}${sibling}`)) {
      return fail(id, `the sibling block "${sibling}" is missing beside the one that threw`);
    }
  }
  if (probe.exploding.includes(`${MARKER}Exploding`)) {
    return fail(id, 'the block that was forced to throw rendered anyway');
  }
  return pass(id, 'the block forced to throw is gone and both siblings rendered');
}

/** What the e-mail probe wrote, rendered through the installed tarballs. */
export interface EmailProbe {
  readonly html: string;
  readonly text: string;
  /** Rendered with no contributed renderer at all — what an absent owner's table answers. */
  readonly htmlWithoutRenderers: string;
  readonly explodingHtml: string;
  readonly explodingText: string;
  /** The block names reported through `onBlockError` while rendering the exploding document. */
  readonly reported: readonly string[];
}

/**
 * A5, package half — the packed e-mail layer renders the marker in HTML and
 * text through the installed e-mail renderer. The composed-platform half
 * (transactional preview, newsletter render) is not this assertion.
 */
export function evaluateA5Package(probe: EmailProbe | null): AssertionResult {
  const id = 'A5-package';
  if (probe === null) return fail(id, 'the e-mail probe wrote no result');
  if (!probe.html.includes(`${MARKER}Gold`)) return fail(id, 'the rendered HTML has no marker');
  if (!probe.text.includes(`${MARKER}Gold`)) return fail(id, 'the rendered text has no marker');
  if (probe.htmlWithoutRenderers.includes(MARKER)) {
    return fail(id, 'the marker rendered with no contributed renderer, so the probe proves nothing');
  }
  return pass(id, 'the packed ./email layer renders the marker in HTML and in text');
}

/** A8, e-mail half — a throwing renderer contributes nothing, is reported, and the rest renders. */
export function evaluateA8Package(probe: EmailProbe | null): AssertionResult {
  const id = 'A8-package';
  if (probe === null) return fail(id, 'the e-mail probe wrote no result');
  if (probe.explodingHtml.includes(`${MARKER}Exploding`) || probe.explodingText.includes(`${MARKER}Exploding`)) {
    return fail(id, 'the renderer that was forced to throw contributed output anyway');
  }
  for (const sibling of ['Before', 'After']) {
    if (!probe.explodingHtml.includes(`${MARKER}${sibling}`)) {
      return fail(id, `the sibling block "${sibling}" is missing from the HTML`);
    }
  }
  if (!probe.reported.includes(FIXTURE_BLOCK)) {
    return fail(id, 'the failure was not reported through onBlockError');
  }
  return pass(id, 'the throwing renderer contributed nothing, was reported, and both siblings rendered');
}

/** One rendered message, as an admin route answered it. */
export interface RenderedPair {
  readonly status: number;
  readonly html: string;
  readonly text: string;
}

/** What one platform process, booted after an activation flip, answered. */
export interface PlatformObservation {
  readonly active: boolean;
  /** The descriptor's entry for the block, or `null` when the descriptor does not declare it. */
  readonly descriptorEntry: Record<string, unknown> | null;
  readonly descriptorStatus: number;
  readonly transactional: RenderedPair;
  readonly transactionalExploding: RenderedPair;
  readonly newsletter: RenderedPair;
  /** The campaign's stored content, serialised as the platform returned it. */
  readonly storedCampaignContent: string;
  /** Saving transactional content that holds the block: the save route's status. */
  readonly saveStatus: number;
}

function rendersMarker(pair: RenderedPair, text: string): boolean {
  return pair.status === 200 && pair.html.includes(`${MARKER}${text}`) && pair.text.includes(`${MARKER}${text}`);
}

/**
 * A5, platform half — the composed platform renders the block in a
 * transactional preview and in a newsletter preview, HTML and text, and lets
 * content holding it be saved.
 */
export function evaluateA5Platform(on: PlatformObservation | null): AssertionResult {
  const id = 'A5-platform';
  if (on === null) return fail(id, 'the platform probe answered nothing with the module on');
  if (on.saveStatus !== 200) {
    return fail(id, `saving transactional content holding the block answered ${String(on.saveStatus)}`);
  }
  if (!rendersMarker(on.transactional, 'Gold')) {
    return fail(id, `the transactional preview (${String(on.transactional.status)}) lacks the marker in HTML or text`);
  }
  if (!rendersMarker(on.newsletter, 'Gold')) {
    return fail(id, `the newsletter preview (${String(on.newsletter.status)}) lacks the marker in HTML or text`);
  }
  return pass(id, 'a transactional preview and a newsletter preview both carry the marker, in HTML and in text');
}

/** A6, e-mail half — with the module off both messages still render, without the block. */
export function evaluateA6Email(off: PlatformObservation | null): AssertionResult {
  const id = 'A6-email';
  if (off === null) return fail(id, 'the platform probe answered nothing with the module off');
  for (const [name, pair] of [['transactional', off.transactional], ['newsletter', off.newsletter]] as const) {
    if (pair.status !== 200) return fail(id, `the ${name} preview answered ${String(pair.status)} with the module off`);
    if (pair.html.includes(MARKER) || pair.text.includes(MARKER)) {
      return fail(id, `the ${name} preview still carries the block with its module off`);
    }
  }
  if (off.saveStatus !== 200) {
    return fail(id, `saving content that holds the block answered ${String(off.saveStatus)} with the module off — off must be non-destructive`);
  }
  return pass(id, 'module off: both previews render without the block, and content holding it still saves');
}

/** A7, e-mail half — on again both render the block, and the stored campaign never changed. */
export function evaluateA7Email(
  on: PlatformObservation | null,
  off: PlatformObservation | null,
  again: PlatformObservation | null,
): AssertionResult {
  const id = 'A7-email';
  if (on === null || off === null || again === null) return fail(id, 'a platform phase answered nothing');
  if (!rendersMarker(again.transactional, 'Gold') || !rendersMarker(again.newsletter, 'Gold')) {
    return fail(id, 'the block did not render again once its module was switched back on');
  }
  if (on.storedCampaignContent === 'null' || on.storedCampaignContent === '') {
    return fail(id, 'the probe read back no stored campaign content to compare');
  }
  if (on.storedCampaignContent !== off.storedCampaignContent || on.storedCampaignContent !== again.storedCampaignContent) {
    return fail(id, 'the stored campaign content differs between the three phases');
  }
  return pass(id, 'on again: both previews carry the marker, and the stored campaign is byte-identical across on, off and on');
}

/** A8, platform e-mail — a renderer forced to throw costs the message that block only. */
export function evaluateA8Platform(on: PlatformObservation | null): AssertionResult {
  const id = 'A8-email';
  if (on === null) return fail(id, 'the platform probe answered nothing with the module on');
  const pair = on.transactionalExploding;
  if (pair.status !== 200) return fail(id, `the message with a throwing block answered ${String(pair.status)}`);
  if (pair.html.includes(`${MARKER}Exploding`) || pair.text.includes(`${MARKER}Exploding`)) {
    return fail(id, 'the renderer that was forced to throw contributed output anyway');
  }
  for (const sibling of ['Before', 'After']) {
    if (!pair.html.includes(`${MARKER}${sibling}`)) return fail(id, `the sibling block "${sibling}" is missing`);
  }
  return pass(id, 'the composed platform rendered the message without the throwing block and with both siblings');
}

/** What the admin probe, bundled and run inside the scaffolded instance, wrote. */
export interface AdminProbe {
  /** Module ids of the instance's generated registry that contribute a block. */
  readonly registryModules: readonly string[];
  /** The CMS editor composition over the descriptor served with the module on. */
  readonly cmsOn: string;
  /** The field keys the composed editor exposes for the block. */
  readonly cmsFields: readonly string[];
  /** The same stored document over the descriptor served with the module off. */
  readonly cmsOff: string;
  /** Whether the off composition offers the block for insertion. */
  readonly cmsOffInsertable: boolean;
  readonly cmsAgain: string;
  /** A sibling, a block forced to throw, a sibling — CMS editor composition. */
  readonly cmsExploding: string;
  /** The e-mail editor's canvas component for the block. */
  readonly emailCanvas: string;
  readonly documentBefore: string;
  readonly documentAfter: string;
}

export interface AdminBuildObservation {
  /** The instance's generated admin registry, as `endora generate` wrote it. */
  readonly registry: string;
  /** The instance's generated admin stylesheet. */
  readonly stylesheet: string;
  readonly buildExitCode: number;
  readonly buildOutput: string;
  /** Whether any file of the built admin bundle contains the marker. */
  readonly bundleHasMarker: boolean;
}

/** A2 — `endora generate` names the fixture's layers, and the admin builds with its renderer in the bundle. */
export function evaluateA2(observed: AdminBuildObservation): AssertionResult {
  if (observed.buildExitCode !== 0) {
    return fail(
      'A2',
      `the admin build exited ${String(observed.buildExitCode)}: ` +
        observed.buildOutput.trim().split('\n').slice(-6).join(' / ').slice(0, 900),
    );
  }
  if (!observed.registry.includes(`'${FIXTURE_PACKAGE}/admin'`)) {
    return fail('A2', 'the generated admin registry does not import the fixture\'s ./admin');
  }
  if (!observed.stylesheet.includes(`${FIXTURE_PACKAGE}/blocks.css`)) {
    return fail('A2', 'the generated admin stylesheet does not import the fixture\'s ./blocks.css');
  }
  if (!observed.bundleHasMarker) return fail('A2', 'the built admin bundle does not contain the marker');
  return pass('A2', 'endora generate named ./admin and ./blocks.css, the admin built, and its bundle contains the marker');
}

/** A3 — the CMS editor composition renders the marker and exposes the manifest's fields. */
export function evaluateA3(probe: AdminProbe | null, on: PlatformObservation | null): AssertionResult {
  if (probe === null) return fail('A3', 'the admin probe wrote no result');
  if (on === null || on.descriptorEntry === null) {
    return fail('A3', 'the platform\'s descriptor does not declare the block with the module on');
  }
  if (!probe.registryModules.includes(FIXTURE_MODULE_ID)) {
    return fail('A3', 'the instance\'s generated registry carries no block contribution of the fixture');
  }
  if (!probe.cmsOn.includes(`${MARKER}Gold`)) return fail('A3', 'the CMS editor composition did not render the marker');
  const declared = Object.keys((on.descriptorEntry['fields'] ?? {}) as Record<string, unknown>).sort();
  const exposed = [...probe.cmsFields].sort();
  if (declared.length === 0 || JSON.stringify(declared) !== JSON.stringify(exposed)) {
    return fail('A3', `the editor exposes [${exposed.join(', ')}], the manifest declares [${declared.join(', ')}]`);
  }
  if (!probe.emailCanvas.includes(`${MARKER}Gold`)) {
    return fail('A3', 'the e-mail editor canvas did not render the marker');
  }
  return pass('A3', 'the CMS editor composition and the e-mail canvas render the marker, and the editor exposes the manifest\'s fields');
}

/** A6, admin half — the descriptor drops the block, the stored node is a placeholder, and it is not insertable. */
export function evaluateA6Admin(probe: AdminProbe | null, off: PlatformObservation | null): AssertionResult {
  const id = 'A6-admin';
  if (probe === null) return fail(id, 'the admin probe wrote no result');
  if (off === null) return fail(id, 'the platform probe answered nothing with the module off');
  if (off.descriptorStatus !== 200) return fail(id, `the descriptor answered ${String(off.descriptorStatus)} with the module off`);
  if (off.descriptorEntry !== null) return fail(id, 'the descriptor still declares the block with its module off');
  if (probe.cmsOff.includes(MARKER)) return fail(id, 'the editor rendered the block with its module off');
  if (!probe.cmsOff.includes(FIXTURE_BLOCK)) return fail(id, 'the stored node is not a visible placeholder naming the block');
  if (probe.cmsOffInsertable) return fail(id, 'the block is still insertable with its module off');
  return pass(id, 'module off: the descriptor drops the block, the stored node is a named placeholder, and it is not insertable');
}

/** A7, admin half — on again the editor renders the block; the document it was given is unchanged. */
export function evaluateA7Admin(probe: AdminProbe | null, again: PlatformObservation | null): AssertionResult {
  const id = 'A7-admin';
  if (probe === null) return fail(id, 'the admin probe wrote no result');
  if (again === null || again.descriptorEntry === null) {
    return fail(id, 'the descriptor does not declare the block again after the module was switched back on');
  }
  if (!probe.cmsAgain.includes(`${MARKER}Gold`)) return fail(id, 'the editor did not render the block again');
  if (probe.documentBefore === '' || probe.documentBefore !== probe.documentAfter) {
    return fail(id, 'the stored document changed between the compositions');
  }
  return pass(id, 'on again: the editor renders the block and the stored document is byte-identical');
}

/** A8, admin half — a renderer forced to throw degrades its own block in the editor composition. */
export function evaluateA8Admin(probe: AdminProbe | null): AssertionResult {
  const id = 'A8-admin';
  if (probe === null) return fail(id, 'the admin probe wrote no result');
  for (const sibling of ['Before', 'After']) {
    if (!probe.cmsExploding.includes(`${MARKER}${sibling}`)) return fail(id, `the sibling block "${sibling}" is missing`);
  }
  if (probe.cmsExploding.includes(`${MARKER}Exploding`)) return fail(id, 'the block forced to throw rendered anyway');
  if (!probe.cmsExploding.includes(FIXTURE_BLOCK)) return fail(id, 'the failed block is not a placeholder naming it');
  return pass(id, 'the block forced to throw is a named placeholder and both siblings rendered');
}
