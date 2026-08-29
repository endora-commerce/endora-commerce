import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  reconcileBundles,
  type I18nReconcileEntry,
} from '@endora-commerce/mod-i18n/backend';
import type { I18nService } from '@endora-commerce/mod-i18n/backend';

/**
 * An installed package's bundles, through the platform's OWN reconciler
 * (feature 080, T032 — P2's remaining half).
 *
 * A5 of the D-110 acceptance criterion read a package's `en`/`pl` files with
 * `loadModuleBundles` directly. That proves the files are published and that
 * `dirname(filePath)` lands somewhere sensible; it does not prove that the code
 * which actually populates `translation_bundles` at boot, on `i18n:reload` and
 * on `module:install` ever reaches them. This file measures the reconciler.
 *
 * The entries are shaped exactly as `resolvedManifestEntries()` emits a package
 * — `filePath` is the resolved **`package.json`**, not the package directory,
 * because `dirname(filePath)` is what the reconciler joins `bundlesDir` to.
 * D-111 P2's wording says "the package directory" and is the half that is
 * wrong; nothing here should be changed to agree with it.
 */

let root: string;

interface PackageFixture {
  readonly id: string;
  readonly name: string;
  /** Raw `en.json` text — raw, so a malformed bundle can be written verbatim. */
  readonly en: string;
  readonly pl?: string;
}

/** Write a package as an install leaves it, and return its `package.json`. */
function writePackage(fixture: PackageFixture): string {
  const dir = join(root, 'node_modules', ...fixture.name.split('/'));
  mkdirSync(join(dir, 'i18n'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      { name: fixture.name, version: '1.0.0', endora: { type: 'module', id: fixture.id } },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, 'i18n', 'en.json'), fixture.en);
  if (fixture.pl !== undefined) writeFileSync(join(dir, 'i18n', 'pl.json'), fixture.pl);
  return join(dir, 'package.json');
}

function entryFor(id: string, filePath: string): I18nReconcileEntry {
  return { manifest: { id, i18n: { bundlesDir: 'i18n' } }, filePath };
}

/** Records what the reconciler asked for, and delegates to the real loader. */
function recordingService(): {
  service: I18nService;
  calls: Array<{ moduleId: string; modulePath: string; bundlesDir: string }>;
} {
  const calls: Array<{ moduleId: string; modulePath: string; bundlesDir: string }> = [];
  const service = {
    installBundlesForModule: async (
      moduleId: string,
      modulePath: string,
      bundlesDir: string,
    ): Promise<{ installed: string[] }> => {
      calls.push({ moduleId, modulePath, bundlesDir });
      // The real service reads the files through `loadModuleBundles`, which is
      // where a malformed bundle raises `BundleLoadError`. Import it here so
      // the fixture enters at the top of the analysis rather than as a
      // pre-classified verdict handed to the last function (issue #130).
      const { loadModuleBundles } = await import(
        '@endora-commerce/mod-i18n/backend'
      );
      const loaded = loadModuleBundles(moduleId, modulePath, bundlesDir);
      return { installed: [...loaded.byLanguage.keys()] };
    },
  } as unknown as I18nService;
  return { service, calls };
}

function collectingLog(): { info: string[]; warn: string[]; log: { info(m: string): void; warn(m: string): void } } {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    info,
    warn,
    log: {
      info: (m: string) => {
        info.push(m);
      },
      warn: (m: string) => {
        warn.push(m);
      },
    },
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'endora-t032-i18n-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('reconcileBundles over an installed package', () => {
  it('reads the bundles from inside the package, anchored on its package.json', async () => {
    const filePath = writePackage({
      id: 'acceptance_probe',
      name: '@vendor/mod-probe',
      en: JSON.stringify({ 'actions.openProbe.label': 'Probe' }),
      pl: JSON.stringify({ 'actions.openProbe.label': 'Sonda' }),
    });
    const { service, calls } = recordingService();
    const { log } = collectingLog();

    const result = await reconcileBundles([entryFor('acceptance_probe', filePath)], service, log);

    expect(calls).toEqual([
      {
        moduleId: 'acceptance_probe',
        // `dirname(package.json)` — the package directory, which is where its
        // published `i18n/` lives.
        modulePath: join(root, 'node_modules', '@vendor', 'mod-probe'),
        bundlesDir: 'i18n',
      },
    ]);
    expect(result.installed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('a malformed bundle from a package is skipped, and the warning names the file it read', async () => {
    // A nested object: the exact shape `TranslationBundleEntriesSchema`
    // refuses, and the one AGENTS.md warns every module author about. For a
    // core module CI refuses it before it ships; a package's bundle passes
    // through no CI of ours, so this warning is the only artefact an operator
    // ever gets — and a module id alone does not tell them whose module it is.
    const filePath = writePackage({
      id: 'bad_probe',
      name: '@vendor/mod-bad',
      en: JSON.stringify({ actions: { openProbe: { label: 'Probe' } } }),
    });
    const { service } = recordingService();
    const collected = collectingLog();

    const result = await reconcileBundles(
      [entryFor('bad_probe', filePath)],
      service,
      collected.log,
    );

    // Skipped, not thrown: one vendor's typo must not stop a shop booting.
    expect(result.failed).toBe(1);
    expect(result.installed).toBe(0);

    // Attributable: the path is what says "this is not ours".
    const warning = collected.warn.join('\n');
    expect(warning).toContain('bad_probe');
    expect(warning).toContain(join(root, 'node_modules', '@vendor', 'mod-bad'));

    // And structured, so the diagnostic surface can render more than a count.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      moduleId: 'bad_probe',
      modulePath: join(root, 'node_modules', '@vendor', 'mod-bad'),
      reason: 'invalid-shape',
    });
  });

  it('one package with a broken bundle does not stop the next one reconciling', async () => {
    const broken = writePackage({
      id: 'broken_probe',
      name: '@vendor/mod-broken',
      en: '{ not json',
    });
    const good = writePackage({
      id: 'good_probe',
      name: '@vendor/mod-good',
      en: JSON.stringify({ 'actions.openGood.label': 'Good' }),
    });
    const { service, calls } = recordingService();
    const collected = collectingLog();

    const result = await reconcileBundles(
      [entryFor('broken_probe', broken), entryFor('good_probe', good)],
      service,
      collected.log,
    );

    expect(result.failed).toBe(1);
    expect(result.installed).toBe(1);
    expect(calls.map((c) => c.moduleId)).toEqual(['broken_probe', 'good_probe']);
    expect(result.failures.map((f) => f.moduleId)).toEqual(['broken_probe']);
  });
});
