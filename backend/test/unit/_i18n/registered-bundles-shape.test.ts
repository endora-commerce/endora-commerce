import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBundleKeywords, SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import {
  BundleLoadError,
  loadModuleBundles,
} from '@endora-commerce/mod-i18n/backend';
import {
  judgeSentenceCase,
  SENTENCE_CASE_PROPER_NOUNS,
} from '@endora-commerce/cli/lib/sentence-case.js';
import { MESSAGES } from '../../../../storefront/lib/i18n/messages.js';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../../src/lifecycle/registered-manifests.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every file below `dir` whose path matches `pattern`, `node_modules` and `dist` excluded. */
function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, pattern));
    else if (pattern.test(path)) out.push(path);
  }
  return out;
}

/**
 * Regression guard — every on-disk bundle shipped by a registered module
 * must satisfy `TranslationBundleEntriesSchema` (a FLAT `{"a.b.c": "text"}`
 * object). Nested JSON objects parse fine but fail validation, and the boot
 * reconciler only logs-and-skips such a module (`_i18n/plugin.ts`
 * `reconcileBundles`). The failure is therefore silent: the module's admin
 * pages and its ⌘K action labels render raw translation keys.
 *
 * `bundle-loader.unit.test.ts` covers the loader's error paths against
 * fixtures; this test points the same loader at the real filesystem.
 *
 * ## What this file does **not** answer, and the skip that hid it
 *
 * Its subject is key-level resolution inside the bundles a module ships. File
 * **presence** is `check:bundle-pairing`'s
 * (`specs/094-translation-boundary/contracts/bundle-pairing-ratchet.md`), and
 * until that check landed this file looked as though it answered both while
 * answering neither — in two places, each a population derived from the artefact
 * under judgement:
 *
 *   * the refusal-token case read `if (!en || !pl) continue;`, so a module that
 *     dropped `pl.json` outright was **skipped by the case whose subject is
 *     bundle symmetry**. It now separates the two states the disjunction ran
 *     together: *neither* bundle is the module that ships no strings and has
 *     nothing to be symmetric about, and *one* bundle is a failure here as well
 *     as a finding there;
 *   * the action-key case iterated `loaded.byLanguage` — the languages *that
 *     module happens to ship* — so a module shipping only `en.json` had its keys
 *     checked against English and passed. It now iterates
 *     `SUPPORTED_LANGUAGES`, which is what "every shipped language" was always
 *     meant to say.
 *
 * The two instruments are not duplicates after the repair: this file judges the
 * modules that **declare** `i18n`, key by key; the check judges every registered
 * module's files, including one whose manifest declares no `bundlesDir` at all —
 * which `withBundles` filters out of this file before the first assertion.
 */
describe('registered module i18n bundles — real filesystem shape', () => {
  const withBundles = REGISTERED_MANIFESTS.filter((e) => e.manifest.i18n);

  it('has at least one module shipping bundles (sanity)', () => {
    expect(withBundles.length).toBeGreaterThan(0);
  });

  it.each(withBundles.map((e) => [e.manifest.id, e] as const))(
    'module "%s" loads without a BundleLoadError',
    (_id, entry) => {
      const bundlesDir = entry.manifest.i18n!.bundlesDir;
      try {
        loadModuleBundles(entry.manifest.id, dirname(entry.filePath), bundlesDir);
      } catch (err) {
        if (err instanceof BundleLoadError) {
          throw new Error(
            `${err.message} (reason: ${err.reason}, file: ${err.path ?? 'n/a'}). ` +
              'Bundle entries must be a flat object of dot-separated key -> string.',
          );
        }
        throw err;
      }
    },
  );

  it('every action label/description/keywords key declared in a manifest resolves in every shipped language', () => {
    const missing: string[] = [];
    for (const entry of withBundles) {
      const actions = entry.manifest.actions ?? [];
      if (actions.length === 0) continue;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      // A module that declares a bundles directory and ships nothing in it owes
      // no key — `check:bundle-pairing` § 1's conditional, and the one state in
      // which "no bundle" is not a defect. Every other module is held to the
      // **platform's** languages, not to its own: iterating `loaded.byLanguage`
      // asked each module about the languages it happened to ship, so one
      // shipping only `en.json` had its keys checked against English and passed.
      if (loaded.byLanguage.size === 0) continue;
      for (const language of SUPPORTED_LANGUAGES) {
        const entries = loaded.byLanguage.get(language);
        if (entries === undefined) {
          missing.push(`${entry.manifest.id}/${language}.json → (no bundle in this language)`);
          continue;
        }
        for (const action of actions) {
          const keys = [action.labelKey, action.descriptionKey, action.keywordsKey].filter(
            (k): k is string => typeof k === 'string',
          );
          for (const key of keys) {
            if (!(key in entries)) {
              missing.push(`${entry.manifest.id}/${language}.json → ${key}`);
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Issue #560 — a `keywordsKey` value is a comma-separated word list
   * (`parseBundleKeywords`), held to the bounds `ModuleActionSchema` puts on
   * `keywords`; and a template variable's `sampleValueKey` resolves in every
   * shipped language, its English value being the manifest's own `sampleValue`
   * — the literal the preview falls back to — so the two cannot drift apart.
   */
  it('every action keywordsKey resolves to a bounded word list in every shipped language', () => {
    const problems: string[] = [];
    let declared = 0;
    for (const entry of withBundles) {
      const actions = (entry.manifest.actions ?? []).filter((a) => a.keywordsKey);
      if (actions.length === 0) continue;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      for (const action of actions) {
        declared += 1;
        for (const language of SUPPORTED_LANGUAGES) {
          const value = loaded.byLanguage.get(language)?.[action.keywordsKey!];
          const words = value === undefined ? [] : parseBundleKeywords(value);
          if (words.length === 0 || words.length > 10 || words.some((w) => w.length > 64)) {
            problems.push(`${entry.manifest.id}/${language}.json → ${action.keywordsKey}: ${JSON.stringify(value)}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(declared).toBeGreaterThan(0);
  });

  /**
   * Issue #573 — a manifest's `keywords` are English; a word an operator types
   * in another language goes under the action's `keywordsKey`. The prose
   * detector (`check:default-language-prose`) cannot see a single Polish word
   * with no diacritic and no stopword (`statusy`, `klient`), which is how about
   * forty-five modules kept them inline after #560.
   *
   * So the rule is positive rather than a detector: every word of every
   * `keywords` entry is a word the platform's **English** bundles already use —
   * every registered module's `en.json`, minus its `*.keywords` entries, so the
   * rule cannot be satisfied by writing the same word into the list it judges —
   * or one of the few English and technical tokens below that no English string
   * happens to contain. A Polish word is in no `en.json`, so it fails here
   * whether or not it carries a diacritic. The corpus is the whole platform's
   * rather than the declaring module's own because that one is too small to
   * hold even its own screen's vocabulary, and a guard that needs a ledger
   * entry for every ordinary English word is one nobody keeps.
   *
   * The allowlist is two-way: an entry no keyword uses, or one the corpus now
   * holds anyway, fails too, so it cannot grow into a place Polish hides.
   */
  it('every manifest action keyword is English — a word the English bundles use, or allowlisted', () => {
    const KEYWORD_TOKENS_OUTSIDE_THE_ENGLISH_BUNDLES = new Set([
      '2fa', 'article', 'balance', 'clients', 'datalayer', 'ecommerce', 'ga4',
      'i18n', 'insight', 'kanban', 'multimedia', 'orgs', 'pipeline', 'presence', 'purge',
      'rbac', 'refunds', 'sgtm', 'smtp', 'swagger', 'timezone', 'todo', 'urgency',
    ]);
    const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

    const english = new Set<string>();
    for (const entry of withBundles) {
      const bundle = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      ).byLanguage.get('en');
      for (const [key, value] of Object.entries(bundle ?? {})) {
        if (!key.endsWith('.keywords')) for (const word of wordsOf(value)) english.add(word);
      }
    }

    const problems: string[] = [];
    const allowlistUsed = new Set<string>();
    let checked = 0;
    for (const entry of REGISTERED_MANIFESTS) {
      for (const action of entry.manifest.actions ?? []) {
        for (const keyword of action.keywords ?? []) {
          checked += 1;
          for (const word of wordsOf(keyword)) {
            if (english.has(word)) continue;
            if (KEYWORD_TOKENS_OUTSIDE_THE_ENGLISH_BUNDLES.has(word)) {
              allowlistUsed.add(word);
              continue;
            }
            problems.push(
              `${entry.manifest.id}/${action.id}: "${keyword}" — "${word}" is in no en.json. ` +
                'A non-English word goes in i18n/<language>.json under the action\'s keywordsKey; ' +
                'an English one the bundles do not use goes in this allowlist.',
            );
          }
        }
      }
    }
    for (const word of KEYWORD_TOKENS_OUTSIDE_THE_ENGLISH_BUNDLES) {
      if (english.has(word)) problems.push(`allowlist: "${word}" is in an en.json now — delete the entry`);
      else if (!allowlistUsed.has(word)) problems.push(`allowlist: "${word}" is in no manifest keyword — delete the entry`);
    }
    expect(problems).toEqual([]);
    expect(english.size).toBeGreaterThan(1000);
    expect(checked).toBeGreaterThan(0);
  });

  it('every template-variable sampleValueKey resolves in every shipped language, English matching the manifest', () => {
    const problems: string[] = [];
    let declared = 0;
    for (const entry of withBundles) {
      const variables = (entry.manifest.transactionalEmails ?? []).flatMap((e) => e.variables ?? []);
      const keyed = variables.filter((v) => v.sampleValueKey);
      if (keyed.length === 0) continue;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      for (const variable of keyed) {
        declared += 1;
        for (const language of SUPPORTED_LANGUAGES) {
          const value = loaded.byLanguage.get(language)?.[variable.sampleValueKey!];
          if (value === undefined) {
            problems.push(`${entry.manifest.id}/${language}.json → ${variable.sampleValueKey}`);
          } else if (language === 'en' && value !== variable.sampleValue) {
            problems.push(
              `${entry.manifest.id}/en.json → ${variable.sampleValueKey} is ${JSON.stringify(value)}, ` +
                `the manifest sampleValue is ${JSON.stringify(variable.sampleValue)}`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(declared).toBeGreaterThan(0);
  });

  /**
   * Feature 096, T208 — block label, description and category-title keys
   * (`contracts/block-definition.md` §2).
   *
   * They join the action keys above rather than getting a case of their own for
   * the reason the action case exists at all: `labelKey` and `descriptionKey`
   * are **module-relative** and live in the declaring module's own bundle, so a
   * nested bundle, a missing language or a mistyped key all end the same way —
   * the palette renders the raw key and the boot reconciler says nothing.
   *
   * Held to `SUPPORTED_LANGUAGES`, never to `loaded.byLanguage`: a module's own
   * languages are what it happens to ship, and the question is what the platform
   * ships.
   */
  it('every block label/description key declared in a manifest resolves in every shipped language', () => {
    const missing: string[] = [];
    let declared = 0;
    for (const entry of withBundles) {
      const blocks = entry.manifest.blocks ?? [];
      if (blocks.length === 0) continue;
      declared += blocks.length;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      if (loaded.byLanguage.size === 0) continue;
      for (const language of SUPPORTED_LANGUAGES) {
        const entries = loaded.byLanguage.get(language);
        if (entries === undefined) {
          missing.push(`${entry.manifest.id}/${language}.json → (no bundle in this language)`);
          continue;
        }
        for (const block of blocks) {
          for (const key of [block.labelKey, block.descriptionKey].filter(
            (k): k is string => typeof k === 'string',
          )) {
            if (!(key in entries)) missing.push(`${entry.manifest.id}/${language}.json → ${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
    // A green over an empty population would mean "no module declares a block",
    // which is the state this case exists to stop being invisible.
    expect(declared).toBeGreaterThan(0);
  });

  it('every declared palette section title resolves in every shipped language', () => {
    const missing: string[] = [];
    let declared = 0;
    for (const entry of withBundles) {
      const categories = entry.manifest.blockCategories ?? [];
      if (categories.length === 0) continue;
      declared += categories.length;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      if (loaded.byLanguage.size === 0) continue;
      for (const language of SUPPORTED_LANGUAGES) {
        const entries = loaded.byLanguage.get(language);
        if (entries === undefined) {
          missing.push(`${entry.manifest.id}/${language}.json → (no bundle in this language)`);
          continue;
        }
        for (const category of categories) {
          if (!(category.titleKey in entries)) {
            missing.push(`${entry.manifest.id}/${language}.json → ${category.titleKey}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(declared).toBeGreaterThan(0);
  });

  /**
   * Issue #739 — a module that declares `organizationPermissions` heads its own
   * group on the role form (storefront and the admin Roles tab), and
   * `OrganizationRoleService.permissionCatalogue` resolves that heading from the
   * module's `module.name` key. A missing key does not fail loudly: it falls
   * back to the manifest's English `name`, so a Polish page shows "Orders"
   * beside "Szybkie zamówienia".
   *
   * The population is every registered manifest declaring at least one
   * permission — `REGISTERED_MANIFESTS`, not `withBundles`, so a module that
   * declares permissions and no bundles directory fails here too — held to
   * `SUPPORTED_LANGUAGES`, never to the languages the module happens to ship.
   */
  it('every module declaring organizationPermissions translates module.name in every shipped language', () => {
    const declaring = REGISTERED_MANIFESTS.filter(
      (e) => (e.manifest.organizationPermissions ?? []).length > 0,
    );
    const missing: string[] = [];
    for (const entry of declaring) {
      if (!entry.manifest.i18n) {
        missing.push(`${entry.manifest.id}: declares organizationPermissions and no i18n bundles`);
        continue;
      }
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n.bundlesDir,
      );
      for (const language of SUPPORTED_LANGUAGES) {
        const value = loaded.byLanguage.get(language)?.['module.name'];
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${entry.manifest.id}/${language}.json → module.name`);
        }
      }
    }
    expect(missing).toEqual([]);
    // An empty population would make the case vacuous — feature 170's own
    // modules declare permissions, so zero means the filter broke.
    expect(declaring.length).toBeGreaterThan(0);
  });

  /**
   * Issues #746 and #776 — English labels are sentence case, like the rest of
   * the UI ("Quote requests", not "Quote Requests"). `module.name` heads the
   * permission groups on the role form, the module screen and the command
   * palette; the manifest `name` is its English fallback wherever a bundle has
   * no `module.name`. Polish was sentence case already.
   *
   * The population (#746): every core manifest `name`, plus every deployment's
   * overlay modules, plus every module's English `module.name` and `nav.*`
   * labels. #776 added the module bundles' `*.title` keys (page and dialog
   * titles), the literal `<PageHeader title="…">` of the module admin pages,
   * the English label of every palette action, every settings group `name`,
   * the storefront's English `nav.*` labels and the `title` / `sidebar_label`
   * of every hand-written documentation page, then the English admin search
   * group labels (`adminSearch.*group.label`) and the demo composition's
   * megamenu labels. #795 refused a docs title that is a bare module id.
   * #807 added the English label of every declared block (`blocks.*.label`,
   * what the Page Builder drawer shows), the English admin search field labels
   * (`adminSearch.*field.*`) and the Polish `nav.*` labels, which are sentence
   * case too ("Import / eksport").
   *
   * The rule and the allowlist are `@endora-commerce/cli`'s
   * (`lib/sentence-case.ts`) — the one copy, which `endora new module` refuses
   * a title-case `--name` with. The allowlist is two-way here: an entry nothing
   * in this population uses fails too.
   */
  it('every English module name, nav label, page title, palette label, block label, settings group, admin search group and field, demo menu label and docs title, and every Polish nav label, is sentence case', async () => {
    const used = new Set<string>();
    const problems: string[] = [];
    const judged = new Map<string, number>();
    const judge = (population: string, where: string, text: string): void => {
      judged.set(population, (judged.get(population) ?? 0) + 1);
      const verdict = judgeSentenceCase(text);
      for (const noun of verdict.nouns) used.add(noun);
      if (verdict.offending.length > 0) {
        problems.push(`${where}: ${JSON.stringify(text)} (${verdict.offending.join(', ')})`);
      }
    };

    const appsDir = join(REPO_ROOT, 'backend/src/apps');
    const manifests = new Map(REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e] as const));
    for (const deployment of readdirSync(appsDir)) {
      for (const entry of await resolvedManifestEntries({ DEPLOYMENT: deployment } as NodeJS.ProcessEnv)) {
        manifests.set(entry.manifest.id, entry);
      }
    }
    const NAV_LABEL = /(^|\.)nav\.[A-Za-z]+(\.label)?$/;
    const ADMIN_SEARCH_GROUP = /^adminSearch\.([A-Za-z]+\.)?group\.label$/;
    const ADMIN_SEARCH_FIELD = /^adminSearch\.([A-Za-z]+\.)?field\.[A-Za-z]+$/;
    for (const entry of manifests.values()) {
      const id = entry.manifest.id;
      judge('manifest name', `${id} manifest name`, entry.manifest.name);
      for (const group of entry.manifest.settings?.groups ?? []) {
        judge('settings group', `${id} settings group "${group.code}"`, group.name);
      }
      if (!entry.manifest.i18n) continue;
      const bundles = loadModuleBundles(
        id,
        dirname(entry.filePath),
        entry.manifest.i18n.bundlesDir,
      ).byLanguage;
      const en = bundles.get('en') ?? {};
      for (const [key, value] of Object.entries(en)) {
        if (key === 'module.name' || (NAV_LABEL.test(key) && !/[dD]escription$/.test(key))) {
          judge('module name and nav label', `${id}/en.json → ${key}`, value);
        } else if (/(^|\.)title$/.test(key)) {
          judge('title', `${id}/en.json → ${key}`, value);
        } else if (ADMIN_SEARCH_GROUP.test(key)) {
          judge('admin search group', `${id}/en.json → ${key}`, value);
        } else if (ADMIN_SEARCH_FIELD.test(key)) {
          judge('admin search field', `${id}/en.json → ${key}`, value);
        }
      }
      for (const action of entry.manifest.actions ?? []) {
        const label = en[action.labelKey];
        if (label !== undefined) judge('palette label', `${id}/en.json → ${action.labelKey}`, label);
      }
      for (const block of entry.manifest.blocks ?? []) {
        const label = en[block.labelKey];
        if (label !== undefined) judge('block label', `${id}/en.json → ${block.labelKey}`, label);
      }
      for (const [key, value] of Object.entries(bundles.get('pl') ?? {})) {
        if (NAV_LABEL.test(key) && !/[dD]escription$/.test(key)) {
          judge('Polish nav label', `${id}/pl.json → ${key}`, value);
        }
      }
    }

    const PAGE_HEADER_TITLE = /<PageHeader\b[^>]*?\btitle="([^"]+)"/g;
    for (const file of filesUnder(join(REPO_ROOT, 'packages/modules'), /\/src\/admin\/.*\.tsx$/)) {
      for (const match of readFileSync(file, 'utf8').matchAll(PAGE_HEADER_TITLE)) {
        judge('page header', `${relative(REPO_ROOT, file)} <PageHeader title>`, match[1]!.replace(/&amp;/g, '&'));
      }
    }

    for (const [key, value] of Object.entries(MESSAGES['en-US']!)) {
      if (NAV_LABEL.test(key)) judge('storefront nav label', `storefront en-US → ${key}`, value);
    }

    // The demo composition seeds a megamenu whose English labels the
    // storefront shows as they are written: no bundle stands between them.
    const demoComposition = join(REPO_ROOT, 'packages/demo-composition/src/composition.ts');
    const MENU_LABEL = /\blabels: \{[^}]*'en-US': '([^']+)'/g;
    for (const match of readFileSync(demoComposition, 'utf8').matchAll(MENU_LABEL)) {
      judge('demo menu label', `${relative(REPO_ROOT, demoComposition)} menu label`, match[1]!);
    }

    // Hand-written pages only: `module-reference/` and `*.generated.md` are
    // `composer:generate`'s, and judged at their source, the manifest. So are
    // the untracked copies it places under `docs/docs/modules/`, judged at the
    // module's own `docs/` page they copy.
    const MODULE_DOC = /\/packages\/modules\/[^/]+\/docs\/(.+\.mdx?)$/;
    const moduleDocs = filesUnder(join(REPO_ROOT, 'packages/modules'), MODULE_DOC);
    const copied = new Set(moduleDocs.map((file) => MODULE_DOC.exec(file)![1]!));
    const siteDocs = filesUnder(join(REPO_ROOT, 'docs/docs'), /\.mdx?$/).filter((file) => {
      const path = relative(join(REPO_ROOT, 'docs/docs'), file);
      if (path.startsWith('module-reference/') || path.endsWith('.generated.md')) return false;
      return !(path.startsWith('modules/') && copied.has(path.slice('modules/'.length)));
    });
    const docs = [...siteDocs, ...moduleDocs];
    for (const file of docs) {
      const frontMatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      for (const [, field, raw] of frontMatter.matchAll(/^(title|sidebar_label):[ \t]*(.+)$/gm)) {
        const value = raw!.trim().replace(/^(['"])(.*)\1$/, '$2');
        // A page titled with its module's id (`title: carts`) shows a code
        // identifier in the sidebar, the module map and the browser tab, where
        // a reader looks for a name (#795). The id belongs in the body.
        if (manifests.has(value)) {
          problems.push(`${relative(REPO_ROOT, file)} ${field}: ${JSON.stringify(value)} is a module id, not a readable title`);
          continue;
        }
        judge('docs title', `${relative(REPO_ROOT, file)} ${field}`, value);
      }
    }

    for (const noun of SENTENCE_CASE_PROPER_NOUNS) {
      if (!used.has(noun)) problems.push(`allowlist: "${noun}" is in no label or title — delete the entry`);
    }
    expect(problems).toEqual([]);
    // Overlay modules joined the core set: more than the core alone was judged.
    expect(manifests.size).toBeGreaterThan(REGISTERED_MANIFESTS.length);
    // Every population reached something: an empty one means its filter broke.
    expect([...judged.keys()].sort()).toEqual([
      'Polish nav label',
      'admin search field',
      'admin search group',
      'block label',
      'demo menu label',
      'docs title',
      'manifest name',
      'module name and nav label',
      'page header',
      'palette label',
      'settings group',
      'storefront nav label',
      'title',
    ]);
  });

  /**
   * Feature 096, T208 — the title-agreement assertion
   * (`contracts/block-definition.md` §1.1's table, row 4).
   *
   * Two modules declaring one `(key, context)` is normal and merges, and which
   * declaration wins is a **function of the declarations** — lowest `weight`,
   * ties by module id — so it changes when a module is switched off. If the two
   * `titleKey`s resolve to different sentences the palette section renames
   * itself depending on which modules are on, which is a presentation nobody
   * wrote and no operator can predict.
   *
   * It lives here rather than in `check:block-names` because it is a question
   * about **bundles**, and this file already has them open over
   * `SUPPORTED_LANGUAGES` (`contracts/block-name-check.md` §3). The check
   * answers the manifest half — a `weight` or a `visible` that disagrees.
   */
  it('two modules declaring one (key, context) title it identically in every shipped language', () => {
    const byLanguage = new Map<string, Map<string, string>>();
    for (const entry of withBundles) {
      if ((entry.manifest.blockCategories ?? []).length === 0) continue;
      byLanguage.set(
        entry.manifest.id,
        new Map(
          Object.entries(
            loadModuleBundles(
              entry.manifest.id,
              dirname(entry.filePath),
              entry.manifest.i18n!.bundlesDir,
            ).byLanguage.get('en') ?? {},
          ),
        ),
      );
    }
    // `(key, context)` is the identity an entry listing three contexts states
    // three times (§1.1). Grouping on the entry would call two disjoint
    // sections a duplicate and miss an overlap in one context of two.
    const sections = new Map<string, { module: string; titleKey: string }[]>();
    for (const entry of withBundles) {
      for (const category of entry.manifest.blockCategories ?? []) {
        for (const context of category.contexts) {
          const pair = `${category.key}|${context}`;
          sections.set(pair, [
            ...(sections.get(pair) ?? []),
            { module: entry.manifest.id, titleKey: category.titleKey },
          ]);
        }
      }
    }
    const joined = [...sections].filter(([, declarations]) => declarations.length > 1);
    // The two this feature's own conversion creates — `data-model.md` §2.1.
    // Zero joined sections would make every assertion below vacuous.
    expect(joined.length).toBeGreaterThan(0);

    const disagreements: string[] = [];
    for (const language of SUPPORTED_LANGUAGES) {
      const resolved = new Map<string, Record<string, string>>();
      for (const entry of withBundles) {
        if ((entry.manifest.blockCategories ?? []).length === 0) continue;
        resolved.set(
          entry.manifest.id,
          loadModuleBundles(
            entry.manifest.id,
            dirname(entry.filePath),
            entry.manifest.i18n!.bundlesDir,
          ).byLanguage.get(language) ?? {},
        );
      }
      for (const [pair, declarations] of joined) {
        const titles = declarations.map(
          (d) => `${d.module}:${resolved.get(d.module)?.[d.titleKey] ?? '(unresolved)'}`,
        );
        const texts = new Set(titles.map((t) => t.slice(t.indexOf(':') + 1)));
        if (texts.size > 1) {
          disagreements.push(`${language} ${pair} → ${titles.join(' | ')}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(byLanguage.size).toBeGreaterThan(0);
  });

  /**
   * Issue #65 — refusal-token sentences (`errors.<CODE>.<token>`).
   *
   * `check:error-translations` walks the declared codes, so it sees
   * `errors.<CODE>` and nothing below it. A token key is therefore invisible to
   * that ratchet, and a token that ships in one language only degrades quietly:
   * the missing side falls back to the route's written English message instead
   * of rendering a raw code, which is safe enough that nobody would notice.
   * Both directions, so a stray PL sentence with no EN twin fails too.
   *
   * The disjunctive skip below it — `if (!en || !pl) continue;` — is gone, and
   * the two states it ran together are now separate: a module shipping
   * **neither** has nothing to be symmetric about and is passed over; a module
   * shipping **one** was the defect this case was blind to and is a failure
   * here as well as a `check:bundle-pairing` finding.
   */
  it('every refusal-token sentence ships in both languages', () => {
    const tokenKeys = (entries: Record<string, string>): string[] =>
      Object.keys(entries).filter((key) => /^errors\.[A-Z0-9_]+\.[a-z0-9_]+$/.test(key));
    const asymmetric: string[] = [];
    for (const entry of withBundles) {
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      const en = loaded.byLanguage.get('en');
      const pl = loaded.byLanguage.get('pl');
      // A module that ships neither has nothing to be symmetric about — the
      // `check:bundle-pairing` conditional, and the only state the old
      // `if (!en || !pl) continue;` was right to pass over.
      if (en === undefined && pl === undefined) continue;
      if (en === undefined || pl === undefined) {
        asymmetric.push(
          `${entry.manifest.id}: ships ${en === undefined ? 'pl.json' : 'en.json'} and not ` +
            `${en === undefined ? 'en.json' : 'pl.json'} — the case whose subject is symmetry ` +
            'used to skip exactly this',
        );
        continue;
      }
      for (const key of tokenKeys(en)) {
        if (!(key in pl)) asymmetric.push(`${entry.manifest.id}/pl.json → ${key}`);
      }
      for (const key of tokenKeys(pl)) {
        if (!(key in en)) asymmetric.push(`${entry.manifest.id}/en.json → ${key}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });

  it('the transact-gate refusal keeps a sentence of its own', () => {
    // Named rather than left to the parity rule above, which passes on zero
    // token keys: deleting both sides of this one would otherwise be silent,
    // and it is what four surfaces show a blocked Organization's buyer.
    const i18n = withBundles.find((e) => e.manifest.id === '_i18n');
    expect(i18n).toBeDefined();
    const loaded = loadModuleBundles(
      '_i18n',
      dirname(i18n!.filePath),
      i18n!.manifest.i18n!.bundlesDir,
    );
    for (const language of ['en', 'pl'] as const) {
      expect(
        loaded.byLanguage.get(language)?.['errors.FORBIDDEN.organization_cannot_transact'],
      ).toBeTypeOf('string');
    }
  });
});
