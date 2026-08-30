import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { reportReadSize } from './lib/read-size.js';
import { modulePackages, nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

/** The checkout, whichever one this file was loaded from. */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * The roots the admin's user-visible strings live in, and the reason there is
 * more than one (feature 091, Phase 1b and Phase 4).
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
 * the batch that cannot see the entry describing it go stale. Neither the
 * directory nor the package name is spelled: a member declares
 * `endora: { type: 'module' }` about itself, and the layer is a root when the
 * package actually has one.
 *
 * The keys are repository-relative, so the ledger names one file in one
 * namespace whichever root it sits under. The kit's directory is not spelled
 * here either: it is the workspace member whose manifest carries the name, so a
 * move costs no edit and a kit that is gone is exit 2 rather than a population
 * quietly halved.
 */
function defaultRoots(): readonly string[] {
  const members = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  const kit = members.find((member) => member.name === ADMIN_KIT_PACKAGE);
  if (kit === undefined) {
    process.stderr.write(
      `[i18n:hardcoded] no workspace member is ${ADMIN_KIT_PACKAGE} — half the admin's own ` +
        'components would go unscanned and the ledger entries naming them would read as ' +
        'drained; refusing to report a vacuous pass\n',
    );
    process.exit(2);
  }
  const moduleAdminLayers = modulePackages(members)
    .map((pkg) => join(pkg.dir, 'src', 'admin'))
    // A module package with no admin layer is the ordinary case and contributes
    // nothing — an empty set is legitimate here, unlike the kit's absence,
    // because before Story 3 there were no layers at all.
    .filter((dir) => existsSync(dir));
  return [join(REPO_ROOT, 'admin', 'src'), join(kit.dir, 'src'), ...moduleAdminLayers];
}

/** The package the admin's design system lives in since feature 091, Phase 1b. */
const ADMIN_KIT_PACKAGE = '@endora-commerce/admin-kit';

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
  'admin/src/components/LoginPage.tsx': 4,
  'admin/src/components/asset-picker/AssetFieldPicker.tsx': 1,
  'packages/admin-kit/src/components/rule-builder/RuleBuilder.tsx': 6,
  'packages/admin-kit/src/ui/color-picker.tsx': 1,
  'admin/src/modules/_shared/email-builder/EmailEditorPane.tsx': 9,
  'admin/src/modules/_shared/email-builder/EmailRichTextField.tsx': 1,
  'admin/src/modules/_shared/email-builder/EmailRowLayoutPicker.tsx': 2,
  'admin/src/modules/_shared/email-builder/EmailVariablesProvider.tsx': 4,
  'admin/src/modules/cms/components/AssetPickers.tsx': 5,
  'admin/src/modules/cms/components/ButtonLinkFields.tsx': 4,
  'admin/src/modules/cms/components/CatalogPickers.tsx': 13,
  'admin/src/modules/cms/components/ComponentDragHandle.tsx': 1,
  'admin/src/modules/cms/components/RowLayoutPicker.tsx': 2,
  'admin/src/modules/custom_fields/CustomFieldsPage.tsx': 4,
  'admin/src/modules/delivery_methods/DeliveryMethodsPage.tsx': 5,
  'admin/src/modules/invoices/templates/invoice-puck-config.tsx': 6,
  'admin/src/modules/linkedin_ads/pages/ConversionMappingEditPage.tsx': 1,
  'admin/src/modules/mfa/AdminSecuritySettings.tsx': 16,
  'admin/src/modules/newsletter/pages/AutomationBuilder.tsx': 6,
  'admin/src/modules/newsletter/pages/AutomationsPage.tsx': 4,
  'admin/src/modules/newsletter/pages/BlocksPage.tsx': 8,
  'admin/src/modules/newsletter/pages/CampaignEditor.tsx': 14,
  'admin/src/modules/newsletter/pages/CampaignStats.tsx': 3,
  'admin/src/modules/newsletter/pages/CampaignsPage.tsx': 4,
  'admin/src/modules/newsletter/pages/ProviderSettingsPage.tsx': 7,
  'admin/src/modules/newsletter/pages/SubscribersPage.tsx': 6,
  'admin/src/modules/newsletter/pages/TagsPage.tsx': 9,
  'admin/src/modules/organizations/panels/RestrictionsPanel.tsx': 1,
  'admin/src/modules/pim_ergonode/ErgonodeConnectionPage.tsx': 1,
  'admin/src/modules/product_feeds/components/FeedDeliveryPanel.tsx': 1,
  'admin/src/modules/promotions/CouponGeneratorForm.tsx': 2,
  'admin/src/modules/promotions/PromotionEditPage.tsx': 1,
  'admin/src/modules/promotions/PromotionStatsPage.tsx': 2,
  'admin/src/modules/returns/ReturnDeliveryMethodsPage.tsx': 5,
  'admin/src/modules/returns/ReturnDetail.tsx': 12,
  'admin/src/modules/returns/ReturnReasonsPage.tsx': 4,
  'admin/src/modules/returns/ReturnStatusesConfigPage.tsx': 4,
  'admin/src/modules/settings/PushAudienceRuleBuilder.tsx': 17,
  'admin/src/modules/settings/components/AssetIdSettingInput.tsx': 1,
  'admin/src/modules/settings/pages/PwaPage.tsx': 22,
  'admin/src/modules/stripe/StripeSettingsPage.tsx': 29,
  'admin/src/modules/transactional_emails/components/BrandingPanel.tsx': 5,
  'admin/src/modules/transactional_emails/pages/EmailBlocksPage.tsx': 3,
  'admin/src/modules/transactional_emails/pages/EmailEditor.tsx': 3,
  'admin/src/modules/transactional_emails/pages/EmailFragmentEditor.tsx': 1,
  'admin/src/modules/transactional_emails/pages/EmailTemplatesPage.tsx': 3,
  'admin/src/modules/transactional_emails/pages/EmailsList.tsx': 4,
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

function main(): void {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  // The default root is resolved against the repository, not the working
  // directory. `admin/src` was relative to `process.cwd()`, and the documented
  // invocation runs with `backend/` as the cwd, where no such directory exists.
  const roots = positional.length > 0 ? positional : defaultRoots();
  // The baseline is measured over the whole of `admin/src`, so it can only judge
  // a run that scanned the whole of `admin/src`. Given a path, every file the
  // ledger names but the walk never opened would read as drained — so an
  // explicit path means "report everything", the mode used while draining one
  // screen. `--strict` says the same thing about the full scan.
  const strict = argv.includes('--strict') || positional.length > 0;

  const files: string[] = [];
  for (const r of roots) {
    try {
      const st = statSync(r);
      if (st.isDirectory()) collectTsxFiles(r, files);
      else if (r.endsWith('.tsx')) files.push(r);
    } catch {
      process.stderr.write(`[i18n:hardcoded] path not found: ${r}\n`);
    }
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

  // What was read, in the shared grammar (issue #244) — before the `--strict`
  // branch below, so both modes disclose the same walk. `self-reported`: the
  // population is the admin SPA's own tree, which nothing else derives.
  reportReadSize({ prefix: '[i18n:hardcoded]', files: files.length });

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
  main();
}
