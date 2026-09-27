/**
 * Where a permission label lives — feature 091, Phase 3.
 *
 * `/admin-roles` renders one row per grantable code and translates it through
 * `adminRoles.permission.<code>`. Until this phase that key had exactly one
 * home: `_i18n`'s bundle, which the SPA reads under the synthetic namespace
 * `core`. That is wrong for a packaged module in the plainest way — a module
 * installed from a registry cannot edit this repository's shared bundle — so
 * the rule is now the same one every other module-owned string already
 * follows: **the label lives in the owning module's own bundle, in every
 * shipped language**.
 *
 * The 89 codes that were still in the shared bundle when the rule landed are
 * the {@link LEGACY_PERMISSION_LABELS} block: a per-owner count in the idiom
 * `HARDCODED_STRINGS_BASELINE` and `UNSCOPED_WIPES_BASELINE` established, and
 * for the same reason. There is no decision to defend per code — there is one
 * decision ("this module has not moved its labels yet") repeated across 51
 * owners — so a ledger with a sentence each would be 89 copies of one sentence
 * and nobody would read it.
 *
 * ## The rule needed a renderer before it could be a rule
 *
 * `mfa`, `pwa`, `stripe` and `prompt_actions` shipped their labels in their own
 * bundles **and** in `_i18n`'s, and the copy in their own bundle had never been
 * read: `AdminRolesPage` resolved the key through `useTranslation('core')`, one
 * namespace, and a module's bundle is served under the module's own id. Four
 * authors did the right thing and the platform ignored it, silently, since
 * feature 042. So this phase landed the lookup as well as the rule
 * (`admin/src/modules/admin_users/permission-label.ts`), and the eight
 * duplicates came out of the shared bundle in the same merge request — which is
 * the drain path, exercised once before anybody is asked to follow it.
 *
 * ## Why a count per owner and not per code
 *
 * A module moves its labels in one merge request, all of them, because that is
 * the unit the bundle files come in. The owner is therefore this rule's "file":
 * a number that grows is a label somebody added to the shared bundle instead of
 * their own, and a number left standing is a module whose labels have moved
 * while the block still claims them. Both directions fail.
 *
 * A code more than one module owns is keyed by **every** owner, sorted and
 * joined — `api_keys+webhooks`. `integrations:manage` gates two admin surfaces
 * and stays grantable while either module is present, so neither owner alone is
 * the answer to "who moves this label", and picking one would make the entry
 * drain when the other module was the one that acted.
 *
 * ## What this file is not
 *
 * It is not a second derivation of the permission catalogue. The owner map is
 * `PermissionCatalogueService.listOwnersByCode()` — the merge that already
 * answers "whose presence keeps this code grantable" — handed in from the
 * contract test. Deriving it again here is the shape this repository keeps
 * paying for: two answers to one question, with the short one reporting a clean
 * tree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import type { ReadSizeInput } from '../../scripts/lib/read-size.js';

/** The key prefix `/admin-roles` builds for every catalogue row. */
export const PERMISSION_LABEL_PREFIX = 'adminRoles.permission.';

/**
 * The module whose bundle is the shared legacy home.
 *
 * A fact about this repository's history, not a pattern: `_i18n` ships the
 * admin chrome under the synthetic namespace `core`, and permission labels were
 * put there in feature 026 because at the time every module was a directory in
 * one build. A module arriving from a registry has no way to write into it.
 */
export const LEGACY_LABEL_MODULE_ID = '_i18n';

/** One module's labelled codes, per language, as read off its bundle files. */
export type LabelledCodesByLanguage = ReadonlyMap<string, ReadonlySet<string>>;

export interface PermissionLabelInput {
  /**
   * `code -> the module ids whose presence keeps it grantable`, from
   * `PermissionCatalogueService.listOwnersByCode()`.
   */
  readonly owners: ReadonlyMap<string, ReadonlySet<string>>;
  /** `moduleId -> language -> the codes that module's bundle labels`. */
  readonly bundles: ReadonlyMap<string, LabelledCodesByLanguage>;
  /** Every language the platform ships a bundle for. */
  readonly languages: readonly string[];
}

export type PermissionLabelFindingKind =
  | 'missing-label'
  | 'foreign-label'
  | 'split-label'
  | 'orphan-legacy-label';

export interface PermissionLabelFinding {
  readonly kind: PermissionLabelFindingKind;
  readonly code: string;
  /** The module the finding is about — the owner, or the bundle that carries it. */
  readonly module: string;
  /** The language, where the finding is per language. */
  readonly language?: string;
  readonly detail: string;
}

/** The block's key for a code: every owner, sorted, joined with `+`. */
export function legacyOwnerKey(owners: ReadonlySet<string>): string {
  return [...owners].sort().join('+');
}

function labelledIn(
  input: PermissionLabelInput,
  moduleId: string,
  language: string,
): ReadonlySet<string> {
  return input.bundles.get(moduleId)?.get(language) ?? new Set<string>();
}

/**
 * Every defect in one pass, in a stable order: the codes first (missing, then
 * split), then the bundles that label something they do not own, then the
 * legacy labels nobody declares.
 */
export function findPermissionLabelDefects(
  input: PermissionLabelInput,
): PermissionLabelFinding[] {
  const findings: PermissionLabelFinding[] = [];
  const codes = [...input.owners.keys()].sort();

  for (const code of codes) {
    const owners = input.owners.get(code) ?? new Set<string>();
    const ownerIds = [...owners].sort();
    const ownedIn = new Set(
      input.languages.filter((language) =>
        ownerIds.some((id) => labelledIn(input, id, language).has(code)),
      ),
    );
    for (const language of input.languages) {
      if (ownedIn.has(language)) continue;
      if (labelledIn(input, LEGACY_LABEL_MODULE_ID, language).has(code)) continue;
      findings.push({
        kind: 'missing-label',
        code,
        module: ownerIds.join('+'),
        language,
        detail:
          `no ${language} label for \`${code}\` — add "${PERMISSION_LABEL_PREFIX}${code}" ` +
          `to the owning module's own i18n/${language}.json`,
      });
    }
    // Half a migration: the owner took one language and left the other behind,
    // so the shared bundle is silently still answering for it.
    if (ownedIn.size > 0 && ownedIn.size < input.languages.length) {
      for (const language of input.languages) {
        if (ownedIn.has(language)) continue;
        const owner = ownerIds.find((id) =>
          input.languages.some((l) => labelledIn(input, id, l).has(code)),
        );
        findings.push({
          kind: 'split-label',
          code,
          module: owner ?? ownerIds.join('+'),
          language,
          detail:
            `\`${code}\` is labelled by its owner in some shipped languages and not in ` +
            `${language} — a module's labels move in every language at once, or the ` +
            `shared bundle keeps answering for the rest`,
        });
      }
    }
  }

  for (const [moduleId] of [...input.bundles].sort(([a], [b]) => a.localeCompare(b))) {
    if (moduleId === LEGACY_LABEL_MODULE_ID) continue;
    const carried = new Set<string>();
    for (const language of input.languages) {
      for (const code of labelledIn(input, moduleId, language)) carried.add(code);
    }
    for (const code of [...carried].sort()) {
      if (input.owners.get(code)?.has(moduleId) === true) continue;
      findings.push({
        kind: 'foreign-label',
        code,
        module: moduleId,
        detail:
          `\`${moduleId}\` labels \`${code}\`, which its manifest does not declare — a ` +
          `label belongs to the module that owns the code, or it renders for a code that ` +
          `module cannot gate`,
      });
    }
  }

  const legacy = new Set<string>();
  for (const language of input.languages) {
    for (const code of labelledIn(input, LEGACY_LABEL_MODULE_ID, language)) legacy.add(code);
  }
  for (const code of [...legacy].sort()) {
    if (input.owners.has(code)) continue;
    findings.push({
      kind: 'orphan-legacy-label',
      code,
      module: LEGACY_LABEL_MODULE_ID,
      detail: `the shared bundle labels \`${code}\`, which no module declares`,
    });
  }

  return findings;
}

/** How many of each owner's codes the shared bundle still labels. */
export function countLegacyLabelsByOwner(input: PermissionLabelInput): Map<string, number> {
  const counts = new Map<string, number>();
  const legacy = new Set<string>();
  for (const language of input.languages) {
    for (const code of labelledIn(input, LEGACY_LABEL_MODULE_ID, language)) legacy.add(code);
  }
  for (const code of [...legacy].sort()) {
    const owners = input.owners.get(code);
    // A code nobody declares is `orphan-legacy-label`'s, not the block's: the
    // remedy is to delete the label, never to record it as debt to be drained.
    if (owners === undefined || owners.size === 0) continue;
    const key = legacyOwnerKey(owners);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface LegacyBlockDrift {
  readonly owner: string;
  readonly declared: number;
  readonly actual: number;
}

/** The two-way comparison: what grew, and what shrank without the block moving. */
export function compareToLegacyBlock(
  counts: ReadonlyMap<string, number>,
  block: Readonly<Record<string, number>> = LEGACY_PERMISSION_LABELS,
): { unrecorded: LegacyBlockDrift[]; stale: LegacyBlockDrift[] } {
  const unrecorded: LegacyBlockDrift[] = [];
  const stale: LegacyBlockDrift[] = [];

  for (const [owner, actual] of counts) {
    const declared = block[owner] ?? 0;
    if (actual > declared) unrecorded.push({ owner, declared, actual });
  }
  for (const [owner, declared] of Object.entries(block)) {
    const actual = counts.get(owner) ?? 0;
    if (actual < declared) stale.push({ owner, declared, actual });
  }

  const byOwner = (a: LegacyBlockDrift, b: LegacyBlockDrift): number =>
    a.owner.localeCompare(b.owner);
  return { unrecorded: unrecorded.sort(byOwner), stale: stale.sort(byOwner) };
}

/**
 * The legacy block — one entry per owner, valued by how many of that owner's
 * codes `_i18n`'s bundle still labels.
 *
 * **Never raise a number to make the build pass.** A new permission's label
 * goes in its own module's bundle; that is the whole rule, and it is the only
 * way this file gets shorter. Draining an owner means moving every one of its
 * `adminRoles.permission.<code>` entries out of `packages/modules/_i18n/i18n/`
 * into the module's own `i18n/en.json` and `i18n/pl.json`, and deleting the
 * entry here — a zero is not how an entry retires.
 *
 * When the last entry goes, this block and the assertions that ratchet it are
 * deleted with it, and the rule stands on `missing-label` alone.
 */
export const LEGACY_PERMISSION_LABELS: Readonly<Record<string, number>> = {
  _lifecycle: 2,
  admin_notifications: 1,
  'admin_users+customers': 1,
  admin_users: 1,
  analytics: 1,
  'api_keys+webhooks': 1,
  assets_library: 2,
  audit_logs: 1,
  blog: 2,
  'carts+customers+organizations': 1,
  carts: 2,
  catalog: 2,
  cms: 2,
  comparisons: 1,
  credentials: 2,
  credit_limits: 1,
  currencies: 2,
  custom_fields: 2,
  customer_accounts: 2,
  'customers+organizations': 1,
  delivery_methods: 2,
  dictionaries: 1,
  google_analytics: 2,
  inventory: 2,
  invoices: 2,
  linkedin_ads: 2,
  megamenu: 2,
  meta_ads: 2,
  newsletter: 2,
  orders: 2,
  organizations: 2,
  payment_methods: 2,
  payments: 2,
  pim_ergonode: 2,
  price_lists: 2,
  product_feeds: 2,
  promotions: 3,
  quote_requests: 1,
  returns: 2,
  sales_channels: 2,
  search: 1,
  settings: 2,
  taxes: 2,
  transactional_emails: 2,
};

/**
 * Every module's bundle, read where its own manifest says it lives — feature
 * 091, Phase 3.
 *
 * This used to be one hard-coded path to `_i18n/i18n/`, which was true while
 * every permission label in the platform lived in that one file. It is now the
 * walk the rule is about, so it follows the manifest index: `dirname(filePath)`
 * joined to the module's declared `bundlesDir`, which is the same derivation
 * the boot reconciler uses and therefore moves with a module that becomes a
 * package.
 */
export interface BundleWalk {
  readonly bundles: Map<string, LabelledCodesByLanguage>;
  /** Files opened — the walk, not the files a finding landed in. */
  readonly files: number;
  /** `adminRoles.permission.*` entries read inside them. */
  readonly sites: number;
  /** Modules declaring a permission whose directory the walk located. */
  readonly located: number;
  /** Modules declaring a permission at all — the manifest index's answer. */
  readonly declaring: number;
}

export function walkPermissionLabels(
  entries: ReadonlyArray<{ manifest: { id: string; permissions?: unknown; i18n?: { bundlesDir: string } | undefined }; filePath: string }>,
): BundleWalk {
  const bundles = new Map<string, LabelledCodesByLanguage>();
  let files = 0;
  let sites = 0;
  let located = 0;
  let declaring = 0;

  for (const entry of entries) {
    const moduleDir = dirname(entry.filePath);
    const declaresPermissions = Array.isArray(entry.manifest.permissions)
      ? entry.manifest.permissions.length > 0
      : false;
    if (declaresPermissions) {
      declaring += 1;
      if (existsSync(moduleDir)) located += 1;
    }
    const bundlesDir = entry.manifest.i18n?.bundlesDir;
    if (bundlesDir === undefined) continue;
    const byLanguage = new Map<string, ReadonlySet<string>>();
    for (const language of SUPPORTED_LANGUAGES) {
      const file = join(moduleDir, bundlesDir, `${language}.json`);
      if (!existsSync(file)) continue;
      files += 1;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      const codes = new Set(
        Object.keys(parsed)
          .filter((key) => key.startsWith(PERMISSION_LABEL_PREFIX))
          .map((key) => key.slice(PERMISSION_LABEL_PREFIX.length)),
      );
      sites += codes.size;
      byLanguage.set(language, codes);
    }
    bundles.set(entry.manifest.id, byLanguage);
  }

  return { bundles, files, sites, located, declaring };
}

/**
 * What the sweep read, in the estate's grammar (issue #244).
 *
 * The independent derivation is the generated manifest index — it says how many
 * modules declare a permission at all — against the directories the walk
 * actually located. It is a second author's answer and not this walk's own: a
 * module tree that moved leaves every `dirname(filePath)` pointing at nothing,
 * so `covered` collapses while `files` merely shrinks, and `readSizeRefusal`
 * answers `short-walk` instead of letting the sweep report clean over whatever
 * survived (issue #215).
 */
export function permissionLabelReadSize(walk: BundleWalk): ReadSizeInput {
  return {
    prefix: '[permission-labels]',
    files: walk.files,
    sites: walk.sites,
    coverage: [{ source: 'manifest-index', expected: walk.declaring, covered: walk.located }],
  };
}
