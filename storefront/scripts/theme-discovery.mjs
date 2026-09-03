/**
 * Theme discovery and analysis for this storefront instance.
 *
 * ## Why this file is here and not in a package
 *
 * It answers a question about **this instance**: which themes does this
 * storefront have? Only this instance can answer it, because the answer is the
 * union of the theme packages *it* has installed and the token blocks *its own*
 * stylesheet declares. A storefront that imported the answer from an
 * `@endora-commerce/*` package would be depending on the platform for a fact
 * about itself, which is the kit shape D-193 and D-195 refused.
 *
 * So this file, `generate-themes.mjs` and `check-themes.mjs` travel inside the
 * storefront as ordinary files. They are copied by the scaffold and owned
 * outright by whoever owns the storefront afterwards, who may delete them.
 * Nothing in the platform notices.
 *
 * ## Why plain `.mjs` and Node built-ins only
 *
 * The generator runs *before* anything is built, in a tree whose TypeScript
 * toolchain is the client's business rather than ours. Node built-ins and no
 * compile step is the only shape that survives being copied into a stranger's
 * repository.
 *
 * Normative: `specs/102-storefront-theme-discovery/contracts/instance-theme-registry.md`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A theme code, as a theme package declares it and as a sales channel stores
 * it. The same shape the backend's write schemas validate.
 */
export const THEME_CODE_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * A `:root[data-theme='<code>']` selector, in every spelling the pipeline
 * produces.
 *
 * The **unquoted** alternative is not defensive coding: the emitted stylesheet
 * is minified, and `lightningcss` rewrites `[data-theme='industria']` to
 * `[data-theme=industria]`. A parser that only knew the source spelling would
 * find zero blocks in the artefact it exists to read, which the exit-2
 * conditions would report as "nothing was read" rather than as a green — but it
 * would still be a check that never checked anything.
 */
const THEME_SELECTOR_RE =
  /:root\s*\[\s*data-theme\s*=\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z0-9_-]+))\s*\]/g;

/** The dark scope, in both spellings. Its position is what `dark-scope-shadowed` reads. */
const DARK_SCOPE_RE = /:root\s*\.is-dark\b/;

/** One CSS custom-property declaration. */
const DECLARATION_RE = /(--[A-Za-z0-9_-]+)\s*:/g;

// ---------------------------------------------------------------------------
// (1) The package half of the walk
// ---------------------------------------------------------------------------

/**
 * Every CSS target an `exports` map publishes, as `{ subpath, target }`.
 *
 * A theme's specifier is derived from the package's own map and from nothing
 * else — no convention, no filename guess, no `style` field. `"./theme.css"`,
 * `{ ".": "./theme.css" }`, `{ "./theme.css": { "default": "./theme.css" } }`
 * and a root conditions object all resolve; a wildcard subpath does not, because
 * a pattern names no single file to import.
 */
export function cssExportsOf(exportsField) {
  const found = [];
  const firstCssTarget = (value) => {
    if (typeof value === 'string') return value.endsWith('.css') ? value : null;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const nested of Object.values(value)) {
      const hit = firstCssTarget(nested);
      if (hit !== null) return hit;
    }
    return null;
  };

  if (typeof exportsField === 'string') {
    const target = firstCssTarget(exportsField);
    if (target !== null) found.push({ subpath: '.', target });
    return found;
  }
  if (exportsField === null || typeof exportsField !== 'object') return found;

  const keys = Object.keys(exportsField);
  const isSubpathMap = keys.some((key) => key === '.' || key.startsWith('./'));
  if (!isSubpathMap) {
    // A bare conditions object is the root export written the long way.
    const target = firstCssTarget(exportsField);
    if (target !== null) found.push({ subpath: '.', target });
    return found;
  }
  for (const key of keys) {
    if (key !== '.' && !key.startsWith('./')) continue;
    if (key.includes('*')) continue;
    const target = firstCssTarget(exportsField[key]);
    if (target !== null) found.push({ subpath: key, target });
  }
  return found;
}

/**
 * The bare specifier that reaches a theme package's CSS, or `null` when its
 * `exports` map publishes none.
 *
 * A package publishing several CSS subpaths gets **one** `@import`, and which
 * one is the package's own statement rather than ours: a root export first — it
 * is the entry point the author nominated — then the first subpath in
 * declaration order. Emitting all of them would import a `.min.css` twin twice.
 */
export function themeSpecifierOf(packageName, exportsField) {
  const candidates = cssExportsOf(exportsField);
  if (candidates.length === 0) return null;
  const root = candidates.find((candidate) => candidate.subpath === '.');
  const chosen = root ?? candidates[0];
  return chosen.subpath === '.' ? packageName : packageName + chosen.subpath.slice(1);
}

/**
 * Every installed package that says it defines themes.
 *
 * The walk is one level of `node_modules` plus one level into each `@scope`,
 * which is exactly what a direct dependency of this storefront looks like under
 * both pnpm (a symlink per declared dependency) and npm (a flat tree). Nothing
 * here is a list of package names: a theme package is recognised by its own
 * `endora.themes` block, the same way a module package is recognised by its own
 * `endora.type`.
 */
export function discoverThemePackages(nodeModulesDir) {
  const packages = [];
  let filesRead = 0;

  const readManifest = (dir) => {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      filesRead += 1;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const entriesOf = (dir) => {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  };

  const candidateDirs = [];
  for (const entry of entriesOf(nodeModulesDir)) {
    if (entry.startsWith('.')) continue;
    const path = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      for (const scoped of entriesOf(path)) {
        if (scoped.startsWith('.')) continue;
        candidateDirs.push({ name: `${entry}/${scoped}`, dir: join(path, scoped) });
      }
      continue;
    }
    candidateDirs.push({ name: entry, dir: path });
  }

  for (const candidate of candidateDirs) {
    let real;
    try {
      real = statSync(candidate.dir);
    } catch {
      continue;
    }
    if (!real.isDirectory()) continue;
    const manifest = readManifest(candidate.dir);
    const declared = manifest?.endora?.themes;
    if (!Array.isArray(declared) || declared.length === 0) continue;
    const codes = declared.filter((code) => typeof code === 'string' && THEME_CODE_RE.test(code));
    packages.push({
      name: typeof manifest.name === 'string' ? manifest.name : candidate.name,
      dir: candidate.dir,
      declared,
      codes,
      specifier: themeSpecifierOf(
        typeof manifest.name === 'string' ? manifest.name : candidate.name,
        manifest.exports,
      ),
    });
  }

  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { packages, filesRead };
}

// ---------------------------------------------------------------------------
// (2) The stylesheet half of the walk
// ---------------------------------------------------------------------------

/**
 * Every `:root[data-theme='<code>']` block in a stylesheet, with the byte
 * offset of its selector and the custom properties it sets.
 *
 * These blocks contain only declarations (a theme that styles an element is
 * outside the contract), so the first `}` after the opening brace closes them.
 * A selector list — `:root[data-theme=a],:root[data-theme=b]{…}`, which the
 * minifier produces for two identical blocks — yields one entry per code over
 * the same declarations, which is what it means.
 */
export function parseThemeBlocks(cssText) {
  const blocks = [];
  THEME_SELECTOR_RE.lastIndex = 0;
  let match;
  while ((match = THEME_SELECTOR_RE.exec(cssText)) !== null) {
    const code = match[1] ?? match[2] ?? match[3];
    if (code === undefined || code === '') continue;
    const open = cssText.indexOf('{', match.index);
    if (open === -1) continue;
    const close = cssText.indexOf('}', open);
    if (close === -1) continue;
    const body = cssText.slice(open + 1, close);
    const declarations = [];
    DECLARATION_RE.lastIndex = 0;
    let declaration;
    while ((declaration = DECLARATION_RE.exec(body)) !== null) declarations.push(declaration[1]);
    blocks.push({ code, index: match.index, declarations: [...new Set(declarations)] });
  }
  return blocks;
}

/** Byte offset of the dark scope rule, or `-1` when the stylesheet has none. */
export function darkScopeIndexOf(cssText) {
  return cssText.search(DARK_SCOPE_RE);
}

// ---------------------------------------------------------------------------
// (3) The findings
// ---------------------------------------------------------------------------

/**
 * The two findings that are decidable from the package walk alone, so the
 * generator can refuse before it writes an artefact and the check can refuse a
 * hand-edited one.
 */
export function analysePackages(packages) {
  const findings = [];
  const owners = new Map();

  for (const pkg of packages) {
    if (pkg.specifier === null) {
      findings.push({
        finding: 'unresolvable-theme-css',
        code: pkg.declared.join(', '),
        package: pkg.name,
        message:
          `package "${pkg.name}" declares endora.themes [${pkg.declared.join(', ')}] but its ` +
          `exports map publishes no CSS subpath, so the theme would be declared and never ` +
          `rendered. Publish the stylesheet, e.g. "exports": { "./theme.css": "./theme.css" }.`,
      });
    }
    for (const code of pkg.codes) {
      const already = owners.get(code);
      if (already !== undefined) {
        findings.push({
          finding: 'duplicate-theme',
          code,
          package: `${already}, ${pkg.name}`,
          message:
            `theme "${code}" is declared by both "${already}" and "${pkg.name}". Two blocks ` +
            `under one selector means the later import wins, which is a brand chosen by ` +
            `install order. Uninstall one.`,
        });
        continue;
      }
      owners.set(code, pkg.name);
    }
  }
  return findings;
}

/**
 * The four findings that need the emitted stylesheet, plus the two above.
 *
 * `stylesheets` is `[{ path, css }]` — every emitted stylesheet, each analysed
 * on its own. **Cross-file document order is deliberately not decided here**:
 * which chunk a browser applies after which is a link-order question the
 * artefacts do not answer, so `dark-scope-shadowed` is judged inside the file
 * that carries the dark scope, which is the file the instance's own
 * `globals.css` compiles into.
 */
export function analyseThemes({ registryCodes, defaultCode, stylesheets, packages }) {
  const findings = [...analysePackages(packages)];
  const blocks = [];
  for (const sheet of stylesheets) {
    const darkIndex = darkScopeIndexOf(sheet.css);
    for (const block of parseThemeBlocks(sheet.css)) {
      blocks.push({ ...block, path: sheet.path, darkIndex });
    }
  }

  const packageOf = new Map();
  for (const pkg of packages) for (const code of pkg.codes) packageOf.set(code, pkg.name);
  const named = (code) => {
    const owner = packageOf.get(code);
    return owner === undefined ? '' : ` (from package "${owner}")`;
  };

  const emittedCodes = new Set(blocks.map((block) => block.code));
  const registry = new Set(registryCodes);

  // (a) undefined-theme — declared, and nothing renders it.
  for (const code of registryCodes) {
    if (emittedCodes.has(code)) continue;
    findings.push({
      finding: 'undefined-theme',
      code,
      package: packageOf.get(code) ?? null,
      message:
        `theme "${code}"${named(code)} is in the registry but the emitted stylesheet has no ` +
        `:root[data-theme='${code}'] block, so a channel naming it would render unbranded.`,
    });
  }

  // (b) unregistered-theme — emitted, and nothing declares it.
  for (const code of [...emittedCodes].sort()) {
    if (registry.has(code)) continue;
    findings.push({
      finding: 'unregistered-theme',
      code,
      package: null,
      message:
        `the emitted stylesheet defines :root[data-theme='${code}'] but no registry entry ` +
        `declares it, so this storefront renders a theme it does not know it has. Re-run the ` +
        `generator, or remove the hand-written import.`,
    });
  }

  // (c) partial-theme — the expected set is the default theme's own block, on
  //     every run. An instance that adds a primitive to its design system tells
  //     its theme authors by failing, with the missing names in the message.
  const defaultBlock = blocks.find((block) => block.code === defaultCode);
  if (defaultBlock !== undefined) {
    const expected = defaultBlock.declarations;
    for (const block of blocks) {
      if (block.code === defaultCode) continue;
      const missing = expected.filter((name) => !block.declarations.includes(name));
      if (missing.length === 0) continue;
      findings.push({
        finding: 'partial-theme',
        code: block.code,
        package: packageOf.get(block.code) ?? null,
        message:
          `theme "${block.code}"${named(block.code)} sets ${block.declarations.length} of the ` +
          `${expected.length} primitives the default theme "${defaultCode}" sets, so it renders ` +
          `half-branded. Missing: ${missing.join(', ')}.`,
      });
    }
  }

  // (d) dark-scope-shadowed — both selectors have specificity (0,2,0), so
  //     document order decides and a late import silently disables dark mode.
  for (const block of blocks) {
    if (block.darkIndex === -1 || block.index < block.darkIndex) continue;
    findings.push({
      finding: 'dark-scope-shadowed',
      code: block.code,
      package: packageOf.get(block.code) ?? null,
      message:
        `:root[data-theme='${block.code}']${named(block.code)} follows :root.is-dark in ` +
        `${block.path}. Both selectors have specificity (0,2,0), so document order decides and ` +
        `this block silently disables dark mode for every channel on this theme. Import it ` +
        `above the dark scope.`,
    });
  }

  return { findings, blocks, emittedCodes: [...emittedCodes].sort() };
}
