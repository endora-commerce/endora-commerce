import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import {
  BundleLoadError,
  loadModuleBundles,
} from '@endora-commerce/mod-i18n/backend';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

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

  it('every action label/description key declared in a manifest resolves in every shipped language', () => {
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
          const keys = [action.labelKey, action.descriptionKey].filter(
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
