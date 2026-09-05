/**
 * What a packed tarball has to be true of before anybody publishes it.
 *
 * The judgement only — no `pnpm pack`, no child process, no filesystem. It
 * takes a {@link PackedPackage}: the tarball's entry list with a size each, the
 * `package.json` inside it as text, and the source manifest it was packed from.
 * That is the top of the analysis (issue #130), so a red proof enters where a
 * real run enters and every predicate below it is exercised; a fixture handing
 * in a pre-classified verdict would prove the printing and leave the rules
 * unproven.
 *
 * ## Why this exists at all, and why it is not a `check-*` script
 *
 * `pnpm run build:packages` and `pnpm -r run typecheck` both read the **source**
 * tree. Nothing in this repository reads what a consumer actually receives, and
 * the four things below are all invisible until an install somewhere else fails:
 *
 *   * a `dist` that is present and **empty**, which a type-check cannot see
 *     because the type-check is what would have written it;
 *   * a surviving `workspace:` range, which resolves perfectly in this
 *     workspace and resolves to nothing anywhere else;
 *   * an `exports` subpath whose target the `files` list does not carry, which
 *     is `ERR_PACKAGE_PATH_NOT_EXPORTED` at the first consumer and silence here;
 *   * a `bin` that does not run, which has already happened once — an entry
 *     guard comparing `import.meta.url` to `process.argv[1]` was false for
 *     every installed consumer, and `endora --help` printed **0 bytes and
 *     exited 0** out of a tarball. That is two findings rather than one, and
 *     the split is what makes either worth anything: `silent-bin` is the
 *     historical shape — exit 0, no output, indistinguishable from success —
 *     and `bin-does-not-run` is a non-zero exit, which is what an **undeclared
 *     runtime dependency** looks like once the binary is run with exactly the
 *     dependencies its packed manifest names. Measured while this gate was
 *     written: run with *no* `node_modules` at all, `endora --help` prints a
 *     1115-byte `ERR_MODULE_NOT_FOUND` stack trace, which satisfies a rule that
 *     only asks for output. A proof that a crash passes is not a proof.
 *
 * It is deliberately **not** a `check-*` script, on the boot gate's reasoning:
 * `check-read-size.test.ts` spawns every one of those, and packing 79 packages
 * inside a unit run is not a test. The runner is `backend/scripts/pack-gate.ts`
 * and its CI job is `pack-gate`; this file is the part a test can drive.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 * It does not resolve a subpath's *conditions* — a target is judged by the path
 * it names, so an `import`/`require` pair pointing at two files is two targets
 * and both must be present, which is right, but a condition that should have
 * existed and does not is invisible. It does not follow a wildcard subpath
 * (`"./i18n/*"`), because a wildcard names a directory shape rather than a file
 * and a tarball carrying none of it is a `files` question rather than an
 * `exports` one. It says nothing about whether the compiled code is *correct*;
 * that is `tsc`'s and the suite's. And it judges the tarball this run produced,
 * so a stale `dist` is a stale verdict — the runner builds first, and says so.
 */

/** One entry inside a packed tarball. `path` is tarball-relative, `package/` stripped. */
export interface PackedEntry {
  readonly path: string;
  readonly size: number;
}

/** One packed tarball, as the runner hands it in. */
export interface PackedPackage {
  /** The workspace member's name, from the source manifest. */
  readonly name: string;
  /** Repository-relative directory it was packed from. */
  readonly dir: string;
  /** The tarball's entries, `package/` already stripped from each path. */
  readonly entries: readonly PackedEntry[];
  /** `package/package.json`, verbatim, or `null` when the tarball carries none. */
  readonly manifestText: string | null;
  /**
   * What running the packed `bin` printed, or `null` for a package that
   * declares none.
   *
   * The runner supplies it because executing a binary is not a judgement; the
   * rule about it is, and it lives here with the other four.
   */
  readonly binRun: BinRun | null;
}

/** The result of running one packed executable. */
export interface BinRun {
  /** The `bin` name, as the manifest spells it. */
  readonly command: string;
  /** The path inside the tarball the manifest points at, `./` stripped. */
  readonly target: string;
  readonly exitCode: number;
  /** Everything the process wrote, both streams, concatenated. */
  readonly output: string;
}

export type PackFindingKind =
  | 'empty-artefact'
  | 'no-compiled-code'
  | 'workspace-range-survives'
  | 'unresolvable-export'
  | 'missing-packed-manifest'
  | 'bin-does-not-run'
  | 'silent-bin';

export interface PackFinding {
  readonly kind: PackFindingKind;
  /** The package the finding is about. Always a package name. */
  readonly subject: string;
  readonly message: string;
}

/** What one package's judgement examined, for the read line. */
export interface PackSiteCount {
  /** Export targets resolved, dependency ranges read, and bins run. */
  readonly sites: number;
}

export interface PackResult {
  readonly findings: readonly PackFinding[];
  readonly sites: number;
}

/**
 * Every declared `exports` target in a manifest, as tarball-relative paths.
 *
 * Walks the whole map rather than its top level, because a subpath's value is
 * either a string or a conditions object and both nest: `{"." : { types: …,
 * default: … }}` names two files, and judging only one of them would clear a
 * package whose `types` condition points at a `.d.ts` the `files` list drops —
 * which is the half a consumer's editor loses rather than their runtime, and
 * therefore the half nobody notices for a week.
 *
 * A **wildcard** subpath is skipped, and that is a bound rather than an
 * oversight: `"./i18n/*"` names a directory shape, so there is no single file
 * whose absence is a finding, and reporting the literal `dist/i18n/*` as
 * missing would be a finding about this function.
 */
export function exportTargets(exportsField: unknown): readonly string[] {
  const targets: string[] = [];
  const visit = (node: unknown, key: string | null): void => {
    if (typeof node === 'string') {
      if (key !== null && key.includes('*')) return;
      if (node.includes('*')) return;
      targets.push(node.replace(/^\.\//, ''));
      return;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
      // A subpath key carries the wildcard; a condition key ("types",
      // "default") never does, so the key under test is the one being entered.
      visit(child, childKey.startsWith('.') ? childKey : key);
    }
  };
  visit(exportsField, null);
  return [...new Set(targets)];
}

/**
 * Every `workspace:` range in a manifest, as `<field>.<name>` with its value.
 *
 * All four dependency fields, because `pnpm pack` rewrites all four and a
 * survivor in any of them is a range no registry can resolve. `peerDependencies`
 * matters most here and is the one a narrower reading would miss: a module
 * package declares its siblings as peers, which is where 467 of this
 * workspace's ranges live.
 */
export function workspaceRanges(
  manifest: Readonly<Record<string, unknown>>,
): readonly { readonly where: string; readonly range: string }[] {
  const found: { where: string; range: string }[] = [];
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const block = manifest[field];
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        found.push({ where: `${field}.${name}`, range });
      }
    }
  }
  return found;
}

/**
 * `bin`, in both spellings npm accepts, as `<command> -> <path>` pairs.
 *
 * The bare-string form takes the package's own name as the command, which is
 * npm's rule and not a convenience: a reader of the object form alone would
 * classify a correct executable as declaring none.
 */
export function binTargets(
  manifest: Readonly<Record<string, unknown>>,
): readonly { readonly command: string; readonly target: string }[] {
  const bin = manifest['bin'];
  const name = typeof manifest['name'] === 'string' ? manifest['name'] : '';
  const short = name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
  if (typeof bin === 'string' && bin.trim().length > 0) {
    return [{ command: short, target: bin.replace(/^\.\//, '') }];
  }
  if (typeof bin !== 'object' || bin === null || Array.isArray(bin)) return [];
  return Object.entries(bin as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([command, target]) => ({ command, target: target.replace(/^\.\//, '') }));
}

/**
 * Judge one packed tarball. Pure.
 *
 * Order matters in exactly one place: a tarball with no `package.json` is
 * reported once and judged no further, because every other rule reads that file
 * and four findings about one absence is four readers of one defect.
 */
export function judgePackedPackage(packed: PackedPackage): PackResult {
  if (packed.manifestText === null) {
    return {
      sites: 1,
      findings: [
        {
          kind: 'missing-packed-manifest',
          subject: packed.name,
          message:
            `(${packed.dir}) packed a tarball with no \`package/package.json\` in it. Nothing ` +
            'about the package can be judged from it and npm would refuse the publish, so ' +
            'this is reported instead of the four rules that read that file.',
        },
      ],
    };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(packed.manifestText) as Record<string, unknown>;
  } catch (error: unknown) {
    return {
      sites: 1,
      findings: [
        {
          kind: 'missing-packed-manifest',
          subject: packed.name,
          message:
            `(${packed.dir}) packed a \`package.json\` that does not parse (${String(error)}). ` +
            'A consumer\'s installer reads that file before anything else, so the package is ' +
            'unusable whatever else is in the tarball.',
        },
      ],
    };
  }

  const findings: PackFinding[] = [];
  const byPath = new Map(packed.entries.map((entry) => [entry.path, entry] as const));

  // 1 — a tarball with no compiled code in it. The failure `build:packages` not
  // having run produces, and the one a source-tree check cannot see by
  // construction: the type-check is what would have written the files it is
  // being asked about.
  const compiled = packed.entries.filter((entry) => entry.path.endsWith('.js'));
  if (compiled.length === 0) {
    findings.push({
      kind: 'no-compiled-code',
      subject: packed.name,
      message:
        `(${packed.dir}) packed ${String(packed.entries.length)} file(s) and not one of them ` +
        'is a `.js`. A published package with no compiled code installs cleanly and fails at ' +
        'the consumer\'s first import — run `pnpm run build:packages` before packing.',
    });
  }

  // 2 — a file that is there and is nothing. It satisfies every presence test
  // above and below, which is why it is a finding of its own rather than a
  // clause inside one.
  for (const entry of packed.entries) {
    if (entry.size === 0 && entry.path.endsWith('.js')) {
      findings.push({
        kind: 'empty-artefact',
        subject: packed.name,
        message:
          `(${packed.dir}) packed \`${entry.path}\` at zero bytes. It is present, so every ` +
          'presence test passes; it exports nothing, so a consumer importing it gets an empty ' +
          'module rather than an error.',
      });
    }
  }

  // 3 — a range that resolves in this workspace and nowhere else.
  for (const { where, range } of workspaceRanges(manifest)) {
    findings.push({
      kind: 'workspace-range-survives',
      subject: packed.name,
      message:
        `(${packed.dir}) packed \`${where}: ${range}\`. \`pnpm pack\` rewrites a workspace ` +
        'range to the sibling\'s exact version, so one that survived is one pnpm could not ' +
        'resolve — the consumer\'s installer reads `workspace:` as a protocol no registry ' +
        'serves and refuses the install.',
    });
  }

  // 4 — a subpath the `files` list does not carry. Invisible in this checkout,
  // because a workspace link resolves against the source directory where the
  // file does exist.
  const targets = exportTargets(manifest['exports']);
  for (const target of targets) {
    if (!byPath.has(target)) {
      findings.push({
        kind: 'unresolvable-export',
        subject: packed.name,
        message:
          `(${packed.dir}) declares an \`exports\` target \`${target}\` that the tarball does ` +
          'not carry. A consumer naming that subpath gets `ERR_PACKAGE_PATH_NOT_EXPORTED`; in ' +
          'this workspace the specifier resolves against the source directory, so nothing here ' +
          'would report it. Either the `files` list is short or the build did not emit it.',
      });
    }
  }

  // 5 — a `bin` that runs and says nothing. It is a finding rather than a
  // clause of rule 4 because the target being *present* is what rule 4 answers,
  // and the defect this exists for had the target present: the entry guard was
  // false for every installed consumer, so the process exited 0 having printed
  // nothing at all, which is indistinguishable from success.
  const bins = binTargets(manifest);
  for (const bin of bins) {
    if (!byPath.has(bin.target)) {
      findings.push({
        kind: 'unresolvable-export',
        subject: packed.name,
        message:
          `(${packed.dir}) declares \`bin.${bin.command}\` at \`${bin.target}\`, which the ` +
          'tarball does not carry. npm links the command and the link points at nothing.',
      });
    }
  }
  if (packed.binRun !== null && packed.binRun.exitCode !== 0) {
    findings.push({
      kind: 'bin-does-not-run',
      subject: packed.name,
      message:
        `(${packed.dir}) ran \`${packed.binRun.command} --help\` out of the extracted tarball ` +
        `with its declared dependencies linked, and it exited ` +
        `${String(packed.binRun.exitCode)}:\n${packed.binRun.output.trim().split('\n').slice(0, 6).join('\n')}` +
        '\nThe dependencies made available are exactly the ones the packed manifest declares, ' +
        'so a module-resolution failure here is a runtime dependency the manifest does not ' +
        'name — which resolves in this workspace and nowhere else.',
    });
  } else if (packed.binRun !== null && packed.binRun.output.trim().length === 0) {
    findings.push({
      kind: 'silent-bin',
      subject: packed.name,
      message:
        `(${packed.dir}) ran \`${packed.binRun.command}\` out of the extracted tarball and it ` +
        `printed nothing, exiting ${String(packed.binRun.exitCode)}. This has happened: an ` +
        'entry guard comparing `import.meta.url` to `process.argv[1]` was false for every ' +
        'installed consumer, because npm links the `bin` and the link is what `argv[1]` names ' +
        '— so the module was imported, ran no command, and exited 0. Zero bytes and exit 0 is ' +
        'the shape a passing run and a dead binary share.',
    });
  }

  return {
    findings,
    // One decision per export target resolved, per dependency range read, per
    // bin located, plus the run if there was one, plus the manifest itself.
    sites:
      1 +
      targets.length +
      dependencyRangeCount(manifest) +
      bins.length +
      (packed.binRun === null ? 0 : 1),
  };
}

/** Every dependency range read, workspace or not — the population rule 3 judged. */
function dependencyRangeCount(manifest: Readonly<Record<string, unknown>>): number {
  let total = 0;
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const block = manifest[field];
    if (typeof block === 'object' && block !== null && !Array.isArray(block)) {
      total += Object.keys(block as Record<string, unknown>).length;
    }
  }
  return total;
}

/** Judge every packed tarball, in the order they were handed in. */
export function judgePackedPackages(packages: readonly PackedPackage[]): PackResult {
  const findings: PackFinding[] = [];
  let sites = 0;
  for (const packed of packages) {
    const result = judgePackedPackage(packed);
    findings.push(...result.findings);
    sites += result.sites;
  }
  return { findings, sites };
}
