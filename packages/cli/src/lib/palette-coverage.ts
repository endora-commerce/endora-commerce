/**
 * Command-palette coverage of the admin surfaces modules contribute
 * (Principle XVI; issue #510).
 *
 * The rule and its escape hatch are stated once, in
 * `specs/conventions/module-admin-surfaces.md` § *Command palette*, item 7.
 * This file is the derivation: it takes the declarations as data, so the red
 * proofs in `admin/test/unit/palette-coverage.test.ts` enter at the top of the
 * analysis, exactly where the real registry and the real manifests enter.
 *
 * **One analysis, two readers** (`specs/190-overlay-full-modules/` FR-085,
 * `contracts/overlay-admin-layer.md` §4). It lived in `admin/test/helpers/`
 * until overlay modules gained admin layers, and moved here because a client's
 * instance has to ask the same question of its own overlay modules and runs no
 * admin test: `endora generate` asks it, per deployment, through
 * {@link deploymentPaletteCoverage}. This repository's admin test asks it over
 * every deployment on disk.
 *
 * A **destination** is a static admin path a module contributes as a route, or
 * as the `to` of one of its sidebar entries. A path with a `:param` or a `*`
 * segment is a detail or catch-all screen and is never a destination: a palette
 * action cannot target it (`ModuleActionSchema`'s route regex refuses both
 * characters), and it is reached from its parent list.
 *
 * A destination is **covered** when some manifest action — any module's, the
 * palette is one list — declares it as its `targetRoute`. Which code that action
 * must carry is `check:action-route-permissions`' question and is deliberately
 * not asked again here.
 *
 * Three classes of destination, three treatments:
 *  - a **landing** route (`index: true`) must be covered, without exception —
 *    that is Principle XVI itself;
 *  - a **sidebar** destination must be covered, without exception — a sidebar
 *    entry is top-level by definition, and "sidebar-only is not enough";
 *  - **any other** static route must be covered or carry an exemption, with a
 *    reason, saying why it is not a top-level screen.
 *
 * And one rule per module rather than per destination (issue #82): a module
 * that contributes an admin **page** — any route, or any sidebar entry —
 * declares at least one palette action **of its own**. Coverage alone cannot
 * see a module whose screens are advertised only by another module's actions,
 * or whose pages are all parameterised; both leave the module without a
 * palette presence of its own, and removing the other module would leave its
 * screens unreachable from ⌘K. A module contributing only zones has no page
 * and is not asked. There is no exemption: when the rule landed every module
 * complied, and the precedent of the sidebar ledger (issue #516) is that a
 * shrink-only ledger with nothing in it is removed with its code path rather
 * than kept as an invitation.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { parseSource } from './parsed-source.js';

/** The parts of a contributed route the rule reads. */
export interface CoverageRoute {
  readonly path: string;
  readonly index?: boolean | undefined;
}

/** The parts of a contributed sidebar entry the rule reads. */
export interface CoverageNav {
  readonly to: string;
}

/** One module's admin surface: what `MODULE_ADMIN_CONTRIBUTIONS` carries. */
export interface CoverageSurface {
  readonly moduleId: string;
  readonly routes: readonly CoverageRoute[];
  readonly nav: readonly CoverageNav[];
}

/** The parts of a manifest action the rule reads. */
export interface CoverageAction {
  readonly moduleId: string;
  readonly id: string;
  readonly targetRoute: string;
}

/** `<moduleId>` → `<path>` → the reason, in words a reviewer can disagree with. */
export type PaletteLedger = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type PaletteCoverageFindingKind =
  | 'uncovered-landing'
  | 'uncovered-sidebar-entry'
  | 'uncovered-destination'
  | 'module-without-action'
  | 'stale-exemption'
  | 'entry-without-reason';

export interface PaletteCoverageFinding {
  readonly kind: PaletteCoverageFindingKind;
  readonly moduleId: string;
  readonly path: string;
}

/** A path a palette action could target: no parameter, no wildcard. */
export function isStaticAdminPath(path: string): boolean {
  return !path.split('/').some((segment) => segment.startsWith(':') || segment.includes('*'));
}

/** The minimum length a reason must have to say something. */
const MIN_REASON_LENGTH = 20;

type DestinationClass = 'landing' | 'sidebar' | 'other';

export function paletteCoverageFindings(input: {
  readonly surfaces: readonly CoverageSurface[];
  readonly actions: readonly CoverageAction[];
  /** Static, non-sidebar, non-landing routes that are deliberately not palette targets. */
  readonly exemptions: PaletteLedger;
}): PaletteCoverageFinding[] {
  const findings: PaletteCoverageFinding[] = [];
  const covered = new Set(input.actions.map((action) => action.targetRoute));
  const modulesWithActions = new Set(input.actions.map((action) => action.moduleId));
  const usedExemptions = new Set<string>();
  const key = (moduleId: string, path: string): string => `${moduleId} ${path}`;

  for (const surface of input.surfaces) {
    const destinations = new Map<string, DestinationClass>();
    for (const route of surface.routes) {
      if (!isStaticAdminPath(route.path)) continue;
      destinations.set(route.path, route.index === true ? 'landing' : 'other');
    }
    for (const entry of surface.nav) {
      if (!isStaticAdminPath(entry.to)) continue;
      if (destinations.get(entry.to) !== 'landing') destinations.set(entry.to, 'sidebar');
    }

    for (const [path, destinationClass] of destinations) {
      if (covered.has(path)) continue;
      if (destinationClass === 'other' && input.exemptions[surface.moduleId]?.[path] !== undefined) {
        usedExemptions.add(key(surface.moduleId, path));
        continue;
      }
      findings.push({
        kind:
          destinationClass === 'landing'
            ? 'uncovered-landing'
            : destinationClass === 'sidebar'
              ? 'uncovered-sidebar-entry'
              : 'uncovered-destination',
        moduleId: surface.moduleId,
        path,
      });
    }

    const firstPage = surface.routes[0]?.path ?? surface.nav[0]?.to;
    if (firstPage !== undefined && !modulesWithActions.has(surface.moduleId)) {
      findings.push({ kind: 'module-without-action', moduleId: surface.moduleId, path: firstPage });
    }
  }

  for (const [moduleId, entries] of Object.entries(input.exemptions)) {
    for (const [path, reason] of Object.entries(entries)) {
      if (reason.trim().length < MIN_REASON_LENGTH) {
        findings.push({ kind: 'entry-without-reason', moduleId, path });
      }
      if (!usedExemptions.has(key(moduleId, path))) {
        findings.push({ kind: 'stale-exemption', moduleId, path });
      }
    }
  }

  return findings;
}

/** One line per finding, in the words a reader can act on. */
export function describeFinding(finding: PaletteCoverageFinding): string {
  const { moduleId, path } = finding;
  switch (finding.kind) {
    case 'uncovered-landing':
      return `${moduleId}: landing route ${path} has no palette action (no exemption possible)`;
    case 'uncovered-sidebar-entry':
      return `${moduleId}: sidebar entry ${path} has no palette action (no exemption possible)`;
    case 'uncovered-destination':
      return `${moduleId}: ${path} has no palette action — declare one, or exempt it with a reason`;
    case 'module-without-action':
      return `${moduleId}: contributes admin pages (${path} first) but declares no palette action of its own (no exemption possible)`;
    case 'stale-exemption':
      return `${moduleId}: exemption for ${path} no longer matches an uncovered non-sidebar route — delete it`;
    case 'entry-without-reason':
      return `${moduleId}: exemption for ${path} states no reason`;
  }
}

// ── the overlay readers (an instance's population) ─────────────────────────
//
// An overlay module's admin layer is `admin/index.tsx` — JSX, which no Node
// process can import — and an instance has no bundler to run before this
// question. So both halves of an overlay's population are read off the syntax
// tree: the `contributions` object literal and the manifest's `actions` array.
// A declaration the reader cannot evaluate is reported as unreadable, never
// skipped: a route this analysis did not see is a route it would call covered.

/** What one overlay admin layer contributes, and what could not be read. */
export interface OverlaySurfaceRead {
  readonly surface: CoverageSurface;
  readonly unreadable: readonly string[];
}

/** What one overlay manifest declares, and what could not be read. */
export interface OverlayActionsRead {
  readonly actions: readonly CoverageAction[];
  readonly unreadable: readonly string[];
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Top-level `const NAME = 'literal'` bindings, so a route path may be a constant. */
function stringConstantsOf(tree: ts.SourceFile): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const value = unwrap(declaration.initializer);
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        found.set(declaration.name.text, value.text);
      }
    }
  }
  return found;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === name) return property.initializer;
  }
  return null;
}

function stringValue(node: ts.Expression | null, constants: ReadonlyMap<string, string>): string | null {
  if (node === null) return null;
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isIdentifier(value)) return constants.get(value.text) ?? null;
  return null;
}

/** The object literal an `export const <name> = …` (or `<name> = call({ … })`) holds. */
function exportedObject(tree: ts.SourceFile, name: string, call: string | null): ts.ObjectLiteralExpression | null {
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (declaration.initializer === undefined) return null;
      let value = unwrap(declaration.initializer);
      if (
        call !== null &&
        ts.isCallExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === call &&
        value.arguments[0] !== undefined
      ) {
        value = unwrap(value.arguments[0]);
      }
      return ts.isObjectLiteralExpression(value) ? value : null;
    }
  }
  return null;
}

/** The elements of an array-valued property, or why they cannot be read. */
function objectElements(
  object: ts.ObjectLiteralExpression,
  name: string,
): readonly ts.ObjectLiteralExpression[] | 'absent' | 'unreadable' {
  const value = propertyOf(object, name);
  if (value === null) return 'absent';
  const array = unwrap(value);
  if (!ts.isArrayLiteralExpression(array)) return 'unreadable';
  const elements: ts.ObjectLiteralExpression[] = [];
  for (const element of array.elements) {
    const item = ts.isSpreadElement(element) ? null : unwrap(element);
    if (item === null || !ts.isObjectLiteralExpression(item)) return 'unreadable';
    elements.push(item);
  }
  return elements;
}

/** One overlay module's `admin/index.tsx`, read as a {@link CoverageSurface}. */
export function readOverlayAdminSurface(moduleId: string, file: string, source: string): OverlaySurfaceRead {
  const tree = parseSource(file, source);
  const constants = stringConstantsOf(tree);
  const unreadable: string[] = [];
  const routes: CoverageRoute[] = [];
  const nav: CoverageNav[] = [];
  const contributions = exportedObject(tree, 'contributions', null);
  if (contributions === null) {
    return {
      surface: { moduleId, routes, nav },
      unreadable: [`${file}: no \`export const contributions = { … }\` object literal`],
    };
  }
  const routeElements = objectElements(contributions, 'routes');
  if (routeElements === 'unreadable') unreadable.push(`${file}: routes is not an array literal`);
  else if (routeElements !== 'absent') {
    routeElements.forEach((route, index) => {
      const path = stringValue(propertyOf(route, 'path'), constants);
      if (path === null) {
        unreadable.push(`${file}: routes[${String(index)}].path is not a string literal or a same-file constant`);
        return;
      }
      const flag = propertyOf(route, 'index');
      routes.push(flag !== null && flag.kind === ts.SyntaxKind.TrueKeyword ? { path, index: true } : { path });
    });
  }
  const navElements = objectElements(contributions, 'nav');
  if (navElements === 'unreadable') unreadable.push(`${file}: nav is not an array literal`);
  else if (navElements !== 'absent') {
    navElements.forEach((entry, index) => {
      const to = stringValue(propertyOf(entry, 'to'), constants);
      if (to === null) {
        unreadable.push(`${file}: nav[${String(index)}].to is not a string literal or a same-file constant`);
        return;
      }
      nav.push({ to });
    });
  }
  return { surface: { moduleId, routes, nav }, unreadable };
}

/** One overlay module's `manifest.ts`, read for its palette actions. */
export function readOverlayManifestActions(moduleId: string, file: string, source: string): OverlayActionsRead {
  const tree = parseSource(file, source);
  const constants = stringConstantsOf(tree);
  const manifest = exportedObject(tree, 'manifest', 'defineModuleManifest');
  if (manifest === null) {
    return { actions: [], unreadable: [`${file}: no \`export const manifest\` object literal`] };
  }
  const elements = objectElements(manifest, 'actions');
  if (elements === 'absent') return { actions: [], unreadable: [] };
  if (elements === 'unreadable') return { actions: [], unreadable: [`${file}: actions is not an array literal`] };
  const actions: CoverageAction[] = [];
  const unreadable: string[] = [];
  elements.forEach((action, index) => {
    const id = stringValue(propertyOf(action, 'id'), constants);
    const targetRoute = stringValue(propertyOf(action, 'targetRoute'), constants);
    if (id === null || targetRoute === null) {
      unreadable.push(`${file}: actions[${String(index)}] has no literal id and targetRoute`);
      return;
    }
    actions.push({ moduleId, id, targetRoute });
  });
  return { actions, unreadable };
}

/** One deployment's palette coverage, as `endora generate` reports it. */
export interface DeploymentPaletteCoverage {
  readonly deployment: string;
  /** How many overlay admin layers were judged. */
  readonly surfaces: number;
  readonly findings: readonly PaletteCoverageFinding[];
  readonly unreadable: readonly string[];
}

function visibleDirectories(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Palette coverage of every deployment under `appsRoot`, each over its own
 * overlay modules (FR-085).
 *
 * The **surfaces** are that deployment's overlay admin layers; the **actions**
 * are that deployment's overlay manifests' and `installedActions` — the
 * installed packages' — because the palette is one list and a package's action
 * covers a route as well as the module's own. The packages' own surfaces are
 * not judged again: their release was, by this repository's admin test. No
 * exemption ledger is offered — a client's overlay route that is not a palette
 * target is one action away from compliance.
 */
export function deploymentPaletteCoverage(
  appsRoot: string,
  installedActions: readonly CoverageAction[],
): readonly DeploymentPaletteCoverage[] {
  const results: DeploymentPaletteCoverage[] = [];
  for (const deployment of visibleDirectories(appsRoot)) {
    const modulesRoot = join(appsRoot, deployment, 'modules');
    const surfaces: CoverageSurface[] = [];
    const actions: CoverageAction[] = [...installedActions];
    const unreadable: string[] = [];
    for (const moduleId of visibleDirectories(modulesRoot)) {
      const manifest = join(modulesRoot, moduleId, 'manifest.ts');
      if (existsSync(manifest)) {
        const read = readOverlayManifestActions(moduleId, manifest, readFileSync(manifest, 'utf8'));
        actions.push(...read.actions);
        unreadable.push(...read.unreadable);
      }
      const layer = join(modulesRoot, moduleId, 'admin', 'index.tsx');
      if (existsSync(layer)) {
        const read = readOverlayAdminSurface(moduleId, layer, readFileSync(layer, 'utf8'));
        surfaces.push(read.surface);
        unreadable.push(...read.unreadable);
      }
    }
    results.push({
      deployment,
      surfaces: surfaces.length,
      findings: paletteCoverageFindings({ surfaces, actions, exemptions: {} }),
      unreadable,
    });
  }
  return results;
}
