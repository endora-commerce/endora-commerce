/**
 * CI check — the admin zone mechanism's two-way refusal, plus the module ids
 * nothing else in this estate can read (feature 091, P4a;
 * `contracts/admin-component-contribution.md` §5 and §5.1/§9.3).
 *
 * ## The defect this exists for
 *
 * `AdminZoneNameSchema` promised a refusal in both directions from the day it
 * landed and had it in neither. Measured on the tree of 2026-08-31: all four of
 * its members were rendered by nothing and contributed to by nothing, and the
 * only thing that would ever have said so is this file. A contribution that
 * silently renders nowhere is worse than one that fails, and a name the
 * platform declares that no host screen renders is a promise to a module author
 * that nobody kept.
 *
 * `tsc` covers one corner of it — a first-party host writing
 * `<AdminZone name="typo">` does not compile — and covers none of the rest: an
 * installed module package is a host `tsc` never sees, `AdminZonePropsMap` can
 * be built somewhere other than `packages/contracts`, and the *absence* of a
 * render is not a type error anywhere.
 *
 * ## A sixth finding, and why it is here rather than beside
 *
 * `foreign-module-id` is one predicate — **a module id written as a string
 * literal, in a file the module does not own** — over three populations, and
 * the tree is what says they are one thing:
 * `orders`' `OrderShipmentsTab.tsx` carried
 * `useSurfaceVisibility()({ module: 'inpost' })` *and* `useTranslation('inpost')`.
 * (P7d retired both couplings and feature 091's batch 15 moved the file into
 * `packages/modules/orders/src/admin/components/`; the example is kept in the
 * past tense because it is what the finding was written from.)
 * Nothing in this estate reads either. `check:module-boundary` reads import
 * specifiers and a string names none; `check:admin-surface`'s subject is kit
 * symbols; `i18n:hardcoded` reads literals and not scopes. So a coupling
 * written as a string has been invisible in both spellings, and
 * `CategoryTreePicker` shipped for a whole phase rendering out of the `catalog`
 * namespace — found by a human reading a diff for an unrelated reason.
 *
 * The three populations:
 *
 *   1. a **host admin screen** calling the visibility predicate with a
 *      `{ module: '<id>' }` naming a module other than the file's owner;
 *   2. a **kit** source's `useTranslation('<id>')` — R6 of
 *      `admin-kit-surface.md` refuses module knowledge in the kit, and a
 *      translation namespace is module knowledge: the bundle behind it is
 *      shipped by a package the kit does not and may not depend on, resolved at
 *      runtime by string, with nothing holding the two together;
 *   3. a **module admin file**'s `useTranslation('<id>')` naming another module,
 *      **and an admin-ui package's**, which is the same predicate over a file
 *      that owns no module id at all (feature 091, P5c).
 *
 * That third population's roots are declarations, never paths: `admin/src` for
 * the application, every module walk root the layout derives — which reaches a
 * module package's own admin layer — plus every workspace member declaring
 * `endora: { type: 'admin-ui' }` other than the kit, which has population 2 and
 * its own R6 reasoning.
 *
 * **The module walk roots are here because the tree moved and this half did
 * not.** Renders and contributions came off `layout.moduleWalkRoots` from the
 * day P4a landed; the `foreign-module-id` walk read `admin/src` and the
 * admin-ui family and nothing else, which was one population when every admin
 * screen was the application's. Story 3 moves screens into their modules one
 * directory per merge request — 37 of the module packages ship an admin layer —
 * so a *packaged* module gating on another module's id, or rendering out of
 * another module's namespace, was seen by nothing in this estate. That is issue
 * #215's shape one surface over: the check was right when it was written, and
 * the population shrank out from under it, monotonically, with every batch. The
 * floor moved with it — see `module-admin` in `reportReadSize` below.
 *
 * **The admin-ui half of the same population was widened the other way round,
 * and the contrast is worth keeping.** P5c added it *before* P5b moved the
 * shared page-builder chrome and the e-mail builder into
 * `@endora-commerce/page-builder-admin`, because widening afterwards adds the
 * population that would have caught the move in the merge request that no
 * longer needs it. The module half is the case where nobody did that, and where
 * every batch since has widened what nothing was reading. The ledger's own
 * header records the exclusion P5c replaces:
 * `_shared`'s `useTranslation('cms')` was out of the population because
 * ownership comes from the route table and the nav and `_shared` is claimed by
 * neither — correct while the directory was the admin application's, and the
 * wrong answer once it is a package. A file in an admin-ui package is owned by
 * **no module**, so every registered module id it names is another module's,
 * and it is judged rather than excluded.
 *
 * Why a manifest field decides a check's population: `declaresAdminUi` in
 * `lib/workspace-packages.ts` carries the reasoning, D-171 included — the short
 * of it is that this declaration adds obligations and exempts nothing.
 *
 * `core` is not a module id and is therefore in none of them, which is not an
 * exemption written here but a consequence of the ids coming from the generated
 * manifest index: `core` is `_i18n`'s bundle under a synthetic alias. The
 * mirror population — module code rendering out of `core` — is real, larger and
 * deliberately not this check's; it is recorded in §9.2's last paragraph.
 *
 * A computed argument in the kit is a **finding, not a skip** (issue #113): a
 * namespace this analysis cannot read is a namespace it cannot clear, and
 * reporting it as clean is the shape the whole read-size estate exists to
 * refuse. The kit's own `src/i18n/useTranslation.ts` is exempt **by exact
 * path** — the `check:diacritic-folds` shape, one path and never a filename
 * rule, because a rule on the basename would exempt every file so named in the
 * repository and there is more than one.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 *   - a zone name reached through a constant (`useAdminZone(ZONE)`), which is
 *     `computed-zone-name` rather than a skip, by design (Z7);
 *   - a contribution built by a helper this file does not know — `zone:` in an
 *     object literal and `zoneComponent('<name>', …)` are the two spellings the
 *     kit publishes, and a third would read as no contribution at all;
 *   - a visibility gate whose predicate reaches the file through an import or a
 *     prop: the binding must be `useSurfaceVisibility()` or `isSurfaceVisible`
 *     in the same file;
 *   - a module id assembled at runtime, in any population.
 *
 * Usage: `tsx scripts/check-admin-zones.ts [--list]`
 * Exit 0 = every declared zone is rendered, every contribution lands somewhere,
 * and every foreign module id is ledgered;
 * exit 1 = at least one finding;
 * exit 2 = the check read nothing it needs — see {@link vacuousReason}.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  FOREIGN_MODULE_IDS,
  type ForeignModuleIdLedger,
} from './ledgers/foreign-module-ids.js';
import {
  adminApplicationPresent,
  adminRegistryPathOf,
  type AdminSurfaceLayout,
} from './lib/admin-surfaces.js';
import {
  adminRegistryPresent,
  moduleAdminLayers,
  packageSubpathSource,
} from './lib/module-admin-layers.js';
import {
  modulePopulationCoverage,
  vacuousModulePopulation,
} from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import {
  adminUiPackages,
  workspaceMembers,
  nodeWorkspaceFs,
} from './lib/workspace-packages.js';

/** The package whose sources are population 2, and the one file in it that is exempt. */
const KIT_PACKAGE = '@endora-commerce/admin-kit';
/**
 * The kit subpath that *is* the zone mechanism.
 *
 * Its own sources call `useAdminZone(name, props)` with the generic parameter
 * the renderer was handed, which is a computed name and correctly so: the
 * primitive forwards, it does not render a place. Judging the implementation of
 * a rule by the rule is how a mechanism refuses itself.
 *
 * Derived from the kit's `exports` map rather than spelled — `./zones` names
 * `dist/zones/index.js`, whose source is `src/zones` — so a kit that renames
 * the subpath moves this with it and a kit that stops declaring one leaves the
 * directory judged like any other.
 */
const ZONE_SUBPATH = './zones';
/**
 * The kit's own translation hook — exempt by **exact path**, never by filename.
 *
 * It is the file every message in population 2 tells an author to call, so a
 * rule on the basename would exempt any file so named anywhere in the tree, and
 * this repository has more than one `useTranslation.ts`. The path is relative
 * to the kit's own directory, which is derived; nothing here spells
 * `packages/admin-kit`.
 */
const KIT_TRANSLATION_HOOK = join('src', 'i18n', 'useTranslation.ts');

/** The file declaring the zone enum and its props map — located, never spelled. */
const ZONE_DECLARATION_FILE = join('src', 'admin-contributions.ts');
const CONTRACTS_PACKAGE = '@endora-commerce/contracts';

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const PRUNED = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.turbo']);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type AdminZoneFindingKind =
  | 'unrendered-zone'
  | 'contribution-to-unrendered-zone'
  | 'unpublished-zone'
  | 'computed-zone-name'
  | 'missing-props-type'
  | 'foreign-module-id';

export interface AdminZoneFinding {
  readonly kind: AdminZoneFindingKind;
  /** `<file>:<line>` for a site, the zone name for a declaration finding. */
  readonly key: string;
  readonly message: string;
}

/** One place a host renders a zone, or tries to. */
export interface ZoneRenderSite {
  readonly file: string;
  readonly line: number;
  /** The literal name, or `null` for a name this analysis could not read. */
  readonly zone: string | null;
  /** `<AdminZone>` or `useAdminZone` — for the message only. */
  readonly via: string;
}

/** One contribution a module declares. */
export interface ZoneContributionSite {
  readonly file: string;
  readonly line: number;
  readonly zone: string;
  /** The module that owns the declaring file, or `null` when unattributed. */
  readonly module: string | null;
}

/** One module id written as a string literal. */
/**
 * The three ways a module id gets written into a file the module does not own.
 *
 * This is a **value** and the type is derived from it, so a test can assert that
 * every one still has a classifier without keeping a second copy of the list. The
 * distinction that forced it: a population draining to **zero** is this feature
 * succeeding — `kit-namespace` emptied when !1231 moved `CategoryTreePicker`'s keys
 * to `core` — while a population the check stops *looking* for is the silent failure
 * the whole estate refuses. The ledger may shrink to nothing; this array may not.
 */
export const FOREIGN_ID_POPULATIONS = [
  'visibility-gate',
  'kit-namespace',
  'module-namespace',
] as const;

export type ForeignIdPopulation = (typeof FOREIGN_ID_POPULATIONS)[number];

export interface ModuleIdSite {
  readonly file: string;
  readonly line: number;
  /** The id named, or `null` for an argument this analysis could not read. */
  readonly named: string | null;
  /** The module that owns the file, or `null` for the kit and the admin host. */
  readonly owner: string | null;
  readonly population: ForeignIdPopulation;
}

export interface AdminZonesInput {
  /** Zone names `AdminZoneNameSchema` declares, in declaration order. */
  readonly zoneNames: readonly string[];
  /** Keys `AdminZonePropsMap` declares. */
  readonly propsMapKeys: readonly string[];
  readonly renders: readonly ZoneRenderSite[];
  readonly contributions: readonly ZoneContributionSite[];
  readonly moduleIds: readonly ModuleIdSite[];
}

export interface AdminZonesResult {
  readonly findings: readonly AdminZoneFinding[];
  /** Ledger keys naming a site the walk no longer produced. */
  readonly stale: readonly string[];
  /** Renders + contributions + module-id sites — the `sites=` number. */
  readonly sites: number;
  /** Zone names at least one host renders. */
  readonly rendered: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/**
 * Every finding, over the sites and the two declarations.
 *
 * Pure and exported, so a red proof enters at the **top** — with sites and
 * declared names, which is where every classification below happens (issue
 * #130). A proof handing in a finding would prove the formatting and leave the
 * six classifiers unproven.
 */
export function checkAdminZones(
  input: AdminZonesInput,
  ledger: ForeignModuleIdLedger = FOREIGN_MODULE_IDS,
): AdminZonesResult {
  const findings: AdminZoneFinding[] = [];
  const declared = new Set(input.zoneNames);
  const propsKeys = new Set(input.propsMapKeys);

  const rendered = new Set<string>();
  for (const site of input.renders) {
    if (site.zone === null) {
      findings.push({
        kind: 'computed-zone-name',
        key: `${site.file}:${site.line}`,
        message:
          `${site.file}:${site.line} names its zone with something other than a string ` +
          `literal (\`${site.via}\`). Refused rather than skipped: the refusal below ` +
          'compares rendered names to declared ones, so a name this walk cannot read is a ' +
          'zone it would report as rendered by nobody. Write the name as a literal.',
      });
      continue;
    }
    if (!declared.has(site.zone)) {
      findings.push({
        kind: 'unpublished-zone',
        key: `${site.file}:${site.line}`,
        message:
          `${site.file}:${site.line} renders '${site.zone}', which \`AdminZoneNameSchema\` ` +
          'does not carry. `tsc` refuses this for a first-party host; this is what covers ' +
          'a host that is an installed package. Add the member beside the mount, or fix ' +
          'the name.',
      });
      continue;
    }
    rendered.add(site.zone);
  }

  for (const zone of input.zoneNames) {
    if (!rendered.has(zone)) {
      findings.push({
        kind: 'unrendered-zone',
        key: zone,
        message:
          `'${zone}' is a member of \`AdminZoneNameSchema\` that no host screen renders. ` +
          'A place nothing mounts is a promise to a module author that nobody keeps — and ' +
          'a contribution to it renders nowhere, silently. There is no ledger for this on ' +
          'purpose: render the place, or remove the member.',
      });
    }
    if (!propsKeys.has(zone)) {
      findings.push({
        kind: 'missing-props-type',
        key: zone,
        message:
          `'${zone}' is a member of \`AdminZoneNameSchema\` with no entry in ` +
          '`AdminZonePropsMap`. `tsc` catches it inside `packages/contracts`, where the map ' +
          'is declared over the enum; this is what covers a map built elsewhere. Both ends ' +
          'of the mechanism are checked against that map, so a member without one is a zone ' +
          'whose props nothing constrains.',
      });
    }
  }

  for (const site of input.contributions) {
    if (rendered.has(site.zone)) continue;
    const owner = site.module ?? 'an unattributed file';
    findings.push({
      kind: 'contribution-to-unrendered-zone',
      key: `${site.file}:${site.line}`,
      message:
        `${site.file}:${site.line} — ${owner} contributes to '${site.zone}', which no host ` +
        'screen renders. Reported per contribution as well as per zone, so the author who ' +
        'wrote it is named rather than the enum: this component is downloaded by nobody and ' +
        'shown to nobody, and nothing else would ever say so.',
    });
  }

  const walked = new Map<string, ModuleIdSite[]>();
  for (const site of input.moduleIds) {
    const key = foreignModuleIdKey(site);
    const known = walked.get(key);
    if (known === undefined) walked.set(key, [site]);
    else known.push(site);
  }

  for (const [key, sites] of walked) {
    const entry = ledger[key];
    const first = sites[0]!;
    if (entry === undefined) {
      findings.push({ kind: 'foreign-module-id', key, message: foreignModuleIdMessage(first) });
      continue;
    }
    const recorded = typeof entry === 'string' ? 1 : entry.sites;
    if (recorded === sites.length) continue;
    findings.push({
      kind: 'foreign-module-id',
      key,
      message:
        `${key} records ${recorded} site(s) and the walk found ${sites.length} ` +
        `(${sites.map((site) => site.line).join(', ')}). Both directions fail: below the ` +
        'walk is a coupling nobody was asked about, above it is a number left standing ' +
        'after one went. Never raise a number to make the build pass.',
    });
  }

  const stale = Object.keys(ledger)
    .filter((key) => !walked.has(key))
    .sort();
  for (const key of stale) {
    findings.push({
      kind: 'foreign-module-id',
      key,
      message:
        `${key} has a ledger entry and the walk found no such foreign module id. An entry ` +
        'left standing after the coupling went is the stale direction every ledger in this ' +
        'tree refuses — remove it.',
    });
  }

  return {
    findings,
    stale,
    sites: input.renders.length + input.contributions.length + input.moduleIds.length,
    rendered,
  };
}

/**
 * A ledger key that survives an edit above the site.
 *
 * `<file>:<population>:<id>` and never a line number: a key carrying one would
 * red every entry below any insertion into the file, which is a ratchet that
 * fails for a reason that has nothing to do with its subject. The granularity
 * it costs — two gates on the same id in one file — is what the entry's `sites`
 * count answers, in `check:module-boundary`'s own shape (issue #267).
 */
export function foreignModuleIdKey(site: ModuleIdSite): string {
  return `${site.file}:${site.population}:${site.named ?? '<computed>'}`;
}

function foreignModuleIdMessage(site: ModuleIdSite): string {
  const where = `${site.file}:${site.line}`;
  if (site.named === null) {
    return (
      `${where} names its translation namespace with something other than a string literal, ` +
      'in a file that owns no module id — the admin kit, or an admin-ui package. No ' +
      "namespace here can be the file's own, so a namespace this walk cannot read is a " +
      'namespace it cannot clear, and reporting it as clean is exactly the "green that ' +
      'means not looking" this estate refuses (issue #113). Write it as a literal.'
    );
  }
  switch (site.population) {
    case 'visibility-gate':
      return (
        `${where} gates a surface on \`{ module: '${site.named}' }\` and the file belongs to ` +
        `${site.owner ?? 'no module'}. That is a cross-module coupling written as a string, ` +
        'which no import-specifier instrument can see. The remedy is a zone: the host names ' +
        'a place and the owner contributes to it, so nothing in the host refers to the owner.'
      );
    case 'kit-namespace':
      return (
        `${where} renders out of the '${site.named}' translation namespace inside ` +
        `${KIT_PACKAGE}. R6 of \`admin-kit-surface.md\` refuses module knowledge in the kit, ` +
        'and a namespace is module knowledge: the bundle behind it ships in a module package ' +
        'the kit does not and may not depend on, is resolved at runtime by string, and a ' +
        'renamed key neither fails to compile nor 404s — it renders the key into the ' +
        "operator's screen as a label. Move the keys the kit reads to `core`."
      );
    default:
      return (
        `${where} renders out of '${site.named}'\`s translation namespace and the file ` +
        `belongs to ${site.owner ?? 'no module'}. The strings a screen shows ship in the ` +
        'bundle of the module that owns the screen; naming another module\'s namespace makes ' +
        "that module's bundle load-bearing for a screen it does not own."
      );
  }
}

// ---------------------------------------------------------------------------
// Reading the declarations
// ---------------------------------------------------------------------------

/**
 * The zone names and the props-map keys, out of the declaring source.
 *
 * The enum is the **independent author** of this check's population: nothing
 * here computes its own list of zone names, so a member added or removed moves
 * the expectation in the same run.
 */
export function readZoneDeclarations(source: string): {
  readonly zoneNames: readonly string[];
  readonly propsMapKeys: readonly string[];
} {
  const file = ts.createSourceFile('admin-contributions.ts', source, ts.ScriptTarget.ES2022, true);
  const zoneNames: string[] = [];
  const propsMapKeys: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'AdminZoneNameSchema' &&
      node.initializer !== undefined
    ) {
      for (const literal of enumMembers(node.initializer)) zoneNames.push(literal);
    }
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === 'AdminZonePropsMap'
    ) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = member.name;
        if (name !== undefined && ts.isStringLiteral(name)) propsMapKeys.push(name.text);
        else if (name !== undefined && ts.isIdentifier(name)) propsMapKeys.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { zoneNames, propsMapKeys };
}

/** `z.enum([...])`'s string literals. */
function enumMembers(initializer: ts.Node): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isStringLiteral(element)) found.push(element.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return found;
}

// ---------------------------------------------------------------------------
// Reading the sites
// ---------------------------------------------------------------------------

/**
 * The JSX components that render a **place**, each taking the zone as a `name`
 * prop.
 *
 * Enumerated for the reason the two contribution spellings are enumerated: a
 * renderer this walk does not know reads as *no render at all*, so the member
 * it mounts is reported `unrendered-zone` while a host is mounting it. Both are
 * the kit's `./zones` subpath — `<AdminZone>` renders the contributions as a
 * stack, `<RouteTabsZone>` (feature 091, P4d) renders them as a tab strip and
 * decides from `useAdminZone(...).length` whether the strip is a choice at all.
 * A third renderer belongs here in the merge request that publishes it.
 */
const ZONE_RENDERER_TAGS = new Set(['AdminZone', 'RouteTabsZone']);

/**
 * Every `<AdminZone name=…>`, `<RouteTabsZone name=…>` and `useAdminZone(…)` in
 * one source.
 */
export function zoneRenderSites(source: string, file: string): ZoneRenderSite[] {
  const parsed = parse(source, file);
  const found: ZoneRenderSite[] = [];

  const record = (node: ts.Node, zone: string | null, via: string): void => {
    found.push({ file, line: lineOf(parsed, node), zone, via });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = jsxTagName(node.tagName);
      if (ZONE_RENDERER_TAGS.has(tag)) {
        const via = `<${tag}>`;
        const attribute = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'name',
        );
        const value = attribute?.initializer;
        if (value !== undefined && ts.isStringLiteral(value)) record(node, value.text, via);
        else if (
          value !== undefined &&
          ts.isJsxExpression(value) &&
          value.expression !== undefined &&
          ts.isStringLiteral(value.expression)
        ) {
          record(node, value.expression.text, via);
        } else record(node, null, via);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useAdminZone'
    ) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) record(node, first.text, 'useAdminZone');
      else record(node, null, 'useAdminZone');
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** Every zone contribution declared in one source, in both published spellings. */
export function zoneContributionSites(
  source: string,
  file: string,
  module: string | null,
): ZoneContributionSite[] {
  const parsed = parse(source, file);
  const found: ZoneContributionSite[] = [];

  const visit = (node: ts.Node): void => {
    // `zoneComponent('<zone>', () => import(…))` — the kit's helper.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'zoneComponent'
    ) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) {
        found.push({ file, line: lineOf(parsed, node), zone: first.text, module });
      }
    }
    // `{ zone: '<zone>', component: () => import(…) }` — the declaration
    // written by hand. Both properties are required, because `zone` alone is
    // ordinary object vocabulary (a time zone, a delivery zone, a tax zone) and
    // a bare match would manufacture a `contribution-to-unrendered-zone` out of
    // a shipping configuration. `component` is the field
    // `AdminZoneContribution` cannot be written without.
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'component',
      )
    ) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'zone' &&
          ts.isStringLiteral(property.initializer)
        ) {
          found.push({
            file,
            line: lineOf(parsed, property),
            zone: property.initializer.text,
            module,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/**
 * Every `{ module: '<id>' }` handed to the visibility predicate in one source.
 *
 * The predicate is recognised by its **binding in this file** — a name bound to
 * a `useSurfaceVisibility()` call, or `isSurfaceVisible` itself. A gate reached
 * through a prop or an imported helper is outside the population, which is the
 * direction a blind spot has to fail in: over-reaching here would report the
 * `NAV` array's hundred honest `module:` fields as couplings.
 */
export function visibilityGateSites(source: string, file: string): { line: number; named: string }[] {
  const parsed = parse(source, file);
  const predicates = new Set<string>(['isSurfaceVisible']);
  const found: { line: number; named: string }[] = [];

  const bind = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useSurfaceVisibility'
    ) {
      predicates.add(node.name.text);
    }
    ts.forEachChild(node, bind);
  };
  bind(parsed);

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      predicates.has(node.expression.text)
    ) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'module' &&
            ts.isStringLiteral(property.initializer)
          ) {
            found.push({ line: lineOf(parsed, node), named: property.initializer.text });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** Every `useTranslation(…)` in one source, `null` for an argument it could not read. */
export function translationScopeSites(
  source: string,
  file: string,
): { line: number; named: string | null }[] {
  const parsed = parse(source, file);
  const found: { line: number; named: string | null }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useTranslation'
    ) {
      const first = node.arguments[0];
      found.push({
        line: lineOf(parsed, node),
        named: first !== undefined && ts.isStringLiteral(first) ? first.text : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** What one owned source contributed: its foreign ids, and every namespace read. */
export interface OwnedModuleIdScan {
  readonly sites: readonly ModuleIdSite[];
  /**
   * Every `useTranslation` call read, foreign or not.
   *
   * Separate from {@link OwnedModuleIdScan.sites} because it answers a different
   * question: `vacuousReason`'s `translationSites` floor asks whether this walk
   * can still *see* a namespace at all, and a tree with no foreign one left is
   * the success state rather than the blind one.
   */
  readonly translationSites: number;
}

/**
 * Both owned populations of one source — the namespace and the visibility gate.
 *
 * **One classifier, three call sites.** `main()` asks it about an admin
 * application surface file and about a module's own source, and
 * `test/helpers/admin-zones-fixture.ts` asks it about the fixture text a red
 * proof hands in. It is exported for the reason that driver exists at all: a
 * second copy of *"skip the file's own id, skip an id no module registers"* is a
 * second answer waiting to disagree with the one CI runs.
 *
 * `owner` is a module id and never `null`. A file no module owns has no *own*
 * namespace for a name to be compared against, which is a different
 * classification and belongs to the kit and to the admin-ui family; a caller
 * that cannot attribute its file decides what that means before it gets here.
 */
export function ownedModuleIdSites(input: {
  readonly source: string;
  readonly file: string;
  readonly owner: string;
  readonly registered: ReadonlySet<string>;
}): OwnedModuleIdScan {
  const sites: ModuleIdSite[] = [];
  let translationSites = 0;

  if (input.source.includes('useTranslation')) {
    for (const site of translationScopeSites(input.source, input.file)) {
      translationSites += 1;
      // A computed namespace in an **owned** file is not a finding, unlike the
      // kit's and the family's: the file has an id of its own, so a namespace
      // this walk could not read may perfectly well be that id. Refusing it
      // would report a module for rendering out of its own bundle.
      if (site.named === null || !input.registered.has(site.named) || site.named === input.owner) {
        continue;
      }
      sites.push({
        file: input.file,
        line: site.line,
        named: site.named,
        owner: input.owner,
        population: 'module-namespace',
      });
    }
  }

  if (input.source.includes('module:')) {
    for (const site of visibilityGateSites(input.source, input.file)) {
      if (!input.registered.has(site.named) || site.named === input.owner) continue;
      sites.push({
        file: input.file,
        line: site.line,
        named: site.named,
        owner: input.owner,
        population: 'visibility-gate',
      });
    }
  }

  return { sites, translationSites };
}

function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function jsxTagName(tagName: ts.JsxTagNameExpression): string {
  return ts.isIdentifier(tagName) ? tagName.text : tagName.getText();
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

/**
 * Why this run must not report a pass, or `null`.
 *
 * Exit **2**, never 0 and never 1. Each entry is an input whose absence would
 * leave a classification vacuously clean rather than failing (issue #113).
 */
export function vacuousReason(input: {
  readonly zoneNames: number;
  readonly propsMapKeys: number;
  readonly hostFiles: number;
  readonly renders: number;
  readonly contributions: number;
  readonly kitFiles: number;
  readonly translationSites: number;
  readonly moduleIdCount: number;
  /**
   * Admin layers the generated contribution registry names, or `null` where
   * that registry is not on disk.
   *
   * `null` and `0` are deliberately different answers. A checkout with no
   * generated registry has nothing to be short of; one that *has* the artefact
   * and reads no module package out of it has lost the independent author of
   * the module-admin floor, and the widened walk would then report clean over a
   * population nothing corroborates — which is the way this widening could have
   * created a new silent green.
   *
   * **The discriminator is the file, never the admin layout** (T4). It was the
   * layout, and the layout went `null` for an unrelated reason; see the comment
   * on the call site.
   */
  readonly moduleAdminLayers: number | null;
  /**
   * Whether a workspace member declares the admin source alias — *"this
   * repository has a frontend"* — with the admin layout `null` (feature 110,
   * T122).
   *
   * The discriminator between a workspace with no admin at all, which is the
   * behaviour that shipped, and one whose route table the layout has stopped
   * finding. T120 put `App.tsx` and the nav inside
   * `@endora-commerce/admin-shell`; with that package unbuilt or renamed the
   * host walk contributes nothing, and `hostFiles` above stays comfortably
   * non-empty on the module and kit files alone, so no other floor here sees
   * it. `null` is a caller that did not ask.
   */
  readonly adminApplicationLost?: string | null;
}): string | null {
  if (input.zoneNames === 0) {
    return (
      'no zone name was read out of `AdminZoneNameSchema` — the enum is this check\'s ' +
      'independent author, and with none of it every render is `unpublished-zone` and no ' +
      'member is unrendered; refusing to report a vacuous pass'
    );
  }
  if (input.propsMapKeys === 0) {
    return (
      'no key was read out of `AdminZonePropsMap` — every member would then be ' +
      '`missing-props-type`, which is loud, but a map this walk cannot read is a map it ' +
      'cannot judge; refusing to report a vacuous pass'
    );
  }
  if (input.hostFiles === 0) {
    return (
      'the walk opened no host file — a zone is rendered by a module screen, an installed ' +
      'package\'s screen or the admin\'s own, and with none of them open every declared zone ' +
      'is unrendered for a reason that is about the walk; refusing to report a vacuous pass'
    );
  }
  if (input.renders === 0 && input.contributions === 0) {
    return (
      'the enum declares zone names and the walk found neither a render nor a contribution ' +
      '— which is what a moved tree produces, and which would otherwise report every member ' +
      'as `unrendered-zone`: a finding about the walk, dressed as a finding about the tree; ' +
      'refusing to report a vacuous pass'
    );
  }
  if (input.kitFiles === 0) {
    return (
      `no source was read from ${KIT_PACKAGE} — the kit-namespace population is empty for a ` +
      'reason that is about the walk; refusing to report a vacuous pass'
    );
  }
  if (input.translationSites === 0) {
    return (
      'no `useTranslation` call was read anywhere — a changed import shape would otherwise ' +
      'print a clean line over an unwatched tree, which is `check:subscribe-seam`\'s ' +
      'worker-half reasoning; refusing to report a vacuous pass'
    );
  }
  if (input.moduleIdCount === 0) {
    return (
      'the generated manifest index yielded no module id, so no namespace and no gate could ' +
      'ever be foreign; refusing to report a vacuous pass'
    );
  }
  if (input.adminApplicationLost !== undefined && input.adminApplicationLost !== null) {
    return (
      'a workspace member declares the admin source alias and the admin layout resolved to ' +
      `nothing — ${input.adminApplicationLost}. The host walk would then contribute no file ` +
      'while the module and kit walks keep `hostFiles` non-empty, so every floor above stays ' +
      'satisfied; refusing to report a vacuous pass'
    );
  }
  if (input.moduleAdminLayers === 0) {
    return (
      'the generated admin contribution registry is on disk and names no module package, so ' +
      'the module-admin floor has no independent author and the widened foreign-id walk is ' +
      'corroborated by nothing; refusing to report a vacuous pass'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function walk(directory: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      if (PRUNED.has(entry)) continue;
      walk(full, out);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) out.push(full);
  }
  return out;
}

function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}


function memberDirectory(repoRoot: string, name: string): string | null {
  for (const member of workspaceMembers(repoRoot, nodeWorkspaceFs())) {
    if (member.name === name) return member.dir;
  }
  return null;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout: ModuleTreeLayout = await requireModuleLayout('[admin-zones]');
  const admin: AdminSurfaceLayout | null = await layout.adminSurfaces();

  const contractsDir = memberDirectory(layout.repoRoot, CONTRACTS_PACKAGE);
  const declarationPath =
    contractsDir === null ? null : join(contractsDir, ZONE_DECLARATION_FILE);
  const declarationSource =
    declarationPath !== null && existsSync(declarationPath)
      ? readFileSync(declarationPath, 'utf8')
      : '';
  const { zoneNames, propsMapKeys } = readZoneDeclarations(declarationSource);

  const kitDir = memberDirectory(layout.repoRoot, KIT_PACKAGE);
  const kitFiles = kitDir === null ? [] : walk(join(kitDir, 'src'));
  const kitExemptPath = kitDir === null ? null : join(kitDir, KIT_TRANSLATION_HOOK);
  const zoneImplementationDir =
    kitDir === null ? null : packageSubpathSource(kitDir, ZONE_SUBPATH);

  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  // Every source root the admin application owns — the project's and
  // `@endora-commerce/admin-shell`'s (feature 110, T122). It was `sourceRoot`
  // alone, which was the whole application until T120 moved `App.tsx`,
  // `AppShell.tsx` and every host screen into the shell package; a walk left on
  // the alias target would have opened four files and reported `renders=0`
  // over a mounting point it could no longer see. On a tree whose route table
  // is still in the alias member the two are one directory and this reads
  // exactly what it read before.
  const adminFiles = admin === null ? [] : admin.hostRoots.flatMap((root) => walk(root));
  // Every admin-ui package **other than the kit**: the kit is population 2,
  // whose message is R6 of `admin-kit-surface.md` and whose subject is the kit
  // specifically, so leaving it here as well would report one site twice under
  // two keys. `KIT_PACKAGE` therefore stays a name — it is the subject of that
  // rule rather than a derived fact written down.
  const members = workspaceMembers(layout.repoRoot, nodeWorkspaceFs());
  const familyPackages = adminUiPackages(members).filter(
    (pkg) => kitDir === null || resolve(pkg.dir) !== resolve(kitDir),
  );
  const familyFiles = familyPackages.flatMap((pkg) => walk(join(pkg.dir, 'src')));

  const registered = new Set(layout.registeredIds);
  const key = (file: string): string => relative(layout.repoRoot, file).split(sep).join('/');

  const renders: ZoneRenderSite[] = [];
  const contributions: ZoneContributionSite[] = [];
  const moduleIds: ModuleIdSite[] = [];
  let translationSites = 0;

  // Host files — a zone may be rendered by a module's screen, by an installed
  // package's screen or by the admin application's own.
  const hostFiles = [...moduleFiles, ...adminFiles, ...kitFiles, ...familyFiles];
  for (const file of hostFiles) {
    const source = readFileSync(file, 'utf8');
    const isMechanism =
      zoneImplementationDir !== null && isUnder(resolve(file), zoneImplementationDir);
    // The prefilter is derived from the renderer set, not written twice:
    // `RouteTabsZone` does not contain the substring `AdminZone`, so a spelled
    // pair would have skipped every file that mounts a strip.
    const mentionsRenderer =
      source.includes('useAdminZone') ||
      [...ZONE_RENDERER_TAGS].some((tag) => source.includes(tag));
    if (!isMechanism && mentionsRenderer) {
      renders.push(...zoneRenderSites(source, key(file)));
    }
    if (source.includes('zoneComponent') || (source.includes('zone:') && source.includes('component'))) {
      contributions.push(
        ...zoneContributionSites(source, key(file), layout.moduleIdOfPath(file)),
      );
    }
  }

  // Population 2 — the kit's own namespaces.
  for (const file of kitFiles) {
    if (kitExemptPath !== null && resolve(file) === resolve(kitExemptPath)) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('useTranslation')) continue;
    for (const site of translationScopeSites(source, key(file))) {
      translationSites += 1;
      // A namespace this walk cannot read is a finding, not a skip: reporting
      // it clean is the shape the estate refuses (issue #113).
      if (site.named !== null && !registered.has(site.named)) continue;
      moduleIds.push({
        file: key(file),
        line: site.line,
        named: site.named,
        owner: null,
        population: 'kit-namespace',
      });
    }
  }

  // Population 3, the half that owns no module id — an admin-ui package's own
  // sources (feature 091, P5c). No namespace here can be the file's own, so
  // every registered id it names is foreign and a **computed** one is a finding
  // rather than a skip, on the kit's own reasoning: a namespace this walk
  // cannot read is one it cannot clear (issue #113). It is `module-namespace`
  // rather than a fourth population because it is the same coupling with the
  // same remedy — the strings a screen shows ship in the bundle of whoever owns
  // the screen — and the finding's message already answers for an owner of
  // `null`.
  for (const file of familyFiles) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('useTranslation')) continue;
    for (const site of translationScopeSites(source, key(file))) {
      translationSites += 1;
      if (site.named !== null && !registered.has(site.named)) continue;
      moduleIds.push({
        file: key(file),
        line: site.line,
        named: site.named,
        owner: null,
        population: 'module-namespace',
      });
    }
  }

  // Populations 1 and 3 — the admin's module surfaces, attributed by the route
  // table and the nav rather than by directory name.
  if (admin !== null) {
    for (const file of adminFiles) {
      const owner = adminOwnerOf(admin, file);
      if (owner === null) continue;
      const source = readFileSync(file, 'utf8');
      const scan = ownedModuleIdSites({ source, file: key(file), owner, registered });
      translationSites += scan.translationSites;
      moduleIds.push(...scan.sites);
    }
  }

  // Populations 1 and 3 again, over a module's **own** sources — the half that
  // moved out from under the walk (feature 091).
  //
  // The two halves of this check read two populations: renders and
  // contributions come off `layout.moduleWalkRoots`, which reaches a module
  // package's `src/admin/`, while the foreign-id walk above reads `admin/src`
  // and the admin-ui family and reached none of it. That was one population when
  // P4a wrote it — every admin screen was the application's — and Story 3 moves
  // screens into their modules one directory per merge request, so a packaged
  // module gating on another module's id, or rendering out of another module's
  // namespace, was seen by nothing at all. The ledger's own header calls the
  // file-leaves-the-walk hazard an incident; with 37 of the module packages
  // shipping an admin layer it is a structure, and every batch widens it. This
  // is issue #215's shape one surface over: the check was right when it was
  // written and the tree moved underneath it.
  //
  // **Attribution is the layout's, never a directory name.** For a package it is
  // the `endora.id` the package declares about itself — the same statement the
  // runtime discovery reads — and for the application trees it is the
  // `modules/<id>/` segment. A file in a module walk root that the layout
  // attributes to **no** module is skipped rather than judged, which is the
  // fail-closed direction with respect to attribution: it is what keeps a
  // coupling from being filed under a module that does not own the file, and it
  // is the same answer `adminOwnerOf` gives for `_shared`. On this tree that is
  // four files, all of them a deployment's own under `src/apps` — a shell whose
  // job is to name modules, exactly as `App.tsx` is.
  for (const file of moduleFiles) {
    const owner = layout.moduleIdOfPath(file);
    if (owner === null) continue;
    const source = readFileSync(file, 'utf8');
    const scan = ownedModuleIdSites({ source, file: key(file), owner, registered });
    translationSites += scan.translationSites;
    moduleIds.push(...scan.sites);
  }

  // The floor over the population the walk above just acquired. `covered` is
  // the layers the walk actually opened a file from, so pruning a module
  // package's admin sources out of `moduleWalkRoots` — the one regression this
  // widening can suffer in silence, because `manifest-index` stays satisfied by
  // the same module's backend files — is a `short-walk` refusal rather than a
  // clean line.
  // **T4 — the gate is the registry file's presence, never the layout.**
  // It was `admin === null`, and on the merge of batches 15 and 16 that became
  // true for a reason having nothing to do with the registry: `admin/src/modules`
  // held no registered module id, so the layout refused and this token — the
  // floor added specifically to catch a module package's admin layer dropping
  // out of the walk — was omitted over 54 layers while the check printed
  // `findings=0`. The comment defending the old gate said the omission "cannot
  // become the silent path"; it became one, in exactly the way it excluded.
  // `admin-kit-surface.md` §7.5 is the measurement.
  const registryFile = adminRegistryPathOf(members);
  const adminLayers = adminRegistryPresent(registryFile)
    ? moduleAdminLayers(layout, registryFile!)
    : null;
  const walkedModuleFiles = moduleFiles.map((file) => resolve(file));
  const coveredAdminLayers =
    adminLayers === null
      ? 0
      : adminLayers.filter((layer) => {
          const directory = resolve(layer.directory);
          return walkedModuleFiles.some((file) => isUnder(file, directory));
        }).length;

  const vacuous = vacuousReason({
    zoneNames: zoneNames.length,
    propsMapKeys: propsMapKeys.length,
    hostFiles: hostFiles.length,
    renders: renders.length,
    contributions: contributions.length,
    kitFiles: kitFiles.length,
    translationSites,
    moduleIdCount: registered.size,
    moduleAdminLayers: adminLayers === null ? null : adminLayers.length,
    adminApplicationLost:
      admin === null && adminApplicationPresent(members) ? await layout.adminSurfacesRefusal() : null,
  });
  if (vacuous !== null) {
    console.error(`[admin-zones] ${vacuous}`);
    process.exit(2);
    return;
  }

  const populationRefusal = vacuousModulePopulation({
    registered: layout.registeredIds,
    files: moduleFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });
  if (populationRefusal !== null) {
    console.error(`[admin-zones] ${populationRefusal}`);
    process.exit(2);
    return;
  }

  const result = checkAdminZones({
    zoneNames,
    propsMapKeys,
    renders,
    contributions,
    moduleIds,
  });

  if (listMode) {
    for (const zone of zoneNames) {
      const count = renders.filter((site) => site.zone === zone).length;
      const contributed = contributions.filter((site) => site.zone === zone).length;
      console.log(`${zone.padEnd(34)} renders=${count} contributions=${contributed}`);
    }
    for (const site of moduleIds) {
      console.log(
        `${site.population.padEnd(18)} ${site.file}:${site.line} -> ${site.named ?? '<computed>'}` +
          ` (owner=${site.owner ?? '-'})`,
      );
    }
    console.log('');
  }

  reportReadSize({
    prefix: '[admin-zones]',
    // Every file the walk opened, once: `hostFiles` already carries the module
    // sources, the admin's own and the kit's.
    files: hostFiles.length,
    sites: result.sites,
    // **The `admin-ui` token, added by P5b when the second admin-ui member
    // arrived** — `@endora-commerce/page-builder-admin`, the shared page-builder
    // chrome and the e-mail builder.
    //
    // P5c left it out for a reason that was correct then: the family half of
    // population 3 was empty, the kit being the only admin-ui member and being
    // population 2, so a coverage entry would have declared `expected=0` —
    // which `read-size.ts` refuses as `no-expectation`, exit 2, on every run.
    // It named two conditions for adding one, *"a second admin-ui member
    // exists"* and *"and carries a ledger key"*, and P5b satisfies the first
    // and not the second: the package's three `useTranslation` calls all name
    // `core`, which is no module id, so it has no `foreign-module-id` key and
    // is not going to grow one by being right.
    //
    // The second condition is dropped rather than waited on, because it was the
    // *alternative* floor and not a qualification of this one. A ledger keyed
    // by path is two-way, so an entry naming a file the walk stopped reaching
    // goes stale in the same run — that is what would have floored the family
    // packages. A package with no entry has no such floor, so with neither the
    // key nor the token this check would walk 23 fewer files, find nothing
    // wrong in them, and report clean: a `files` fall well inside the -10%/+50%
    // band, which is issue #215 exactly. `i18n:hardcoded`'s six re-keyed
    // baseline entries would catch the same omission, and a floor that lives in
    // another check is not this check's floor.
    //
    // It fails loudly in both directions. `expected` is the admin-ui members
    // other than the kit — a package that stopped declaring the block, or left
    // the workspace, takes it to zero and `no-expectation` refuses the run.
    // `covered` is those the walk actually opened a file in, so a member
    // declaring the block over an empty or unreachable `src` is `short-walk`.
    // The kit stays floored where it already was, by `vacuousReason`'s
    // `kitFiles` refusal, and is deliberately not counted here for the same
    // reason it is not in `familyFiles`: it is population 2, and counting it
    // twice would let one member's coverage stand in for the other's.
    coverage: [
      {
        // The enum declares the names and this check computes none of them.
        //
        // **The direction is map → enum, and it is the only one that can be
        // here.** The other direction — an enum member with no props entry — is
        // the `missing-props-type` **finding**, and a coverage token measuring
        // it would pre-empt that finding with a `short-walk` refusal every
        // time: two answers under one derivation, and the exit code would be 2
        // where the tree is genuinely in violation. Measured, before this was
        // written that way round: removing one props entry exited 2 and the
        // finding it exists for was unreachable in a real run.
        //
        // So `expected` is the props-map keys and `covered` is those the enum
        // also carries. A map that stopped parsing is `no-expectation`, exit 2,
        // which is what makes this a floor rather than a decoration; the
        // reconciliation it corroborates is *"the declaration was read"*.
        source: 'zone-enum',
        expected: propsMapKeys.length,
        covered: propsMapKeys.filter((key) => zoneNames.includes(key)).length,
      },
      {
        source: 'admin-ui',
        expected: familyPackages.length,
        covered: familyPackages.filter((pkg) =>
          familyFiles.some((file) => isUnder(resolve(file), resolve(pkg.dir))),
        ).length,
      },
      modulePopulationCoverage({
        registered: layout.registeredIds,
        files: moduleFiles,
        moduleIdOf: layout.moduleIdOfPath,
      }),
      // The floor that moves with the widened population.
      //
      // `manifest-index` above is satisfied by any file a registered module
      // contributes, which for a module package is its backend sources — so it
      // cannot see the case this token exists for: a module package's admin
      // layer dropping out of the walk while the module keeps contributing.
      // The expectation is the generated contribution registry's, which is a
      // second program's answer to *"which packages ship admin code, and
      // under which subpath"*; the coverage is what this walk opened. Omitted
      // rather than printed `0/0` where that artefact is **not on disk**, which
      // `read-size.ts` refuses as `no-expectation`; a registry that is there and
      // names none is `vacuousReason`'s refusal above. The gate is the file and
      // nothing else — it used to be the admin layout, and that is how the token
      // vanished over 54 layers with `findings=0` printed beside it.
      ...(adminLayers === null
        ? []
        : [
            {
              source: 'module-admin',
              expected: adminLayers.length,
              covered: coveredAdminLayers,
            },
          ]),
    ],
  });

  console.log(
    `[admin-zones] zones=${zoneNames.length} rendered=${result.rendered.size} ` +
      `renders=${renders.length} contributions=${contributions.length} ` +
      `foreign-ids=${moduleIds.length} ` +
      `ledger-size=${Object.keys(FOREIGN_MODULE_IDS).length} ` +
      `stale=${result.stale.length} findings=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nThe zone mechanism\'s two-way refusal, or a module id written as a string.\n' +
        'A zone nothing renders and a contribution that lands nowhere are the two halves\n' +
        'the contract has promised since the enum landed; the third is a cross-module\n' +
        'coupling no import-specifier instrument can see.\n',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.message}\n`);
    }
  }

  process.exit(result.findings.length > 0 ? 1 : 0);
}

/**
 * The module owning an admin file, or `null` for the admin application's own.
 *
 * Read from `moduleOfDirectory`, which the layout derives from the route table
 * and the nav — the directory name is **not** the module id (`warehouses` is
 * `inventory`'s surface), and keying on `basename` would attribute two modules'
 * files to names no module answers to. A directory no nav entry claims is the
 * application's and is judged as nobody's, which is the fail-closed direction:
 * a host file's `{ module: 'x' }` is the admin shell doing its job.
 */
function adminOwnerOf(admin: AdminSurfaceLayout, file: string): string | null {
  // No module root is the terminal state (R16), and `null` is the right answer
  // for every file under it: the admin application owns them all, and a host
  // file's `{ module: 'x' }` is the shell doing its job.
  if (admin.moduleRoot === null) return null;
  const relativePath = relative(admin.moduleRoot, file);
  if (relativePath.startsWith('..') || relativePath === '') return null;
  const directory = relativePath.split(sep)[0];
  if (directory === undefined) return null;
  return admin.moduleOfDirectory.get(directory) ?? null;
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
