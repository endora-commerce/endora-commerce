import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  AdminLayoutUnresolvableError,
  adminHostRootsOf,
  adminRegistryPathOf,
} from './lib/admin-surfaces.js';
import {
  adminRegistryPresent,
  moduleAdminLayers,
  type ModuleAdminLayer,
} from './lib/module-admin-layers.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import {
  adminUiPackages,
  modulePackages,
  nodeWorkspaceFs,
  workspaceMembers,
} from './lib/workspace-packages.js';

/** The checkout, whichever one this file was loaded from. */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** One directory this check walks, and what put it in the population. */
export interface AdminScanRoot {
  /** Absolute directory. */
  readonly dir: string;
  /**
   * The workspace member that declared it, or `null` for the admin
   * application's own source tree.
   */
  readonly owner: string | null;
  /** True for a root an `endora: { type: 'admin-ui' }` declaration produced. */
  readonly adminUi: boolean;
}

/**
 * The roots the admin's user-visible strings live in, and the reason there is
 * more than one (feature 091, Phase 1b, Phase 4 and P5c).
 *
 * The population was `admin/src` alone, and the key was relative to it. Then 57
 * of those files moved into `@endora-commerce/admin-kit` — the admin's own
 * design system, rendered by the same screens as before — and the ratchet
 * reported the two entries that went with them as **drained**: the strings had
 * not been translated, they had changed address. That is the laundering FR-017
 * exists to refuse, one check over, and the answer is the same one: the
 * instrument follows the code.
 *
 * **Story 3 opens the same channel a third time, one module directory per merge
 * request**, which is why the module packages' own `src/admin` layers are here
 * too. A screen moving from `admin/src/modules/<id>/` into
 * `packages/modules/<id>/src/admin/` is the identical relocation at the
 * identical granularity, and the batch that performs it is — by construction —
 * the batch that cannot see the entry describing it go stale.
 *
 * **P5 opens it a fourth time, and this root is here *before* the move.** The
 * shared page-builder chrome and the e-mail builder go into
 * `@endora-commerce/page-builder-admin`, which is neither the admin
 * application, nor the kit, nor a module package — so on the day it is created
 * the four `_shared/email-builder` baseline entries (9 + 1 + 2 + 4 = 16
 * findings) would name paths no root reaches, and the two-way ratchet would ask
 * for them to be deleted. Sixteen untranslated strings would leave this ledger
 * as *drained*, which is the same laundering in the same direction, one home
 * further out. Widening while the files are still under `admin/src` is a
 * measured no-op; widening afterwards adds the population that would have
 * caught the move in the merge request that no longer needs it.
 *
 * **Feature 110's T120 opens it a fifth time, and this root is here *with* the
 * move.** `admin/src` was the admin application, and T120 extracted the router,
 * the shell and every host screen into `@endora-commerce/admin-shell`, leaving
 * the alias member holding four files. `LoginPage.tsx`'s four baseline findings
 * would have named a path no root reaches, and the two-way ratchet would have
 * asked for the entry to be deleted — sixteen strings' worth of the same
 * laundering, one home further out. So the admin's roots are the **host roots**
 * the layout derives, which are the project's and the shell's, and the one
 * baseline key moves with the file in the same merge request.
 *
 * ## Nothing here is spelled — every root is a declaration
 *
 * The admin application's own roots come from `lib/admin-surfaces.ts`, which
 * derives them from the `"@/*"` alias and from the source root holding the
 * route table and the nav — two declarations rather than a path this file
 * names. Every other root is a workspace member's own statement about itself:
 * `endora: { type: 'module' }` for a module package, whose admin layer is a
 * root when the package has one, and `endora: { type: 'admin-ui' }` for a
 * package whose whole source tree is admin UI. **The kit is found by that
 * declaration and no longer by name.** It used to be `ADMIN_KIT_PACKAGE`, a constant naming
 * `@endora-commerce/admin-kit`, which is a derived fact written down (D-100):
 * the second admin-ui package would have had to be added to it by whoever
 * remembered, and forgetting costs sixteen findings silently.
 *
 * Why a manifest field may decide a check's population at all, since the next
 * reader will reach for D-171: that ruling refused a self-certified
 * **exemption**, and this declaration is the opposite — it only ever adds
 * obligations. The full reasoning is on `declaresAdminUi` in
 * `lib/workspace-packages.ts`, where the derivation lives.
 *
 * The keys are repository-relative, so the ledger names one file in one
 * namespace whichever root it sits under.
 *
 * **Exported because the companion test has to ask the same question, not a
 * similar one** (feature 091, Phase 4 batch three). It kept its own two-root
 * list, and that list stopped describing this script the moment Phase 4's first
 * batch added the third root family. Nothing showed it: batches one and two
 * moved files that carried no baseline entry, so both walks agreed on the empty
 * set. Batch three moved the first screen that does carry one — a LinkedIn URN
 * placeholder — and the script read the entry at its new key while the test,
 * walking two roots, reported it *drained*. Green script, red suite, over one
 * ledger. Two derivations of one population are two answers waiting to
 * disagree; there is one now.
 */
export function adminScanRoots(): readonly AdminScanRoot[] {
  const members = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  const adminUi = adminUiPackages(members);
  if (adminUi.length === 0) {
    process.stderr.write(
      '[i18n:hardcoded] no workspace member declares `endora: { type: "admin-ui" }` — the ' +
        "admin's own design system is one, so half the components every screen renders " +
        'would go unscanned and the ledger entries naming them would read as drained; ' +
        'refusing to report a vacuous pass\n',
    );
    process.exit(2);
  }
  const moduleAdminLayers = modulePackages(members)
    .map((pkg) => ({ dir: join(pkg.dir, 'src', 'admin'), owner: pkg.name, adminUi: false }))
    // A module package with no admin layer is the ordinary case and contributes
    // nothing — an empty set is legitimate here, unlike the admin-ui set,
    // because before Story 3 there were no layers at all.
    .filter((root) => existsSync(root.dir));
  // The admin's own roots, and a refusal rather than a fallback when they
  // cannot be derived (feature 110, T122). The alternative — carrying on with
  // whatever roots are left — is `admin/src`'s four files plus the packages,
  // over a ledger keyed by path: every entry naming a shell file would read as
  // **drained**, which is the laundering this walk's own header exists to
  // refuse, arriving through the derivation instead of through a move.
  let hostRoots: readonly string[];
  try {
    hostRoots = adminHostRootsOf(members);
  } catch (error: unknown) {
    if (!(error instanceof AdminLayoutUnresolvableError)) throw error;
    process.stderr.write(`[i18n:hardcoded] ${error.message}; refusing to report a vacuous pass\n`);
    process.exit(2);
  }
  return [
    // `owner: null` for both, because both are the admin application's: the
    // shell is not an `admin-ui` **library** whose every module id is foreign,
    // it is the mounting point, relocated (feature 110, T122).
    ...hostRoots.map((dir) => ({ dir, owner: null, adminUi: false })),
    ...adminUi.map((pkg) => ({ dir: join(pkg.dir, 'src'), owner: pkg.name, adminUi: true })),
    ...moduleAdminLayers,
  ];
}

/** The directories {@link adminScanRoots} produces — the walk's input. */
export function defaultRoots(): readonly string[] {
  return adminScanRoots().map((root) => root.dir);
}

/**
 * How many of the admin layers the generated registry names this walk opened as
 * a root (feature 091 fallout; `contracts/admin-registry.md` R13b).
 *
 * **The registry is the independent author, and it is the only one there is for
 * this family.** `admin-ui` corroborates two of the three root families; the
 * third — 55 module packages' own `src/admin`, which is 357 of the 422 files
 * this check reads — had none, and {@link adminScanRoots} builds it by asking
 * the filesystem whether `<pkg>/src/admin` exists. A population that is a
 * directory listing, reconciled against a count derived from the same listing,
 * is the same answer twice (issue #244): every module admin layer could drop out
 * of the walk at once and this check would print `files=65 sources=admin-ui:2/2`
 * and exit 0, clean over the fifteen per cent of the admin it could still see.
 * That is issue #215's short walk, on the population feature 091 is actively
 * moving, one merge request at a time.
 *
 * `admin/src/modules.generated.ts` is a different program's answer to *"which
 * packages ship admin code, and under which subpath"* — rendered by
 * `generate-composer.ts`, refused by `overlay:check` when it is stale, foreign
 * or empty — and `lib/module-admin-layers.ts` is the one derivation over it,
 * shared with `check:admin-zones` and `check:admin-surface`. Nothing here spells
 * `./admin` or `src/admin`; the subpath's source directory comes off the
 * package's own `exports` map.
 *
 * **Coverage is the root, not a file under it.** One registry-named layer
 * (`admin_roles`) is a barrel and no screen, so a layer holding no `.tsx` is the
 * ordinary case rather than a finding, and a rule keyed on files would refuse a
 * correct tree. What this can see is a layer that left the walk, which is the
 * regression; what it cannot is a root that was walked and yielded nothing,
 * which is `adminScanRoots`' own `existsSync` filter and the companion test's
 * first case.
 */
export function coveredModuleAdminLayers(
  layers: readonly Pick<ModuleAdminLayer, 'directory'>[],
  walkedRoots: readonly string[],
): number {
  const walked = new Set(walkedRoots.map((root) => resolve(root)));
  return layers.filter((layer) => walked.has(resolve(layer.directory))).length;
}

/**
 * The floor's own vacuity refusal, or `null` when there is a floor to apply.
 *
 * `null` layers is *"this workspace has no admin contribution registry"* — a
 * fixture tree, a checkout with no admin application — and the token is omitted
 * rather than printed `0/0`, which `read-size.ts` refuses as `no-expectation`
 * anyway. An **empty** array is the different and dangerous state: the registry
 * is on disk and names nobody, so `module-admin:0/0` would corroborate nothing
 * while looking exactly like a floor.
 *
 * Pure and exported so the proof drives it from a fixture rather than from a
 * value a run computed (issue #130): the branch it guards ends in
 * `process.exit(2)`, which nothing can enter at the top.
 */
export function moduleAdminFloorRefusal(
  layers: readonly Pick<ModuleAdminLayer, 'directory'>[] | null,
): string | null {
  if (layers === null || layers.length > 0) return null;
  return (
    'the generated admin contribution registry names no module package — the module ' +
    "packages' own `src/admin` layers are the larger part of this walk and their floor " +
    'has no other author, so a batch that took every one of them out of the population ' +
    'would print a clean line over the remainder; refusing to report a vacuous pass'
  );
}

/**
 * `pnpm --filter backend run i18n:hardcoded [-- <path>… | --strict | --list]` — feature 021.
 *
 * Walks the admin SPA's `.tsx` source for hard-coded user-visible strings.
 * Flags two shapes:
 *   1. JSX text nodes whose trimmed value contains a non-whitespace English
 *      letter (a-z), e.g. `<Button>Save changes</Button>`.
 *   2. JSX attribute values whose attribute name is in `USER_VISIBLE_ATTRS`
 *      (title, aria-label, placeholder, alt) and whose value is a string
 *      literal, e.g. `<input placeholder="Search…" />`.
 *
 * False-positive controls:
 *   - Ignore strings made entirely of code-style characters: identifiers
 *     with dots or underscores, paths, regex shapes, UUID/hex.
 *   - Ignore JSX inside <code>...</code> (technical identifier display).
 *   - Ignore very short strings (single character, punctuation only).
 *   - Ignore strings already wrapped in `t(...)` — they are JSX expressions,
 *     not text nodes, so the AST walker doesn't see them anyway.
 *
 * ## Why this is a ratchet and not a build break (issue #116)
 *
 * `AGENTS.md` has cited this script as *the* gate on Principle VIII for
 * user-facing strings since feature 021, and it has run in no CI job for its
 * whole life — first because its default root resolved against the working
 * directory and matched nothing, then because fixing that revealed 274 findings
 * across 47 files. Switching it on strict would fail the build on history, so it
 * runs against {@link HARDCODED_STRINGS_BASELINE}: a **new** hard-coded string
 * fails, the standing 274 do not, and a file that is translated has to say so.
 *
 * Two modes, and the difference is exactly which one CI runs:
 *   - **default (the ratchet)** — the full default scan, compared to the
 *     baseline in both directions. This is the CI line.
 *   - **`--strict`, or any explicit path** — every finding is a violation. This
 *     is how the remaining debt is measured while draining a screen.
 *
 * Output: one finding per line as `<path>:<line>:<col> → "<text>"`.
 */

const USER_VISIBLE_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
]);

export interface Finding {
  filePath: string;
  line: number;
  column: number;
  text: string;
  kind: 'jsx-text' | 'jsx-attr';
}

function isLikelyCodeIdentifier(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  if (!/[A-Za-z]/.test(t)) return true; // no letters → punctuation / digits only
  if (t.length < 2) return true;
  if (/^[A-Za-z0-9_./-]+$/.test(t) && !/\s/.test(t)) return true; // code-shaped token
  return false;
}

function walkFile(filePath: string, findings: Finding[]): void {
  findings.push(...analyzeSource(readFileSync(filePath, 'utf8'), filePath));
}

/**
 * Every hard-coded user-visible string in one source.
 *
 * Exported so the rule can be driven red on a fixture rather than only agreeing
 * with whatever `admin/src` currently holds — the walk used to be reachable only
 * through `main`, which meant the analysis had no test at all (issue #113).
 */
export function analyzeSource(source: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function isInsideCodeElement(node: ts.Node): boolean {
    let p: ts.Node | undefined = node.parent;
    while (p) {
      if (ts.isJsxElement(p) || ts.isJsxOpeningElement(p)) {
        const tagName = ts.isJsxElement(p)
          ? p.openingElement.tagName
          : p.tagName;
        if (ts.isIdentifier(tagName) && tagName.text === 'code') return true;
      }
      p = p.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const trimmed = node.text.trim();
      if (trimmed.length > 0 && !isLikelyCodeIdentifier(trimmed) && !isInsideCodeElement(node)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({
          filePath,
          line: line + 1,
          column: character + 1,
          text: trimmed,
          kind: 'jsx-text',
        });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : '';
      if (USER_VISIBLE_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        if (!isLikelyCodeIdentifier(value)) {
          const { line, character } = sf.getLineAndCharacterOfPosition(node.initializer.getStart(sf));
          findings.push({
            filePath,
            line: line + 1,
            column: character + 1,
            text: value,
            kind: 'jsx-attr',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return findings;
}

/**
 * The standing debt, as measured on 2026-08-16: **274 findings across 47 files**
 * of the 321 `.tsx` files under `admin/src`.
 *
 * ## Why a per-file count rather than a per-string ledger
 *
 * The other ledgers in the repository (`PORT_CATCHES_TO_DRAIN`,
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`, `UNTRANSLATED_ERROR_CODES`) key on a site and
 * carry a reason per entry, because each of their entries is a decision somebody
 * has to defend. An untranslated string is not a decision — there is exactly one
 * reason for all 274 of them, and it is "this screen predates the rule". Writing
 * that sentence 274 times, against keys built from the string bodies (one of
 * them is 207 characters across three lines), would produce a ledger nobody
 * reads and a diff nobody can review.
 *
 * The unit of the debt is the **screen**, so the entry is the screen and the
 * value is how much of it is left. It is a **two-way ratchet**: a file over its
 * number fails, a file with no number fails, and a file **under** its number
 * fails too — translate a string and the ledger has to come down with it, which
 * is what stops the number from describing a debt that was already paid.
 *
 * Keys are paths relative to `admin/src`. It is meant to reach `{}`.
 */
export const HARDCODED_STRINGS_BASELINE: Readonly<Record<string, number>> = {
  // Issue #193 lifted the two federated-provider labels into
  // `preauth-login-copy.ts`; the four left are the second-step MFA screen.
  //
  // Re-keyed, not drained: feature 110's T120 moved `admin/src` into
  // `@endora-commerce/admin-shell` and this walk's roots moved with it, so the
  // same four strings in the same component are read at the path they now sit
  // at. The count is unmoved, which is what says nothing was translated.
  'packages/admin-shell/src/components/LoginPage.tsx': 4,
  // Feature 091's P4c published the asset cluster, so this file's one finding
  // ("Clear asset") is the kit's now. The count is unmoved: the same string in
  // the same component, under the path the walk reads it at.
  'packages/admin-kit/src/components/asset-picker/AssetFieldPicker.tsx': 1,
  'packages/admin-kit/src/components/rule-builder/RuleBuilder.tsx': 6,
  'packages/admin-kit/src/ui/color-picker.tsx': 1,
  // Feature 091's P5b published the shared page-builder chrome and the e-mail
  // builder as `@endora-commerce/page-builder-admin`, and these **six** entries
  // are **re-keyed**, not raised and not dropped. Every count is unmoved: the
  // same strings in the same components, under the paths the walk reads them at
  // now. Four of them were `_shared/email-builder`'s (9 + 1 + 2 + 4 = 16, the
  // figure P5c's widening was sized against) and two are `cms`' — `AssetPickers`
  // and `CatalogPickers` moved with the chrome, which the plan's count of the
  // e-mail half did not include. The walk reaches them because the package
  // declares `endora: { type: 'admin-ui' }`; forget that block and all six go
  // *stale* in the same run rather than silently unread, which is the property
  // that makes a self-declared population safe here.
  'packages/page-builder-admin/src/email/EmailEditorPane.tsx': 9,
  'packages/page-builder-admin/src/email/EmailRichTextField.tsx': 1,
  'packages/page-builder-admin/src/email/EmailRowLayoutPicker.tsx': 2,
  'packages/page-builder-admin/src/email/EmailVariablesProvider.tsx': 4,
  'packages/page-builder-admin/src/chrome/AssetPickers.tsx': 5,
  'packages/page-builder-admin/src/chrome/CatalogPickers.tsx': 13,
  // Feature 091, Phase 4 batch 16 — re-keyed, not raised and not dropped:
  // `cms` took its admin surface into its package and these three files went
  // with it. Every count is unmoved; the same strings in the same components,
  // under the paths the walk reads them at now. This baseline is a ledger
  // *about* the files it names rather than one of them, so the merge request
  // that moves a file is structurally the one that cannot see the entry go
  // stale — the shape the six entries above record for P5b, and the reason both
  // halves are corrected here rather than one of them going red later.
  'packages/modules/cms/src/admin/components/ButtonLinkFields.tsx': 4,
  'packages/modules/cms/src/admin/components/ComponentDragHandle.tsx': 1,
  'packages/modules/cms/src/admin/components/RowLayoutPicker.tsx': 2,
  // Feature 091, Phase 4 batch 12 — re-keyed, not dropped: `invoices` took its
  // admin surface into its package and this file went with it. The count is
  // untouched; nothing about the strings changed, only their address. This
  // baseline is a ledger *about* the files it names rather than one of them,
  // so the merge request that moves a file is structurally the one that
  // cannot see the entry go stale.
  'packages/modules/invoices/src/admin/templates/invoice-puck-config.tsx': 6,
  // Feature 091, Phase 4 batch three: the screen moved into its module's
  // package and the entry is **re-keyed**, not raised and not dropped. The
  // finding is one LinkedIn URN format example in a `placeholder`, and it is
  // the same finding at a new address — this check's two-way ratchet reported
  // both halves in one run (unaccounted here, over-baselined there), which is
  // the laundering FR-017 refuses arriving one check over. It is not drained
  // here because `urn:lla:llaPartnerConversion:…` is a wire-format example and
  // not a sentence: putting it in a bundle would invite a translator to
  // translate a LinkedIn identifier.
  'packages/modules/linkedin_ads/src/admin/pages/ConversionMappingEditPage.tsx': 1,
  // Feature 091, Phase 4 batch four: the screen moved into `mfa`'s package and
  // the entry is **re-keyed**, not raised and not dropped — the same sixteen
  // strings at a new address. This check's two-way ratchet reported both halves
  // in one run again (unaccounted at the new key, over-baselined at the old
  // one), which is what the ratchet is for. The debt itself is untouched and is
  // real: `/security` is the signed-in admin's own two-factor screen and every
  // one of its sixteen strings is English-only, so a Polish-speaking operator
  // sets up their second factor in English. Translating them is a screen's
  // worth of keys and belongs to whoever is repairing this screen, not to a
  // batch whose subject is where the file lives.
  'packages/modules/mfa/src/admin/pages/AdminSecuritySettings.tsx': 16,
  // Feature 091, Phase 4, the plan's batch 7 — the same four counts under the
  // same four files, **re-keyed rather than re-baselined**. The ratchet is
  // two-way and keyed by path, so moving a directory strands the old key as a
  // stale entry and reports the new one as a regression; both halves fired here
  // and both are the move, not a change to a single string.
  'packages/modules/product_feeds/src/admin/components/FeedDeliveryPanel.tsx': 1,
  'packages/modules/promotions/src/admin/components/CouponGeneratorForm.tsx': 2,
  'packages/modules/promotions/src/admin/pages/PromotionEditPage.tsx': 1,
  'packages/modules/promotions/src/admin/pages/PromotionStatsPage.tsx': 2,
  // Feature 091, Phase 4, the plan's batch 8 — five files, 30 findings, the
  // same counts under new keys. `delivery_methods`' list screen and four of
  // `returns`' five screens moved into their modules' packages; the ratchet is
  // two-way and keyed by path, so each move stranded the old key and reported
  // the new one as a regression. Both halves of all five fired in one run,
  // which is what the ratchet is for: a re-key is visible as a re-key rather
  // than as a debt that quietly moved house.
  'packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage.tsx': 5,
  'packages/modules/returns/src/admin/pages/ReturnDeliveryMethodsPage.tsx': 5,
  'packages/modules/returns/src/admin/pages/ReturnDetail.tsx': 12,
  'packages/modules/returns/src/admin/pages/ReturnReasonsPage.tsx': 4,
  'packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage.tsx': 4,
  // Feature 091, Phase 4 batch five: the screen moved into `stripe`'s package
  // and the entry is **re-keyed**, not raised and not dropped — the same
  // twenty-nine strings at a new address, which this check's two-way ratchet
  // reported in one run as a regression at the new key and a drain at the old
  // one. `stripe` is the one member of that batch whose screen calls no
  // `useTranslation` at all: the other six render every sentence through their
  // module's bundle, and this one renders its credentials, its payment-method
  // table and its display-mode explanation in English whatever language the
  // operator chose. Translating them is a screen's worth of keys and belongs to
  // whoever repairs this screen, not to a batch whose subject is where the file
  // lives.
  'packages/modules/stripe/src/admin/pages/StripeSettingsPage.tsx': 29,
  // Feature 091, Phase 4, the plan's batch 9 — the same four findings under a
  // new key. `custom_fields`' definition screen moved into its module's
  // package; the ratchet is two-way and keyed by path, so both halves fired in
  // one run, a regression at the new key and a drain at the old one. The debt
  // is untouched and is real: `Label (EN)`, `Options (comma-separated)`, its
  // `gold, silver` placeholder and the `Add field` button are the create form's
  // English-only half, beside a screen whose other six strings do resolve
  // through this module's own bundle. Translating them is one form's worth of
  // keys and belongs to whoever repairs the form, not to a batch whose subject
  // is where the file lives.
  //
  // `assets_library` moved in the same batch and gets no entry, because its
  // four files carry no finding — the library screen, its folder tree and its
  // detail drawer render every sentence through `useTranslation`.
  'packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx': 4,
  // Feature 091, Phase 4 batch 10 — three entries **re-keyed**, not raised and
  // not dropped: the same 17, 22 and 1 findings at new addresses, which the
  // two-way ratchet reported in one run as three regressions at the new keys
  // and three drains at the old ones.
  //
  // Two of the three moved further than the rest of their directory.
  // `PwaPage.tsx` and `PushAudienceRuleBuilder.tsx` sat under
  // `admin/src/modules/settings/` and are `pwa`'s screen and its rule builder;
  // batch six moved that module's sidebar entry alone and said the route would
  // follow when `settings` moved, so they are `@endora-commerce/mod-pwa`'s now
  // rather than `settings`'. The debt travels with the file and is untouched:
  // between them they render the whole push-notification screen — the icon
  // uploader, the VAPID controls, the audience builder's operators — in English
  // whatever language the operator chose. Translating it is a screen's worth of
  // keys and belongs to whoever repairs that screen, not to a batch whose
  // subject is where the file lives.
  //
  // `dictionaries` and `credentials` moved in the same batch and get no entry,
  // because none of their nine files carries a finding.
  // Feature 091, Phase 4 batch 11 — fifteen entries **re-keyed**, not raised
  // and not dropped: the same 6, 4, 8, 14, 3, 4, 7, 6, 9, 5, 3, 3, 1, 3 and 4
  // findings at new addresses, which the two-way ratchet reported in one run as
  // fifteen regressions at the new keys and fifteen drains at the old ones.
  //
  // The debt travels with the file and is untouched. Between them these fifteen
  // render the whole newsletter surface — subscribers, campaigns, automations,
  // tags, blocks, the sending provider — and the transactional-email editors
  // and branding panel, in English whatever language the operator chose.
  // Translating them is two screens' worth of keys per module and belongs to
  // whoever repairs those screens, not to a batch whose subject is where the
  // file lives.
  'packages/modules/newsletter/src/admin/pages/AutomationBuilder.tsx': 6,
  'packages/modules/newsletter/src/admin/pages/AutomationsPage.tsx': 4,
  'packages/modules/newsletter/src/admin/pages/BlocksPage.tsx': 8,
  'packages/modules/newsletter/src/admin/pages/CampaignEditor.tsx': 14,
  'packages/modules/newsletter/src/admin/pages/CampaignStats.tsx': 3,
  'packages/modules/newsletter/src/admin/pages/CampaignsPage.tsx': 4,
  'packages/modules/newsletter/src/admin/pages/ProviderSettingsPage.tsx': 7,
  'packages/modules/newsletter/src/admin/pages/SubscribersPage.tsx': 6,
  'packages/modules/newsletter/src/admin/pages/TagsPage.tsx': 9,
  'packages/modules/transactional_emails/src/admin/components/BrandingPanel.tsx': 5,
  'packages/modules/transactional_emails/src/admin/pages/EmailBlocksPage.tsx': 3,
  'packages/modules/transactional_emails/src/admin/pages/EmailEditor.tsx': 3,
  'packages/modules/transactional_emails/src/admin/pages/EmailFragmentEditor.tsx': 1,
  'packages/modules/transactional_emails/src/admin/pages/EmailTemplatesPage.tsx': 3,
  'packages/modules/transactional_emails/src/admin/pages/EmailsList.tsx': 4,
  'packages/modules/pwa/src/admin/components/PushAudienceRuleBuilder.tsx': 17,
  'packages/modules/pwa/src/admin/pages/PwaPage.tsx': 22,
  'packages/modules/settings/src/admin/components/AssetIdSettingInput.tsx': 1,
  // Feature 091, Phase 4 batch 14 — re-keyed, not dropped: `organizations`
  // took its admin surface into its package and this panel went with it. The
  // finding is unchanged, and this ledger is one **about** the files it names
  // rather than one of them, so the batch that moves a screen is structurally
  // the batch that cannot see the entry go stale — which is why it is
  // corrected here, in the same merge request.
  'packages/modules/organizations/src/admin/panels/RestrictionsPanel.tsx': 1,
  // Feature 091, Phase 4 batch 13 — re-keyed, not dropped: `pim_ergonode` took
  // its admin surface into its package and this screen went with it. The
  // finding is unchanged (one `placeholder` reading `https://pim.example.com`),
  // and this ledger is one **about** the files it names rather than one of
  // them, so the batch that moves a screen is structurally the batch that
  // cannot see the entry go stale — which is why it is corrected here, in the
  // same merge request.
  'packages/modules/pim_ergonode/src/admin/pages/ErgonodeConnectionPage.tsx': 1,
};

/** One file's measured count against its baseline. */
export interface BaselineDrift {
  /** Path relative to `admin/src`. */
  readonly file: string;
  readonly baseline: number;
  readonly actual: number;
}

export interface BaselineVerdict {
  /** Files carrying more hard-coded strings than the baseline allows. */
  readonly regressions: readonly BaselineDrift[];
  /** Files carrying fewer — the ledger describes a debt that was paid. */
  readonly drained: readonly BaselineDrift[];
}

/**
 * Findings grouped by the file they were found in, keyed relative to `root`.
 *
 * Taken as a parameter rather than read from disk so the ratchet can be driven
 * over counts the repository does not contain — a check whose comparison only
 * ever sees the real tree agrees with a function that returns nothing.
 */
export function countByFile(findings: readonly Finding[], root: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = relative(root, finding.filePath).split('\\').join('/');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The two-way comparison: what grew, and what shrank without the ledger moving. */
export function compareToBaseline(
  counts: ReadonlyMap<string, number>,
  baseline: Readonly<Record<string, number>> = HARDCODED_STRINGS_BASELINE,
): BaselineVerdict {
  const regressions: BaselineDrift[] = [];
  const drained: BaselineDrift[] = [];

  for (const [file, actual] of counts) {
    const allowed = baseline[file] ?? 0;
    if (actual > allowed) regressions.push({ file, baseline: allowed, actual });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const actual = counts.get(file) ?? 0;
    if (actual < allowed) drained.push({ file, baseline: allowed, actual });
  }

  const byFile = (a: BaselineDrift, b: BaselineDrift): number => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(byFile), drained: drained.sort(byFile) };
}

export function collectTsxFiles(root: string, out: string[]): void {
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry.startsWith('.')) continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsxFiles(full, out);
    } else if (st.isFile() && entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  // The default root is resolved against the repository, not the working
  // directory. `admin/src` was relative to `process.cwd()`, and the documented
  // invocation runs with `backend/` as the cwd, where no such directory exists.
  const declared = positional.length > 0 ? null : adminScanRoots();
  const roots = declared === null ? positional : declared.map((root) => root.dir);
  // The baseline is measured over the whole of `admin/src`, so it can only judge
  // a run that scanned the whole of `admin/src`. Given a path, every file the
  // ledger names but the walk never opened would read as drained — so an
  // explicit path means "report everything", the mode used while draining one
  // screen. `--strict` says the same thing about the full scan.
  const strict = argv.includes('--strict') || positional.length > 0;

  const files: string[] = [];
  // Per root, so the `sources=` token below can say which declared root
  // contributed nothing rather than only how many files the walk opened in
  // total.
  const perRoot: number[] = [];
  for (const r of roots) {
    const before = files.length;
    try {
      const st = statSync(r);
      if (st.isDirectory()) collectTsxFiles(r, files);
      else if (r.endsWith('.tsx')) files.push(r);
    } catch {
      process.stderr.write(`[i18n:hardcoded] path not found: ${r}\n`);
    }
    perRoot.push(files.length - before);
  }

  if (files.length === 0) {
    // `admin/src` is resolved against the current directory, so running this
    // from `backend/` (which is where the package script runs) found no file at
    // all and still printed a 0-finding summary and exit 0. "Nothing to report"
    // and "nothing was read" must not share an exit code (issue #113).
    process.stderr.write(
      `[i18n:hardcoded] no .tsx file under ${roots.join(', ')} — refusing to report a vacuous pass\n`,
    );
    process.exit(2);
  }

  const findings: Finding[] = [];
  for (const f of files) walkFile(f, findings);

  // The module-admin floor. It is resolved here rather than inside
  // `adminScanRoots` because it is deliberately **not** part of the population:
  // the roots are this walk's own listing, and this is the second program's
  // answer they are reconciled against. See `coveredModuleAdminLayers`.
  //
  // An explicit path (the draining mode) reads a deliberate subset and declares
  // no coverage at all, so nothing is resolved for it — which also keeps the
  // draining mode free of the manifest index, as it has always been.
  let adminLayers: readonly ModuleAdminLayer[] | null = null;
  if (declared !== null) {
    const registryFile = adminRegistryPathOf(workspaceMembers(REPO_ROOT, nodeWorkspaceFs()));
    // The gate is the registry file and nothing else — `check:admin-zones`' T4
    // repair, for the reason `admin-kit-surface.md` §7.5 measured: a gate that
    // can go false for a reason having nothing to do with the registry omits
    // this token over every layer while the check prints a clean line. A
    // workspace with no admin application has no registry and no token; one
    // whose registry is there and names none is the refusal below.
    if (adminRegistryPresent(registryFile)) {
      const layout = await requireModuleLayout('[i18n:hardcoded]');
      adminLayers = moduleAdminLayers(layout, registryFile!);
      const refusal = moduleAdminFloorRefusal(adminLayers);
      if (refusal !== null) {
        process.stderr.write(`[i18n:hardcoded] ${refusal}\n`);
        process.exit(2);
      }
    }
  }

  // What was read, in the shared grammar (issue #244) — before the `--strict`
  // branch below, so both modes disclose the same walk.
  //
  // Two corroborations, one per root family that has a second author. **admin-ui**:
  // the workspace manifests say how many packages ship a tree of admin UI, this
  // walk says how many of them produced a file, and a package that declared
  // itself and contributed nothing is a `short-walk` refusal rather than a
  // quietly narrowed scan. It replaced a by-name refusal ("no member is
  // `@endora-commerce/admin-kit`") and is strictly wider: the kit going missing
  // still exits 2, and so does the second admin-ui package's tree moving out
  // from under the walk (feature 091, P5c). **module-admin**: the generated
  // contribution registry's answer, reconciled against the roots this walk
  // opened — the floor the third and largest family had none of until feature
  // 091's drain made the absence measurable.
  //
  // The application's own `admin/src` still has no second author and is not
  // reconciled here; the companion test's ledger case is what floors it, since
  // every entry `HARDCODED_STRINGS_BASELINE` names has to be a file this walk
  // opened.
  reportReadSize({
    prefix: '[i18n:hardcoded]',
    files: files.length,
    coverage:
      declared === null
        ? []
        : [
            {
              source: 'admin-ui',
              expected: declared.filter((root) => root.adminUi).length,
              covered: declared.filter((root, index) => root.adminUi && perRoot[index]! > 0)
                .length,
            },
            // Omitted rather than printed `0/0` where the registry is not on
            // disk, which `read-size.ts` refuses as `no-expectation`.
            ...(adminLayers === null
              ? []
              : [
                  {
                    source: 'module-admin',
                    expected: adminLayers.length,
                    covered: coveredModuleAdminLayers(
                      adminLayers,
                      declared.map((root) => root.dir),
                    ),
                  },
                ]),
          ],
  });

  const cwd = process.cwd();
  const print = (f: Finding): void => {
    const rel = relative(cwd, f.filePath);
    const text = f.text.length > 80 ? `${f.text.slice(0, 77)}...` : f.text;
    process.stdout.write(`${rel}:${f.line}:${f.column} → "${text}" (${f.kind})\n`);
  };

  if (strict) {
    for (const f of findings) print(f);
    process.stdout.write(
      `\n[i18n:hardcoded] ${findings.length} finding(s) across ${files.length} file(s)\n`,
    );
    if (findings.length > 0) process.exit(1);
    return;
  }

  const counts = countByFile(findings, REPO_ROOT);
  const { regressions, drained } = compareToBaseline(counts);

  if (argv.includes('--list')) for (const f of findings) print(f);

  process.stdout.write(
    `[i18n:hardcoded] findings=${findings.length} files=${files.length} ` +
      `ledger-size=${Object.keys(HARDCODED_STRINGS_BASELINE).length} ` +
      `regressions=${regressions.length} drained=${drained.length}\n`,
  );

  if (regressions.length > 0) {
    process.stderr.write(
      '\nThese files carry a hard-coded user-visible string the baseline does not\n' +
        'account for. Wrap it in `t(...)` and ship the key in en.json AND pl.json\n' +
        '(Principle VIII) — do not raise the number:\n',
    );
    for (const d of regressions) {
      process.stderr.write(`  - ${d.file}: ${d.actual} finding(s), baseline ${d.baseline}\n`);
      for (const f of findings.filter(
        (x) => relative(REPO_ROOT, x.filePath).split('\\').join('/') === d.file,
      )) {
        print(f);
      }
    }
  }

  if (drained.length > 0) {
    process.stderr.write(
      '\nThese files are in HARDCODED_STRINGS_BASELINE with a number that is too\n' +
        'high — the strings were translated and the ledger was not lowered. Lower\n' +
        'it, or delete the entry when it reaches zero; it may only shrink:\n',
    );
    for (const d of drained) {
      process.stderr.write(
        `  - ${d.file}: baseline ${d.baseline}, now ${d.actual}` +
          `${d.actual === 0 ? ' — delete the entry' : ''}\n`,
      );
    }
  }

  if (regressions.length > 0 || drained.length > 0) process.exit(1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
