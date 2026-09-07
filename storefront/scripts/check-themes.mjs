#!/usr/bin/env node
/**
 * `check:themes` — what this instance declares and what it emits agree.
 *
 * ## Its subject is the emitted stylesheet, never `app/globals.css`
 *
 * A third-party theme's block does not exist in any source file of this
 * repository: it arrives through an `@import` and the CSS pipeline. A check
 * that read the source would report clean over a theme package with a broken
 * `exports` map, a dropped `@source` glob or a purged block — which is
 * `check:action-route-permissions`' `stale-artefact` exposure one surface over,
 * measured there three times in a row. So this reads the bytes the browser
 * receives, and refuses (exit 2) when there are none.
 *
 * ## Why it is not a `backend/scripts/check-*.ts`
 *
 * It judges a **storefront instance**, and after `endora new storefront` that
 * instance is a client's own repository. A platform instrument judging an
 * instance is precisely the coupling feature 102 exists to avoid, and this
 * file is not the client's copy of itself. It keeps the estate's grammar all
 * the same — a `read:` line, exit 2 for "nothing was read", one red proof per
 * finding — because a silent check is worth exactly as little in a stranger's
 * tree as it is here.
 *
 * Normative: `specs/102-storefront-theme-discovery/contracts/instance-theme-registry.md` §4.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { analyseThemes, discoverThemePackages } from './theme-discovery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const INSTANCE_ROOT = join(here, '..');

/**
 * Every path this check reads, from one root.
 *
 * `--root` re-bases them onto a fixture tree, which is how
 * `test/theme-registry.test.ts` proves the exit-2 conditions: each of them is a
 * state of the *inputs*, so a proof of one has to be able to supply the inputs.
 */
function pathsOf(root) {
  return {
    registry: join(root, 'lib', 'theme', 'themes.generated.ts'),
    instance: join(root, 'lib', 'theme', 'instance-themes.ts'),
    nodeModules: join(root, 'node_modules'),
    cssDir: join(root, '.next', 'static', 'css'),
  };
}

/** The codes out of the generated registry, read as the text of its one array literal. */
export function registryCodesOf(source) {
  const match = /INSTANCE_THEME_CODES\s*=\s*\[([^\]]*)\]/.exec(source);
  if (match === null) return [];
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((hit) => hit[1] ?? hit[2]);
}

/** The instance's default theme code, read as the text of its one constant. */
export function defaultCodeOf(source) {
  const match = /DEFAULT_STOREFRONT_THEME_CODE\s*(?::[^=]+)?=\s*'([^']+)'/.exec(source);
  return match === null ? null : match[1];
}

function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function emittedStylesheets(cssDir) {
  let entries;
  try {
    entries = readdirSync(cssDir).sort();
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.css'))
    .map((entry) => ({ path: join(cssDir, entry), css: readFileSync(join(cssDir, entry), 'utf8') }));
}

function refuse(message) {
  process.stderr.write(`[theme-registry] nothing was read: ${message}\n`);
  process.exit(2);
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const paths = pathsOf(rootFlag === -1 ? INSTANCE_ROOT : argv[rootFlag + 1]);
  const dirFlag = argv.indexOf('--css-dir');
  const cssDir = dirFlag === -1 ? paths.cssDir : argv[dirFlag + 1];
  const { registry: REGISTRY_TS, instance: INSTANCE_TS, nodeModules: NODE_MODULES } = paths;

  const registrySource = readIfPresent(REGISTRY_TS);
  const instanceSource = readIfPresent(INSTANCE_TS);
  const registryCodes = registrySource === null ? [] : registryCodesOf(registrySource);
  const defaultCode = instanceSource === null ? null : defaultCodeOf(instanceSource);
  const { packages, filesRead: manifestsRead } = discoverThemePackages(NODE_MODULES);
  const stylesheets = emittedStylesheets(cssDir);

  // (1) An empty registry makes every finding vacuously absent.
  if (registryCodes.length === 0) {
    refuse(
      `the registry at ${REGISTRY_TS} declares no theme code. Run ` +
        `\`pnpm --filter storefront run themes:generate\`.`,
    );
  }
  // (2) No emitted stylesheet — the artefact this check exists to read.
  if (stylesheets.length === 0) {
    refuse(
      `no emitted stylesheet under ${cssDir}. This check reads the bytes the browser gets, so ` +
        `it runs after the CSS build; run \`next build\` first, or pass --css-dir.`,
    );
  }
  // (3) A default this check cannot read makes `partial-theme` vacuously
  //     absent for every theme, which is the same green-that-means-not-looking
  //     as the two above. Not one of the three the contract enumerates; it is
  //     the same principle applied to the one input the contract's §3.3
  //     introduced after §4 was written.
  if (defaultCode === null) {
    refuse(
      `no DEFAULT_STOREFRONT_THEME_CODE in ${INSTANCE_TS}, so the primitive set every theme is ` +
        `held to has no author and \`partial-theme\` could not fire for anyone.`,
    );
  }

  const { findings, blocks, emittedCodes } = analyseThemes({
    registryCodes,
    defaultCode,
    stylesheets,
    packages,
  });

  // (4) A stylesheet with no `[data-theme]` block at all.
  if (blocks.length === 0) {
    refuse(
      `the emitted stylesheet under ${cssDir} contains no [data-theme] block. Either the CSS ` +
        `build dropped them or this check is reading the wrong artefact; a green here would ` +
        `mean "not looking".`,
    );
  }

  const registered = new Set(registryCodes);
  const emitted = new Set(emittedCodes);
  const registryCovered = registryCodes.filter((code) => emitted.has(code)).length;
  const emittedCovered = emittedCodes.filter((code) => registered.has(code)).length;
  const population = new Set([...registryCodes, ...emittedCodes]);
  const files = stylesheets.length + manifestsRead + (registrySource === null ? 0 : 1) + 1;

  process.stdout.write(
    `[theme-registry] read: files=${files} themes=${population.size} ` +
      `sources=registry:${registryCovered}/${registryCodes.length},` +
      `emitted-css:${emittedCovered}/${emittedCodes.length}\n`,
  );

  for (const finding of findings) {
    process.stderr.write(`[theme-registry] ${finding.finding}: ${finding.message}\n`);
  }
  if (findings.length > 0) {
    process.stderr.write(
      `[theme-registry] findings=${findings.length} over ${population.size} theme(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`[theme-registry] ok: findings=0\n`);
}

// Run only when this file *is* the program. The pure functions above are
// imported by `test/theme-registry.test.ts`, which must not spawn a check.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
