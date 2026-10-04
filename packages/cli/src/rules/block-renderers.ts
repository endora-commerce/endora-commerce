/**
 * `check:block-renderers` — a module package's Page Builder renderers stay in
 * their lane (`specs/141-module-block-renderers/contracts/block-renderers.md`
 * §2.3, §2.4, R2.1, R3.1, R3.2, R4.1, R6.1; plan D11).
 *
 * ## Why this is a check and not a review checklist
 *
 * A module package may ship React that renders on a customer-facing storefront
 * (`./storefront`), functions that write into outgoing e-mail (`./email`), and a
 * stylesheet both the storefront and the admin load (`./blocks.css`). React has
 * no in-page sandbox, so the trust boundary is **installation** — and what can
 * be held statically is that each layer stays small and checkable: it draws only
 * the blocks its own manifest declares, imports only what its process can run,
 * injects HTML only through the sanctioned sanitiser, and styles only under its
 * own prefix. A third-party author runs the same analysis on their package with
 * `endora check`; this repository runs it over every module package it holds.
 *
 * ## One analysis, two hosts
 *
 * {@link describeBlockRendererPackage} reads one package off disk — from its
 * own `package.json`, `exports` map and build layout, never a spelled path —
 * and {@link checkBlockRenderers} is pure over what it read. The repository
 * host (`backend/scripts/check-block-renderers.ts`) supplies every module
 * package; `endora check` supplies the one a package declares.
 *
 * ## What each finding refuses
 *
 *  - `foreign-block-name` — a renderer keyed by a block another module owns.
 *    A block name states its owner (`<module>.<Name>`), so this is one package
 *    drawing another's block.
 *  - `undeclared-block` — a renderer for a name the package's own manifest does
 *    not declare, or does not declare for that surface's context.
 *  - `storefront-import` — the storefront layer importing outside its allowed
 *    set: anything server-only, the admin kit, the platform, another module.
 *  - `raw-html` — `dangerouslySetInnerHTML` whose value is not the return of
 *    `sanitizeRichHtml` in the same expression. Block props are untrusted.
 *  - `email-layer-import` — the e-mail layer importing React, a Node built-in
 *    or anything but the React-free e-mail renderer: the same function runs in
 *    the backend send path and in the admin's browser preview.
 *  - `unscoped-stylesheet` — `./blocks.css` reaching outside the module's own
 *    class prefix, or pulling in a stylesheet or a Tailwind directive.
 *  - `layer-without-subpath` — a layer's sources with no `exports` subpath, so
 *    the blocks would be placeholders on every surface with no error anywhere.
 *
 * ## What it cannot see, stated rather than discovered
 *
 * A renderer key that is not a string literal — a computed key — is not read.
 * The surfaces refuse a foreign name again at run time
 * (`withContributedBlocks`, `EmailBlockRendererRegistry.register`), so a
 * computed key is not a way round the rule, only round this check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { blockNameRe } from '@endora-commerce/contracts';
import ts from 'typescript';

import { declaredExports, readEmitLayout } from '../lib/module-packages.js';
import { nodeWorkspaceFs } from '../lib/workspace-packages.js';

export const PREFIX = '[block-renderers]';

export type BlockRendererFindingKind =
  | 'foreign-block-name'
  | 'undeclared-block'
  | 'storefront-import'
  | 'raw-html'
  | 'email-layer-import'
  | 'unscoped-stylesheet'
  | 'layer-without-subpath';

/** What an author does about each finding. Printed once per kind. */
export const REMEDIES: Readonly<Record<BlockRendererFindingKind, string>> = {
  'foreign-block-name':
    'A block name is `<moduleId>.<Name>` and a package renders only its own. Rename the key to ' +
    "this package's `endora.id`, or move the renderer into the module that owns the block.",
  'undeclared-block':
    "Declare the block in this module's manifest `blocks`, with the context this renderer is " +
    'for in its `contexts` (`cms` for the storefront and the CMS editor, `email` for e-mail), ' +
    'or remove the renderer.',
  'storefront-import':
    'A storefront layer imports only `react`, `react-dom`, `@puckeditor/core`, ' +
    '`@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`, ' +
    '`@endora-commerce/contracts` and its own files. Move what needs anything else behind an ' +
    'API the renderer fetches in an effect.',
  'raw-html':
    'Block props are untrusted input. Pass the value through `sanitizeRichHtml` from ' +
    '`@endora-commerce/cms-components` in the same expression: ' +
    '`dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }}`.',
  'email-layer-import':
    'An e-mail layer is pure: it imports only `@endora-commerce/email-components/render/*`, ' +
    '`@endora-commerce/contracts` and its own files. It runs in the backend send path and in ' +
    "the admin's browser, so React and Node built-ins are both out.",
  'unscoped-stylesheet':
    '`./blocks.css` is finished CSS scoped to the module: every selector carries a class ' +
    'prefixed with the module id (`.<id>-…`), and there is no `@import`, `@tailwind` or ' +
    '`@source`. Colours come from the storefront theme custom properties with fallbacks.',
  'layer-without-subpath':
    "Declare the layer in the package's `exports` map (`./storefront`, `./email`). A layer " +
    'the map does not publish is one no surface can import.',
};

export interface BlockRendererFinding {
  readonly kind: BlockRendererFindingKind;
  readonly packageName: string;
  readonly moduleId: string;
  /** Absolute path of the file the finding is in. */
  readonly path: string;
  readonly line: number;
  readonly detail: string;
}

/** One file a layer holds. */
export interface LayerFile {
  readonly path: string;
  readonly text: string;
}

/** One layer the package publishes, with the files it was read from. */
export interface RendererLayer {
  /** The directory the layer's files live in. Relative imports must stay inside it. */
  readonly directory: string;
  readonly files: readonly LayerFile[];
}

/** One module package, as this rule reads it. */
export interface BlockRendererPackage {
  readonly packageName: string;
  readonly moduleId: string;
  readonly packageRoot: string;
  /**
   * The module manifest's text — where the `blocks` it declares are read from —
   * or `null` when the package has none this run could read. Only needed when
   * the package contributes a renderer at all.
   */
  readonly manifest: LayerFile | null;
  /** `./storefront`, or `null` when the package publishes none. */
  readonly storefront: RendererLayer | null;
  /** `./email`, or `null`. */
  readonly email: RendererLayer | null;
  /** `./admin`, or `null`. Read for the `blocks` it contributes and nothing else. */
  readonly admin: RendererLayer | null;
  /** `./blocks.css`, or `null`. `text` is `null` when the declared file is not there. */
  readonly stylesheet: { readonly path: string; readonly text: string | null } | null;
  /** Layer sources that exist with no `exports` subpath publishing them. */
  readonly unpublishedLayers: readonly { readonly subpath: string; readonly entry: string }[];
  /** Every file this package's description opened, for the read line. */
  readonly filesRead: readonly string[];
}

export interface BlockRenderersResult {
  readonly findings: readonly BlockRendererFinding[];
  /** Renderer claims judged: a storefront or e-mail key, or an admin `blocks` entry. */
  readonly claims: number;
  /** Layers read across the population: storefront, e-mail and stylesheet. */
  readonly layersRead: number;
  /** Packages whose claims could not be judged because their manifest was unreadable. */
  readonly unreadableManifests: readonly string[];
  /** Declared `./blocks.css` files that are not in their package. */
  readonly missingStylesheets: readonly string[];
}

/* ------------------------------------------------------------------ the read */

const SOURCE_FILE_RE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;
const NOT_A_SOURCE_RE = /\.d\.[mc]?ts$|\.test\.[mc]?[tj]sx?$|\.spec\.[mc]?[tj]sx?$/;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkSources(directory: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory).sort();
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const path = join(directory, entry);
    if (isDirectory(path)) walkSources(path, out);
    else if (SOURCE_FILE_RE.test(entry) && !NOT_A_SOURCE_RE.test(entry)) out.push(path);
  }
  return out;
}

function readLayer(directory: string, filesRead: string[]): RendererLayer {
  const files = walkSources(directory).map((path) => {
    filesRead.push(path);
    return { path, text: readFileSync(path, 'utf8') };
  });
  return { directory, files };
}

/**
 * Where a declared `exports` target's sources live.
 *
 * A package that declares a build layout ships sources, and its layer is read
 * as sources: the target is taken back through `outDir` → `rootDir`. A package
 * with no build layout is a published one — `dist` is all it has — and the
 * layer is read where the target points.
 */
function layerDirectoryOf(
  packageRoot: string,
  target: string,
  emit: { readonly rootDir: string; readonly outDir: string } | null,
): string {
  const within = dirname(target.replace(/^\.\//, ''));
  if (emit === null) return join(packageRoot, ...within.split('/'));
  const prefix = emit.outDir === '' ? '' : `${emit.outDir}/`;
  const below =
    prefix !== '' && `${within}/`.startsWith(prefix) ? `${within}/`.slice(prefix.length) : `${within}/`;
  const source = emit.rootDir === '' ? below : `${emit.rootDir}/${below}`;
  return join(packageRoot, ...source.split('/').filter((segment) => segment !== ''));
}

const STOREFRONT_SUBPATH = './storefront';
const EMAIL_SUBPATH = './email';
const ADMIN_SUBPATH = './admin';
const STYLESHEET_SUBPATH = './blocks.css';
const ROOT_SUBPATH = '.';

/**
 * Read one module package off disk, from what the package says about itself.
 *
 * Returns `null` for a directory that is not a module package.
 */
export function describeBlockRendererPackage(packageRoot: string): BlockRendererPackage | null {
  const manifestPath = join(packageRoot, 'package.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const endora = manifest['endora'] as { type?: unknown; id?: unknown } | undefined;
  if (endora?.type !== 'module' || typeof endora.id !== 'string' || endora.id === '') return null;
  const packageName = typeof manifest['name'] === 'string' ? manifest['name'] : packageRoot;
  const filesRead: string[] = [manifestPath];

  const emit = readEmitLayout(packageRoot, packageName, nodeWorkspaceFs());
  const exportsMap = declaredExports(manifest);
  const sourceRoot =
    emit === null || emit.rootDir === ''
      ? packageRoot
      : join(packageRoot, ...emit.rootDir.split('/'));

  const layerFor = (subpath: string): RendererLayer | null => {
    const target = exportsMap.get(subpath);
    if (target === undefined) return null;
    const directory = layerDirectoryOf(packageRoot, target, emit);
    return isDirectory(directory) ? readLayer(directory, filesRead) : { directory, files: [] };
  };

  const storefront = layerFor(STOREFRONT_SUBPATH);
  const email = layerFor(EMAIL_SUBPATH);
  const admin = layerFor(ADMIN_SUBPATH);

  // A layer's sources with no subpath publishing them — only decidable for a
  // package that ships sources, which is where an author can still fix it.
  const unpublishedLayers: { subpath: string; entry: string }[] = [];
  if (emit !== null) {
    for (const subpath of [STOREFRONT_SUBPATH, EMAIL_SUBPATH]) {
      if (exportsMap.has(subpath)) continue;
      const directory = join(sourceRoot, subpath.slice(2));
      for (const name of ['index.ts', 'index.tsx']) {
        const entry = join(directory, name);
        if (existsSync(entry)) unpublishedLayers.push({ subpath, entry });
      }
    }
  }

  let stylesheet: BlockRendererPackage['stylesheet'] = null;
  const stylesheetTarget = exportsMap.get(STYLESHEET_SUBPATH);
  if (stylesheetTarget !== undefined) {
    const path = join(packageRoot, ...stylesheetTarget.replace(/^\.\//, '').split('/'));
    let text: string | null = null;
    try {
      text = readFileSync(path, 'utf8');
      filesRead.push(path);
    } catch {
      text = null;
    }
    stylesheet = { path, text };
  }

  // The manifest is opened only for a package that claims a renderer: the
  // declaration is what a claim is judged against, and a package with no claim
  // has nothing to judge.
  let moduleManifest: LayerFile | null = null;
  const rootTarget = exportsMap.get(ROOT_SUBPATH);
  if (rootTarget !== undefined && (storefront !== null || email !== null || admin !== null)) {
    const emitted = join(packageRoot, ...rootTarget.replace(/^\.\//, '').split('/'));
    const stem = join(
      layerDirectoryOf(packageRoot, rootTarget, emit),
      rootTarget.replace(/^.*\//, '').replace(/\.[mc]?js$/, ''),
    );
    const candidates = emit === null ? [emitted] : [`${stem}.ts`, `${stem}.tsx`, emitted];
    for (const candidate of candidates) {
      try {
        moduleManifest = { path: candidate, text: readFileSync(candidate, 'utf8') };
        filesRead.push(candidate);
        break;
      } catch {
        // try the next spelling
      }
    }
  }

  return {
    packageName,
    moduleId: endora.id,
    packageRoot,
    manifest: moduleManifest,
    storefront,
    email,
    admin,
    stylesheet,
    unpublishedLayers,
    filesRead,
  };
}

/* -------------------------------------------------------------- the analysis */

function parse(file: LayerFile): ts.SourceFile {
  const kind = /\.[mc]?[jt]sx$/.test(file.path)
    ? ts.ScriptKind.TSX
    : /\.[mc]?js$/.test(file.path)
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = member.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === name) {
      return member.initializer;
    }
  }
  return undefined;
}

/** The blocks a manifest declares, each with its contexts. `null` if none could be read. */
export function declaredBlocksOf(manifest: LayerFile): ReadonlyMap<string, ReadonlySet<string>> | null {
  const sf = parse(manifest);
  const declared = new Map<string, Set<string>>();
  let sawBlocks = false;
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const blocks = propertyOf(node, 'blocks');
      if (blocks !== undefined && ts.isArrayLiteralExpression(blocks)) {
        sawBlocks = true;
        for (const element of blocks.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const name = propertyOf(element, 'name');
          const contexts = propertyOf(element, 'contexts');
          if (name === undefined || !ts.isStringLiteralLike(name)) continue;
          const set = declared.get(name.text) ?? new Set<string>();
          if (contexts !== undefined && ts.isArrayLiteralExpression(contexts)) {
            for (const context of contexts.elements) {
              if (ts.isStringLiteralLike(context)) set.add(context.text);
            }
          }
          declared.set(name.text, set);
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return sawBlocks ? declared : null;
}

interface Claim {
  readonly name: string;
  readonly context: 'cms' | 'email';
  readonly path: string;
  readonly line: number;
  readonly surface: string;
}

/** Renderer keys: string-literal property names that are block names. */
function rendererKeys(layer: RendererLayer, context: 'cms' | 'email', surface: string): Claim[] {
  const claims: Claim[] = [];
  for (const file of layer.files) {
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ts.isStringLiteralLike(node.name) &&
        blockNameRe.test(node.name.text)
      ) {
        claims.push({ name: node.name.text, context, path: file.path, line: lineOf(sf, node), surface });
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return claims;
}

/** Admin `blocks` contributions: `{ name, context, component }` object literals. */
function adminBlockClaims(layer: RendererLayer): Claim[] {
  const claims: Claim[] = [];
  for (const file of layer.files) {
    // A text pre-filter: most admin files hold no block contribution, and a
    // contribution cannot be written without all three words.
    if (!file.text.includes('context') || !file.text.includes('component')) continue;
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const name = propertyOf(node, 'name');
        const context = propertyOf(node, 'context');
        const component = propertyOf(node, 'component');
        if (
          name !== undefined &&
          context !== undefined &&
          component !== undefined &&
          ts.isStringLiteralLike(name) &&
          ts.isStringLiteralLike(context) &&
          (context.text === 'cms' || context.text === 'email')
        ) {
          claims.push({
            name: name.text,
            context: context.text,
            path: file.path,
            line: lineOf(sf, node),
            surface: `the admin ${context.text === 'cms' ? 'CMS' : 'e-mail'} editor`,
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return claims;
}

interface ImportSite {
  readonly specifier: string;
  readonly path: string;
  readonly line: number;
}

function importsOf(layer: RendererLayer): ImportSite[] {
  const sites: ImportSite[] = [];
  for (const file of layer.files) {
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        sites.push({ specifier: node.moduleSpecifier.text, path: file.path, line: lineOf(sf, node) });
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments.length > 0
      ) {
        const argument = node.arguments[0]!;
        sites.push({
          specifier: ts.isStringLiteralLike(argument) ? argument.text : '<computed>',
          path: file.path,
          line: lineOf(sf, node),
        });
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return sites;
}

function isInside(directory: string, fromFile: string, specifier: string): boolean {
  const target = resolve(dirname(fromFile), specifier);
  const root = directory.endsWith(sep) ? directory : directory + sep;
  return target === directory || target.startsWith(root);
}

function isPackageOrSubpath(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

/** Contract §2.3. */
function storefrontImportAllowed(site: ImportSite, layer: RendererLayer): boolean {
  const { specifier } = site;
  if (specifier.startsWith('.')) return isInside(layer.directory, site.path, specifier);
  if (specifier === 'react-dom/server' || specifier.startsWith('react-dom/server')) return false;
  return (
    isPackageOrSubpath(specifier, 'react') ||
    isPackageOrSubpath(specifier, 'react-dom') ||
    isPackageOrSubpath(specifier, '@puckeditor/core') ||
    isPackageOrSubpath(specifier, '@endora-commerce/page-builder-core') ||
    isPackageOrSubpath(specifier, '@endora-commerce/cms-components') ||
    isPackageOrSubpath(specifier, '@endora-commerce/contracts')
  );
}

/** Contract §3 R3.2. */
function emailImportAllowed(site: ImportSite, layer: RendererLayer): boolean {
  const { specifier } = site;
  if (specifier.startsWith('.')) return isInside(layer.directory, site.path, specifier);
  return (
    specifier.startsWith('@endora-commerce/email-components/render/') ||
    isPackageOrSubpath(specifier, '@endora-commerce/contracts')
  );
}

/** `dangerouslySetInnerHTML` values that are not `{ __html: sanitizeRichHtml(…) }`. */
function rawHtmlSites(layer: RendererLayer): { path: string; line: number }[] {
  const sites: { path: string; line: number }[] = [];
  const sanitised = (value: ts.Expression | undefined): boolean => {
    if (value === undefined) return false;
    let expression = value;
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    if (!ts.isObjectLiteralExpression(expression)) return false;
    const html = propertyOf(expression, '__html');
    if (html === undefined || !ts.isCallExpression(html)) return false;
    const callee = html.expression;
    return (
      (ts.isIdentifier(callee) && callee.text === 'sanitizeRichHtml') ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === 'sanitizeRichHtml')
    );
  };
  for (const file of layer.files) {
    if (!file.text.includes('dangerouslySetInnerHTML')) continue;
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'dangerouslySetInnerHTML') {
        const initializer = node.initializer;
        const value =
          initializer !== undefined && ts.isJsxExpression(initializer)
            ? initializer.expression
            : undefined;
        if (!sanitised(value)) sites.push({ path: file.path, line: lineOf(sf, node) });
      } else if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
        node.name.text === 'dangerouslySetInnerHTML'
      ) {
        if (!sanitised(node.initializer)) sites.push({ path: file.path, line: lineOf(sf, node) });
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return sites;
}

/** At-rules whose block holds ordinary rules, so the walk descends into them. */
const DESCENDING_AT_RULES = new Set(['media', 'supports', 'container', 'layer']);

/** Contract §6 R6.1, over a stylesheet's text. One message per offence, with its line. */
export function stylesheetOffences(css: string, moduleId: string): { line: number; detail: string }[] {
  const offences: { line: number; detail: string }[] = [];
  // Comments out, newlines kept, so a reported line is the author's.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const scoped = new RegExp(`\\.${moduleId}(?:-|_|\\\\:)`);
  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;

  /** Each frame is whether the block it opens holds ordinary rules. */
  const stack: boolean[] = [];
  let preludeStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === ';' || char === '}') {
      const statement = text.slice(preludeStart, index).trim();
      const directive = /^@([a-zA-Z-]+)/.exec(statement);
      if (directive !== null && ['import', 'tailwind', 'source'].includes(directive[1]!.toLowerCase())) {
        offences.push({
          line: lineAt(preludeStart + text.slice(preludeStart).search(/\S/)),
          detail: `\`@${directive[1]}\` — the stylesheet must be finished CSS that pulls in nothing`,
        });
      }
      if (char === '}') stack.pop();
      preludeStart = index + 1;
      continue;
    }
    if (char !== '{') continue;

    const prelude = text.slice(preludeStart, index).trim();
    const line = lineAt(preludeStart + text.slice(preludeStart).search(/\S/));
    const holdsRules = stack.length === 0 || stack[stack.length - 1] === true;
    preludeStart = index + 1;

    if (prelude.startsWith('@')) {
      const name = (/^@([a-zA-Z-]+)/.exec(prelude)?.[1] ?? '').toLowerCase();
      if (name === 'keyframes') {
        const animation = prelude.replace(/^@keyframes\s+/i, '').trim();
        if (!animation.startsWith(`${moduleId}-`) && !animation.startsWith(`${moduleId}_`)) {
          offences.push({
            line,
            detail: `\`@keyframes ${animation}\` is a global name; prefix it with \`${moduleId}-\``,
          });
        }
        stack.push(false);
      } else {
        stack.push(holdsRules && DESCENDING_AT_RULES.has(name));
      }
      continue;
    }

    if (holdsRules) {
      for (const selector of splitSelectors(prelude)) {
        if (selector === '' || scoped.test(selector)) continue;
        offences.push({
          line,
          detail:
            `selector \`${selector}\` is not under a class prefixed with the module id ` +
            `(\`.${moduleId}-…\`), so it styles the storefront and the admin outside this module's blocks`,
        });
      }
    }
    // A style rule's own block: declarations, or nested rules scoped by this one.
    stack.push(false);
  }
  return offences;
}

function splitSelectors(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of prelude) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      selectors.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  selectors.push(current.trim());
  return selectors;
}

/** The analysis: pure over what {@link describeBlockRendererPackage} read. */
export function checkBlockRenderers(packages: readonly BlockRendererPackage[]): BlockRenderersResult {
  const findings: BlockRendererFinding[] = [];
  const unreadableManifests: string[] = [];
  const missingStylesheets: string[] = [];
  let claimCount = 0;
  let layersRead = 0;

  for (const pkg of packages) {
    const finding = (
      kind: BlockRendererFindingKind,
      path: string,
      line: number,
      detail: string,
    ): void => {
      findings.push({ kind, packageName: pkg.packageName, moduleId: pkg.moduleId, path, line, detail });
    };

    for (const unpublished of pkg.unpublishedLayers) {
      finding(
        'layer-without-subpath',
        unpublished.entry,
        1,
        `the package ships this layer and its \`exports\` map declares no \`${unpublished.subpath}\``,
      );
    }

    const claims: Claim[] = [
      ...(pkg.storefront === null ? [] : rendererKeys(pkg.storefront, 'cms', 'the storefront')),
      ...(pkg.email === null ? [] : rendererKeys(pkg.email, 'email', 'e-mail')),
      ...(pkg.admin === null ? [] : adminBlockClaims(pkg.admin)),
    ];
    claimCount += claims.length;

    if (claims.length > 0) {
      const declared = pkg.manifest === null ? null : declaredBlocksOf(pkg.manifest);
      for (const claim of claims) {
        const separator = claim.name.indexOf('.');
        const owner = separator > 0 ? claim.name.slice(0, separator) : '';
        if (!blockNameRe.test(claim.name) || owner !== pkg.moduleId) {
          finding(
            'foreign-block-name',
            claim.path,
            claim.line,
            `renders \`${claim.name}\` for ${claim.surface}, and this package is module \`${pkg.moduleId}\``,
          );
          continue;
        }
        if (declared === null) {
          if (!unreadableManifests.includes(pkg.packageName)) unreadableManifests.push(pkg.packageName);
          continue;
        }
        const contexts = declared.get(claim.name);
        if (contexts === undefined) {
          finding(
            'undeclared-block',
            claim.path,
            claim.line,
            `renders \`${claim.name}\` for ${claim.surface}, which this module's manifest does not declare`,
          );
        } else if (!contexts.has(claim.context)) {
          finding(
            'undeclared-block',
            claim.path,
            claim.line,
            `renders \`${claim.name}\` for ${claim.surface}, and the manifest declares it for ` +
              `[${[...contexts].sort().join(', ')}] — not \`${claim.context}\``,
          );
        }
      }
    }

    if (pkg.storefront !== null) {
      layersRead += 1;
      for (const site of importsOf(pkg.storefront)) {
        if (storefrontImportAllowed(site, pkg.storefront)) continue;
        finding(
          'storefront-import',
          site.path,
          site.line,
          `imports \`${site.specifier}\`, which a storefront layer may not`,
        );
      }
      for (const site of rawHtmlSites(pkg.storefront)) {
        finding(
          'raw-html',
          site.path,
          site.line,
          '`dangerouslySetInnerHTML` whose value is not `{ __html: sanitizeRichHtml(…) }`',
        );
      }
    }

    if (pkg.email !== null) {
      layersRead += 1;
      for (const site of importsOf(pkg.email)) {
        if (emailImportAllowed(site, pkg.email)) continue;
        finding(
          'email-layer-import',
          site.path,
          site.line,
          `imports \`${site.specifier}\`, which an e-mail layer may not`,
        );
      }
    }

    if (pkg.stylesheet !== null) {
      if (pkg.stylesheet.text === null) {
        missingStylesheets.push(pkg.stylesheet.path);
      } else {
        layersRead += 1;
        for (const offence of stylesheetOffences(pkg.stylesheet.text, pkg.moduleId)) {
          finding('unscoped-stylesheet', pkg.stylesheet.path, offence.line, offence.detail);
        }
      }
    }
  }

  return { findings, claims: claimCount, layersRead, unreadableManifests, missingStylesheets };
}

/** How many renderer layers a package declares — the expectation the read is held to. */
export function declaredLayerCount(pkg: BlockRendererPackage): number {
  return (
    (pkg.storefront === null ? 0 : 1) + (pkg.email === null ? 0 : 1) + (pkg.stylesheet === null ? 0 : 1)
  );
}

/** A package-relative display path. */
export function displayPath(pkg: BlockRendererPackage, path: string): string {
  return relative(pkg.packageRoot, path).split(sep).join('/');
}
