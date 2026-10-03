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
export function evaluateA8Email(probe: EmailProbe | null): AssertionResult {
  const id = 'A8-email';
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
